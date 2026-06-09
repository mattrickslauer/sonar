#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SonarStack } from "../lib/sonar-stack";

const app = new cdk.App();

// All Sonar resources live in us-east-1 (co-located with Bedrock on-demand).
new SonarStack(app, "SonarStack", {
  env: { region: "us-east-1" },
  description: "Sonar data layer: DynamoDB live path + Aurora DSQL system-of-record",
});
