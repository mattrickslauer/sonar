"use strict";

/**
 * WebSocket $disconnect.
 *
 * Find every `CONN#<channel>` row for this socket via GSI1 (GSI1PK =
 * `CONN#<connId>`), delete them, and emit a per-channel `USAGE#` connection
 * event (connection_minutes) so the meter consumer can roll it into billing.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.TABLE_NAME || "sonar";
const REGION = process.env.AWS_REGION || "us-east-1";
const USAGE_TTL_SECONDS = 48 * 60 * 60;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// UTC hour bucket yyyymmddhh — the rollup period key shared with fanout/meter.
function hourBucket(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

exports.handler = async (event) => {
  const connId = event.requestContext?.connectionId;
  if (!connId) return { statusCode: 400, body: "no connection id" };

  const found = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :c",
    ExpressionAttributeValues: { ":c": `CONN#${connId}` },
  }));
  const items = found.Items || [];
  if (items.length === 0) return { statusCode: 200, body: "nothing to clean" };

  const now = Date.now();
  const connectedAt = Math.min(...items.map((it) => Number(it.connectedAt) || now));
  const minutes = Math.max(0, (now - connectedAt) / 60000);
  const bucket = hourBucket(now);

  // Delete the connection rows.
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: chunk.map((it) => ({ DeleteRequest: { Key: { PK: it.PK, SK: it.SK } } })),
      },
    }));
  }

  // Emit a connection-minutes usage event per channel this socket subscribed to.
  if (minutes > 0) {
    await Promise.all(items.map((it, i) =>
      ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USAGE#${it.channel}#${bucket}`,
          SK: `EVT#${now}#${connId}#${i}`,
          type: "connection",
          units: minutes,
          channel: it.channel,
          ttl: Math.floor(now / 1000) + USAGE_TTL_SECONDS,
        },
      }))
    ));
  }

  console.log("ws disconnect", { connId, channels: items.length, minutes });
  return { statusCode: 200, body: "disconnected" };
};
