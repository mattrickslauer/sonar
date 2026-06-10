"use strict";

/**
 * Promotion — "earned permanence".
 *
 * Trigger: DynamoDB stream, MODIFY records on the `sonar` table.
 * Job: when a *human* waypoint's realLove crosses the threshold (rising edge
 * only), copy it into the DSQL `greatest_hits` archive (idempotent on
 * waypoint_id) and flag the source item promoted=true.
 *
 * Bots never promote: they only touch the display `love` counter, never
 * `realLove`, and we hard-gate on actorType here as a second guard.
 *
 * DSQL deps (pg, @aws-sdk/dsql-signer) come from the shared layer at
 * /opt/nodejs/node_modules.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { Client } = require("pg");
const { DsqlSigner } = require("@aws-sdk/dsql-signer");

const TABLE = process.env.TABLE_NAME || "sonar";
const REGION = process.env.AWS_REGION || "us-east-1";
const DSQL_ENDPOINT = process.env.DSQL_ENDPOINT;
const THRESHOLD = Number(process.env.PROMOTE_THRESHOLD || "40");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function dsqlConnect() {
  const signer = new DsqlSigner({ hostname: DSQL_ENDPOINT, region: REGION });
  const token = await signer.getDbConnectAdminAuthToken();
  const client = new Client({
    host: DSQL_ENDPOINT,
    port: 5432,
    user: "admin",
    database: "postgres",
    password: token,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

const INSERT_HIT = `
  INSERT INTO greatest_hits
    (waypoint_id, channel_id, lat, lng, geohash, author, kind, text, love_at_promotion)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (waypoint_id) DO NOTHING
`;

exports.handler = async (event) => {
  // Collect the crossing-edge promotions first, so we only pay for a DSQL
  // connection when there's real work in the batch.
  const toPromote = [];
  for (const record of event.Records || []) {
    if (record.eventName !== "MODIFY") continue;
    const keys = record.dynamodb?.Keys || {};
    const sk = keys.SK?.S || "";
    if (!sk.startsWith("WP#")) continue;

    const img = record.dynamodb?.NewImage || {};
    const old = record.dynamodb?.OldImage || {};
    if (img.actorType?.S !== "human") continue; // bots never promote

    const now = Number(img.realLove?.N || "0");
    const before = Number(old.realLove?.N || "0");
    // Only the crossing edge: was below, now at/above. Avoids re-promoting on
    // every subsequent love and on at-least-once stream redelivery.
    if (before >= THRESHOLD || now < THRESHOLD) continue;

    toPromote.push({
      pk: keys.PK.S,
      sk,
      waypointId: img.id?.S,
      channel: img.channel?.S,
      lat: Number(img.lat?.N),
      lng: Number(img.lng?.N),
      geohash: img.gh9?.S || img.gh6?.S || "",
      author: img.author?.S || "anon",
      kind: img.kind?.S || "text",
      text: img.text?.S || "",
      realLove: now,
    });
  }

  if (toPromote.length === 0) return { ok: true, promoted: 0 };

  const client = await dsqlConnect();
  let promoted = 0;
  try {
    for (const w of toPromote) {
      await client.query(INSERT_HIT, [
        w.waypointId, w.channel, w.lat, w.lng, w.geohash,
        w.author, w.kind, w.text, w.realLove,
      ]);
      // Flag the source row so the UI can render the ★ and we don't reprocess.
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: w.pk, SK: w.sk },
        UpdateExpression: "SET promoted = :t",
        ExpressionAttributeValues: { ":t": true },
      }));
      promoted++;
      console.log("promoted", { waypointId: w.waypointId, realLove: w.realLove });
    }
  } finally {
    await client.end().catch(() => {});
  }

  return { ok: true, promoted };
};
