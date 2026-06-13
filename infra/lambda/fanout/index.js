"use strict";

/**
 * Live fan-out.
 *
 * Trigger: DynamoDB stream, INSERT records on the `sonar` table.
 * Job: when a new waypoint lands, push it to every socket subscribed to its
 * channel (Query `CONN#<channel>` → postToConnection each) and emit a
 * `USAGE#` messages_delivered event for the meter consumer.
 *
 * Stale connections (410 Gone) are pruned as we hit them.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");

const TABLE = process.env.TABLE_NAME || "sonar";
const REGION = process.env.AWS_REGION || "us-east-1";
const WS_ENDPOINT = process.env.WS_ENDPOINT; // https callback url for the stage
const USAGE_TTL_SECONDS = 48 * 60 * 60;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const mgmt = WS_ENDPOINT
  ? new ApiGatewayManagementApiClient({ region: REGION, endpoint: WS_ENDPOINT })
  : null;

function hourBucket(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

// Stream NewImage (attribute-typed) → the normalized payload the radar client
// consumes. Layout (bearing/meters/age) is computed client-side per viewer.
function payloadFromImage(img) {
  return {
    id: img.id?.S,
    channel: img.channel?.S,
    kind: img.kind?.S || "text",
    author: img.author?.S || "anon",
    text: img.text?.S || "",
    lat: Number(img.lat?.N),
    lng: Number(img.lng?.N),
    createdAt: Number(img.createdAt?.N),
    ttl: Number(img.ttl?.N || "0") || undefined,
    love: Number(img.love?.N || "0"),
    sponsored: img.sponsored?.BOOL === true,
    sponsor: img.sponsor?.S,
    actorType: img.actorType?.S || "human",
    // S3 object key for photo/video/voice drops; the client resolves it to a
    // presigned URL via /api/media/view. Omitted (undefined) for text drops.
    mediaKey: img.mediaKey?.S,
  };
}

async function connectionsForChannel(channel) {
  const ids = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :cid)",
      ExpressionAttributeValues: { ":pk": `CONN#${channel}`, ":cid": "CID#" },
      ExclusiveStartKey,
    }));
    for (const it of res.Items || []) ids.push(it.connId);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return ids;
}

async function push(channel, connId, body) {
  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connId,
      Data: Buffer.from(body),
    }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 410 || err?.name === "GoneException") {
      // Socket is gone — prune both the channel row and its GSI mirror source.
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `CONN#${channel}`, SK: `CID#${connId}` },
      })).catch(() => {});
      return false;
    }
    console.error("postToConnection failed", { connId, err: err?.name });
    return false;
  }
}

exports.handler = async (event) => {
  if (!mgmt) {
    console.error("WS_ENDPOINT not configured; cannot fan out");
    return { ok: false };
  }

  for (const record of event.Records || []) {
    if (record.eventName !== "INSERT") continue;
    const sk = record.dynamodb?.Keys?.SK?.S || "";
    if (!sk.startsWith("WP#")) continue; // only waypoints fan out

    const wp = payloadFromImage(record.dynamodb?.NewImage || {});
    if (!wp.channel || !wp.id) continue;

    const connIds = await connectionsForChannel(wp.channel);
    if (connIds.length === 0) continue;

    const body = JSON.stringify({ type: "waypoint", waypoint: wp });
    const results = await Promise.all(connIds.map((id) => push(wp.channel, id, body)));
    const delivered = results.filter(Boolean).length;

    console.log("fanout", { channel: wp.channel, id: wp.id, delivered });

    // Metering: count messages actually delivered this hour for the channel.
    if (delivered > 0) {
      const now = Date.now();
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USAGE#${wp.channel}#${hourBucket(now)}`,
          SK: `EVT#${now}#${wp.id}`,
          type: "message",
          units: delivered,
          channel: wp.channel,
          ttl: Math.floor(now / 1000) + USAGE_TTL_SECONDS,
        },
      })).catch((e) => console.error("usage emit failed", e?.name));
    }
  }
  return { ok: true };
};
