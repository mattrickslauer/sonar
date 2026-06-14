import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dsql from "aws-cdk-lib/aws-dsql";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";

/**
 * Sonar data layer.
 *
 * See docs/data-model.md for the full design. In short:
 *  - One on-demand DynamoDB table `sonar` is the high-write ephemeral path
 *    (waypoints, presence, connections, membership, usage). TTL on `ttl`
 *    (24h base, +5min per like; sponsored pins use a far-future ttl), and a
 *    NEW_AND_OLD_IMAGES stream drives fan-out / metering.
 *  - GSI1 serves the reverse lookups ("my drops", "channels I'm in").
 *  - Aurora DSQL is the relational system-of-record (sponsorships, usage
 *    rollups, billing).
 *  - An EventBridge tick drives the bot liveness loop off the PRESENCE items.
 */
export class SonarStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // DynamoDB — single table `sonar`
    // ---------------------------------------------------------------------
    const table = new dynamodb.Table(this, "SonarTable", {
      tableName: "sonar",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      // Hackathon: tear down cleanly. Switch to RETAIN for anything real.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI1 — reverse lookups, shared by "my drops" and "channels I'm in".
    // Sparse: only items that set GSI1PK/GSI1SK are indexed.
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ---------------------------------------------------------------------
    // Aurora DSQL — relational system-of-record
    // ---------------------------------------------------------------------
    const dsqlCluster = new dsql.CfnCluster(this, "SonarArchiveDsql", {
      deletionProtectionEnabled: false, // hackathon
    });

    const region = cdk.Stack.of(this).region;
    // Standard DSQL endpoint host. DDL lives in docs/data-model.md; apply it
    // with a migration once the cluster is up.
    const dsqlEndpoint = `${dsqlCluster.attrIdentifier}.dsql.${region}.on.aws`;

    // IAM: let the DSQL-touching Lambdas authenticate to the cluster.
    const dsqlConnect = new iam.PolicyStatement({
      actions: ["dsql:DbConnectAdmin"],
      resources: [dsqlCluster.attrResourceArn],
    });

    // The Next/Vercel server connects to DSQL as the least-privilege `sonar_app`
    // role (NOT admin), so it only needs the non-admin `dsql:DbConnect` action.
    // The sonar-vercel IAM user is managed outside CDK (see docs/prod-deploy);
    // mint a policy doc the operator attaches to it, so the cluster ARN is wired
    // without hardcoding. The Postgres role itself + the IAM↔role link are set up
    // once via infra/sql/000_app_role.sql.
    const dsqlUserPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "SonarDsqlConnect",
          actions: ["dsql:DbConnect"],
          resources: [dsqlCluster.attrResourceArn],
        }),
      ],
    });

    // ---------------------------------------------------------------------
    // S3 — media blobs (photo/video/voice)
    // ---------------------------------------------------------------------
    // Waypoint media never lives in DynamoDB (400 KB item cap). The browser
    // uploads straight to this bucket via a presigned POST minted by
    // /api/media/upload (size + content-type pinned in the POST policy), and
    // reads go through a short-lived presigned GET behind /api/media/view.
    //
    // The bucket is fully private (no public/CDN access); presigned URLs are the
    // only door. Lifecycle keeps it ephemeral like the waypoints themselves:
    // objects expire after 2 days (max waypoint lifespan is 24h, with buffer),
    // and dangling multipart uploads are aborted after 1 day.
    //
    // Explicit name so the env var (SONAR_MEDIA_BUCKET) and the sonar-vercel IAM
    // policy can reference it ahead of deploy. ACCOUNT_ID keeps it globally
    // unique. CORS allows the browser presigned POST/GET from the app origins;
    // add preview-deploy origins here as needed.
    const mediaBucket = new s3.Bucket(this, "SonarMediaBucket", {
      bucketName: `sonar-media-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Only the ephemeral user uploads under media/ expire. Bot seed media
          // under seed/ is permanent (referenced by the always-on bot tick).
          id: "expire-ephemeral-uploads",
          prefix: "media/",
          expiration: cdk.Duration.days(2),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT,
          ],
          allowedOrigins: [
            "https://mysonar.zone",
            "https://www.mysonar.zone",
            "https://sonar-bay.vercel.app", // legacy Vercel host (kept during cutover)
            // Local dev: Next falls back to 3001/3002 when 3000 is taken, so allow
            // the common range or the presigned media upload fails CORS.
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
          ],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
      // Hackathon: tear down cleanly. Switch to RETAIN for anything real.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // The Vercel functions sign uploads/reads with the external sonar-vercel IAM
    // user (managed outside CDK — see docs/prod-deploy / the inline policy). Mint
    // a least-privilege policy document the operator can attach to that user, so
    // the bucket ARN is wired without hardcoding it.
    const mediaUserPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: "SonarMediaObjectRW",
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [mediaBucket.arnForObjects("media/*")],
        }),
        // Read-only on the bot seed media so the view route can presign GETs.
        new iam.PolicyStatement({
          sid: "SonarSeedObjectRead",
          actions: ["s3:GetObject"],
          resources: [mediaBucket.arnForObjects("seed/*")],
        }),
      ],
    });

    // ---------------------------------------------------------------------
    // Stream consumers (stubs — handlers in infra/lambda/*)
    // ---------------------------------------------------------------------
    const commonEnv = {
      TABLE_NAME: table.tableName,
      DSQL_ENDPOINT: dsqlEndpoint,
    };

    // Shared layer carrying the DSQL connection deps (pg + IAM signer) for the
    // meter consumer. The Node 20 runtime bundles the core AWS SDK v3
    // (DynamoDB, API Gateway Management API) but not pg or the DSQL signer.
    const dsqlLayer = new lambda.LayerVersion(this, "DsqlDepsLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "layers", "dsql")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: "pg + @aws-sdk/dsql-signer for the DSQL-touching consumers",
    });

    const makeFn = (
      name: string,
      dir: string,
      opts: { env?: Record<string, string>; layers?: lambda.ILayerVersion[] } = {},
    ) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", dir)),
        timeout: cdk.Duration.seconds(30),
        environment: { ...commonEnv, ...(opts.env ?? {}) },
        layers: opts.layers,
      });

    // Live fan-out: stream INSERT of a waypoint → push to channel subscribers.
    const fanout = makeFn("FanoutConsumerFn", "fanout");
    // Reads CONN#<channel> to find subscribers; prunes stale (410) connections
    // and writes USAGE# message-delivery events for the meter consumer.
    table.grantReadWriteData(fanout);
    fanout.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 25,
        retryAttempts: 3,
        bisectBatchOnError: true,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
          }),
        ],
      })
    );

    // Metering: stream INSERT of USAGE#... events → atomic rollup → DSQL.
    const meter = makeFn("MeterConsumerFn", "meter", { layers: [dsqlLayer] });
    table.grantReadData(meter);
    meter.addToRolePolicy(dsqlConnect);
    meter.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        retryAttempts: 3,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("INSERT"),
          }),
        ],
      })
    );

    // ---------------------------------------------------------------------
    // Stripe webhook → DSQL subscription state (paid permanent waypoints)
    // ---------------------------------------------------------------------
    // A public Lambda Function URL receives Stripe events, verifies the HMAC
    // signature, and mirrors subscription state into the DSQL `subscriptions`
    // table that the Next app gates the permanent-waypoint feature on. Connects
    // to DSQL as admin via the shared layer, like the meter consumer.
    //
    // The webhook signing secret lives in SSM Parameter Store (created out of
    // band after the Stripe endpoint is registered against this Function URL),
    // so it never enters git or the CloudFormation template and rotates without
    // a redeploy. The Lambda reads it at runtime.
    const stripeWebhookSecretParam = "/sonar/stripe/webhook-secret";
    const stripeWebhook = makeFn("StripeWebhookFn", "stripe-webhook", {
      layers: [dsqlLayer],
      env: { WEBHOOK_SECRET_PARAM: stripeWebhookSecretParam },
    });
    stripeWebhook.addToRolePolicy(dsqlConnect); // admin DSQL auth
    // Needs the table to flip a paid pin to permanent and to cascade-expire the
    // account's pins on cancel. TABLE_NAME is already in its env via commonEnv.
    table.grantReadWriteData(stripeWebhook);
    stripeWebhook.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "SonarStripeWebhookSecretRead",
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${region}:${this.account}:parameter${stripeWebhookSecretParam}`,
        ],
      }),
    );
    const stripeWebhookUrl = stripeWebhook.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Stripe is unauthenticated; HMAC secures it
    });

    // ---------------------------------------------------------------------
    // Bot liveness tick (EventBridge → Lambda)
    // ---------------------------------------------------------------------
    // Reads active cells from PRESENCE and tops up quiet ones with templated
    // bot waypoints. Note: EventBridge rate() min is 1 minute; for the ~45s
    // cadence in the data model the handler should self-reschedule or use a
    // Step Functions Wait loop.
    const botTick = makeFn("BotTickFn", "bot-tick");
    table.grantReadWriteData(botTick);
    new events.Rule(this, "BotTickScheduleRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(botTick)],
    });

    // ---------------------------------------------------------------------
    // Live channel — API Gateway WebSocket API
    // ---------------------------------------------------------------------
    // The browser opens one socket per session (`?channels=…`). $connect records
    // a CONN#<channel> fan-out target per subscribed channel; $disconnect cleans
    // them up (via GSI1 keyed by connId) and emits connection-minutes usage. The
    // fanout stream consumer pushes new waypoints to these sockets.
    const wsConnect = makeFn("WsConnectFn", "ws-connect");
    table.grantReadWriteData(wsConnect);
    const wsDisconnect = makeFn("WsDisconnectFn", "ws-disconnect");
    table.grantReadWriteData(wsDisconnect); // queries GSI1, deletes, writes USAGE#

    // $connect authorizer — verifies the session ticket the browser passes as
    // `?token=` (see src/lib/server/session.ts createWsTicket + the
    // /api/realtime/ticket route). Without it the WS feed is open to anyone.
    // It signs/verifies with the same secret as the Next server, so the deploy
    // environment must provide it. (Hackathon: env var → CFN template. For
    // production, source this from Secrets Manager and grant the Lambda read.)
    const sessionSecret = process.env.SONAR_SESSION_SECRET;
    if (!sessionSecret || sessionSecret.length < 32) {
      throw new Error(
        "SONAR_SESSION_SECRET (>= 32 chars) must be set in the deploy environment " +
          "so the WebSocket authorizer can verify session tickets. Use the SAME " +
          "value as the Next/Vercel server (SONAR_SESSION_SECRET).",
      );
    }
    const wsAuthorizerFn = makeFn("WsAuthorizerFn", "ws-authorizer", {
      env: { SONAR_SESSION_SECRET: sessionSecret },
    });
    const wsAuthorizer = new WebSocketLambdaAuthorizer(
      "WsAuthorizer",
      wsAuthorizerFn,
      {
        authorizerName: "sonar-ws-session",
        identitySource: ["route.request.querystring.token"],
      },
    );

    const wsApi = new apigwv2.WebSocketApi(this, "SonarWebSocketApi", {
      apiName: "sonar-ws",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsConnectInteg", wsConnect),
        authorizer: wsAuthorizer,
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsDisconnectInteg", wsDisconnect),
      },
    });
    const wsStage = new apigwv2.WebSocketStage(this, "SonarWebSocketStage", {
      webSocketApi: wsApi,
      stageName: "live",
      autoDeploy: true,
    });

    // Let fanout call back into connected sockets, and tell it where the API is.
    fanout.addEnvironment("WS_ENDPOINT", wsStage.callbackUrl);
    wsApi.grantManageConnections(fanout);

    // ---------------------------------------------------------------------
    // Observability — CloudTrail management events → CloudWatch Logs
    // ---------------------------------------------------------------------
    // The audit/debug feed for our CDK deploys: records account management
    // events (CloudFormation, IAM, Lambda, DynamoDB/DSQL control-plane — i.e.
    // everything this stack touches) and streams them to CloudWatch Logs so
    // they're queryable with Logs Insights. The pre-existing `lambda-events`
    // trail only captures Lambda *data* events, so this is the first
    // management-events trail in the account (free first copy).

    // S3 is mandatory for CloudTrail (durable store); CloudWatch is the live
    // query surface. We own the bucket so `cdk destroy` cleans up.
    const trailBucket = new s3.Bucket(this, "TrailArchiveBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      // Hackathon: tear down cleanly. Switch to RETAIN for anything real.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Short retention — this is a hackathon debug feed, not compliance
    // retention (that's what the S3 archive is for).
    const trailLogGroup = new logs.LogGroup(this, "TrailLogGroup", {
      logGroupName: "/sonar/cloudtrail",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const trail = new cloudtrail.Trail(this, "SonarTrail", {
      trailName: "sonar-management-trail",
      bucket: trailBucket,
      sendToCloudWatchLogs: true,
      cloudWatchLogGroup: trailLogGroup,
      enableFileValidation: true,
      // Both reads and writes of management events (CreateStack, PutRolePolicy,
      // UpdateFunctionCode, etc.). Data events stay off — high volume, and the
      // `lambda-events` trail already covers Lambda data events.
      managementEvents: cloudtrail.ReadWriteType.ALL,
      // Single region keeps us in the free first-copy tier; the app lives in
      // us-east-1 anyway.
      isMultiRegionTrail: false,
    });

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "TrailLogGroupName", {
      value: trailLogGroup.logGroupName,
      description: "CloudWatch Logs group for CloudTrail management events",
    });
    new cdk.CfnOutput(this, "TrailArn", { value: trail.trailArn });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.bucketName,
      description: "Set as SONAR_MEDIA_BUCKET for the media upload/view routes",
    });
    new cdk.CfnOutput(this, "MediaUserPolicyJson", {
      value: cdk.Stack.of(this).toJsonString(mediaUserPolicy.toJSON()),
      description:
        "Least-privilege S3 policy to attach to the sonar-vercel IAM user",
    });
    new cdk.CfnOutput(this, "TableStreamArn", { value: table.tableStreamArn ?? "" });
    new cdk.CfnOutput(this, "DsqlClusterArn", { value: dsqlCluster.attrResourceArn });
    new cdk.CfnOutput(this, "DsqlEndpoint", {
      value: dsqlEndpoint,
      description: "Set as SONAR_DSQL_ENDPOINT for the Next server's account path",
    });
    new cdk.CfnOutput(this, "DsqlUserPolicyJson", {
      value: cdk.Stack.of(this).toJsonString(dsqlUserPolicy.toJSON()),
      description:
        "Least-privilege dsql:DbConnect policy to attach to the sonar-vercel IAM user",
    });
    new cdk.CfnOutput(this, "StripeWebhookUrl", {
      value: stripeWebhookUrl.url,
      description:
        "Register this as a Stripe webhook endpoint; put its signing secret in SSM " +
        stripeWebhookSecretParam,
    });
    new cdk.CfnOutput(this, "WsApiEndpoint", {
      value: wsStage.url,
      description: "wss:// URL for the radar client (set as NEXT_PUBLIC_WS_URL)",
    });
    new cdk.CfnOutput(this, "WsCallbackUrl", { value: wsStage.callbackUrl });
  }
}
