// Server-only: the shared DynamoDB document client + table name. Centralizes the
// SONAR_-prefixed credential/region config (see the note in waypoints.ts) so
// every server module talks to the same table the same way.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
export const TABLE = process.env.SONAR_TABLE ?? "sonar";

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;

export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: REGION,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);
