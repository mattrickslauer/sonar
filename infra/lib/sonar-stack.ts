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

/**
 * Sonar data layer.
 *
 * See docs/data-model.md for the full design. In short:
 *  - One on-demand DynamoDB table `sonar` is the high-write ephemeral path
 *    (waypoints, presence, connections, membership, usage). 24h TTL on `ttl`,
 *    a NEW_AND_OLD_IMAGES stream drives fan-out / promotion / metering.
 *  - GSI1 serves the reverse lookups ("my drops", "channels I'm in").
 *  - Aurora DSQL is the relational system-of-record (greatest-hits archive,
 *    usage rollups, billing).
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

    // ---------------------------------------------------------------------
    // Stream consumers (stubs — handlers in infra/lambda/*)
    // ---------------------------------------------------------------------
    const commonEnv = {
      TABLE_NAME: table.tableName,
      DSQL_ENDPOINT: dsqlEndpoint,
    };

    const makeFn = (name: string, dir: string, env: Record<string, string> = {}) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", dir)),
        timeout: cdk.Duration.seconds(30),
        environment: { ...commonEnv, ...env },
      });

    // Live fan-out: stream INSERT of a waypoint → push to channel subscribers.
    const fanout = makeFn("FanoutConsumerFn", "fanout");
    table.grantReadData(fanout); // reads CONN#<channel> to find subscribers
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

    // Promotion: stream MODIFY where realLove crosses threshold AND human →
    // upsert into DSQL greatest_hits, and flag the source item promoted=true.
    const promote = makeFn("PromoteConsumerFn", "promote", { PROMOTE_THRESHOLD: "40" });
    table.grantReadWriteData(promote);
    promote.addToRolePolicy(dsqlConnect);
    promote.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 25,
        retryAttempts: 3,
        bisectBatchOnError: true,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual("MODIFY"),
          }),
        ],
      })
    );

    // Metering: stream INSERT of USAGE#... events → atomic rollup → DSQL.
    const meter = makeFn("MeterConsumerFn", "meter");
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
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "TableStreamArn", { value: table.tableStreamArn ?? "" });
    new cdk.CfnOutput(this, "DsqlClusterArn", { value: dsqlCluster.attrResourceArn });
    new cdk.CfnOutput(this, "DsqlEndpoint", { value: dsqlEndpoint });
  }
}
