import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

/**
 * Sonar web host: the Next.js standalone server on one Lambda (via the AWS
 * Lambda Web Adapter) behind CloudFront. Replaces the Vercel deployment.
 *
 * Built by infra/scripts/web-deploy.sh, which assembles the bundle in
 * infra/web-bundle/ and passes the runtime env file + optional cert.
 * Context:
 *   webEnvFile  dotenv file with the server's runtime env (never committed)
 *   certArn     us-east-1 ACM cert for mysonar.zone (+ www); omit to serve
 *               on the bare CloudFront domain only
 */
export class SonarWebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bundle = path.join(__dirname, "..", "web-bundle");
    const envFile = this.node.tryGetContext("webEnvFile");
    const certArn = this.node.tryGetContext("certArn");

    const fn = new lambda.Function(this, "Server", {
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
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/\\n/g, "\n");
  }
  return out;
}
