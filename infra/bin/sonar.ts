#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SonarStack } from "../lib/sonar-stack";
import { SonarWebStack } from "../lib/web-stack";

const app = new cdk.App();

// All Sonar resources live in us-east-1 (co-located with Bedrock on-demand).
new SonarStack(app, "SonarStack", {
  env: { region: "us-east-1" },
  description: "Sonar data layer: DynamoDB live path + Aurora DSQL system-of-record",
});

// The Next.js web app (formerly on Vercel). Deploy with infra/scripts/web-deploy.sh.
new SonarWebStack(app, "SonarWebStack", {
  env: { region: "us-east-1" },
  description: "Sonar web: Next.js standalone on Lambda behind CloudFront",
});

// Tag every taggable resource in the app. Propagates to the table, the DSQL
// cluster, the Lambdas, the EventBridge rule, etc.
cdk.Tags.of(app).add("project", "aws-hackathon");
cdk.Tags.of(app).add("app", "sonar");
