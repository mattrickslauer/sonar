import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

/**
 * Sonar web host: the Next.js standalone server on one Lambda (via the AWS
 * Lambda Web Adapter) behind CloudFront.
 *
 * The server reaches DynamoDB, S3, DSQL, Bedrock and Rekognition as its own
 * execution role (`sonar-web-server`), never with stored access keys: any
 * SONAR_AWS_* / AWS_* keys in the env file are dropped.
 *
 * Built by infra/scripts/web-deploy.sh, which assembles the bundle in
 * infra/web-bundle/ and passes the runtime env file + optional cert.
 * Context:
 *   webEnvFile  dotenv file with the server's runtime env (never committed)
 *   certArn     us-east-1 ACM cert for mysonar.zone (+ www); omit to serve
 *               on the bare CloudFront domain only
 */
export interface SonarWebStackProps extends cdk.StackProps {
  table: dynamodb.ITable;
  mediaBucket: s3.IBucket;
  dsqlClusterArn: string;
}

/** Stack-owned settings the env file must not override. */
const DROPPED_ENV = /^(AWS_|SONAR_AWS_)/;

export class SonarWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SonarWebStackProps) {
    super(scope, id, props);

    const bundle = path.join(__dirname, "..", "web-bundle");
    const envFile = this.node.tryGetContext("webEnvFile");
    const certArn = this.node.tryGetContext("certArn");

    // A fixed name so DSQL can bind the sonar_app role to it
    // (infra/sql/000_app_role.sql: AWS IAM GRANT sonar_app TO '<role arn>').
    const role = new iam.Role(this, "ServerRole", {
      roleName: "sonar-web-server",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    });
    props.table.grantReadWriteData(role);
    role.addToPolicy(new iam.PolicyStatement({
      sid: "SonarMediaObjectRW",
      actions: ["s3:PutObject", "s3:GetObject"],
      resources: [props.mediaBucket.arnForObjects("media/*"), props.mediaBucket.arnForObjects("tenants/*")],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      sid: "SonarDsqlConnect",
      actions: ["dsql:DbConnect"],
      resources: [props.dsqlClusterArn],
    }));
    // "Ask the place": Claude on Bedrock through a cross-region inference
    // profile, which routes to the foundation model in any US region.
    role.addToPolicy(new iam.PolicyStatement({
      sid: "SonarBedrockInvoke",
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));
    // Sonar Platform photo moderation (SONAR_MODERATION=rekognition); the action
    // has no resource-level permissions.
    role.addToPolicy(new iam.PolicyStatement({
      sid: "SonarPlatformModeration",
      actions: ["rekognition:DetectModerationLabels"],
      resources: ["*"],
    }));

    const fn = new lambda.Function(this, "Server", {
      role,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset(bundle),
      handler: "run.sh",
      memorySize: 1536,
      timeout: cdk.Duration.seconds(30),
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "WebAdapter",
          `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:25`,
        ),
      ],
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        PORT: "3000",
        AWS_LWA_READINESS_CHECK_PATH: "/robots.txt",
        NODE_ENV: "production",
        ...(envFile ? parseEnv(envFile) : {}),
        SONAR_TABLE: props.table.tableName,
        SONAR_MEDIA_BUCKET: props.mediaBucket.bucketName,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    const origin = new origins.FunctionUrlOrigin(url);

    const domainNames = certArn ? ["mysonar.zone", "www.mysonar.zone"] : undefined;
    const dist = new cloudfront.Distribution(this, "Cdn", {
      comment: "mysonar.zone",
      domainNames,
      certificate: certArn
        ? acm.Certificate.fromCertificateArn(this, "Cert", certArn)
        : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        "/_next/static/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", { value: dist.distributionDomainName });
    new cdk.CfnOutput(this, "FunctionUrl", { value: url.url });
  }
}

/** Minimal dotenv reader: KEY=VALUE lines, optional surrounding quotes. */
function parseEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || DROPPED_ENV.test(m[1])) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/\\n/g, "\n");
  }
  return out;
}
