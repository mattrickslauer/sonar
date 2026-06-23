"use strict";

/**
 * Locked-channel hourly capacity meter.
 *
 * Trigger: an EventBridge rule on cron({minute:"0"}) — once per clock hour.
 * Job: for every ACTIVE locked channel, report one Stripe metered-usage record
 * with quantity = the channel's CURRENT MEMBER COUNT, so a locked channel is
 * billed per member per wall-clock hour it stays locked (capacity model). A
 * channel with 0 members bills 0; a cancelled channel (status flipped by the
 * webhook) is excluded and stops billing immediately.
 *
 * Idempotency: the Stripe usage record is sent with an Idempotency-Key of
 * usage:<channel>:<yyyymmddhh>, so EventBridge's at-least-once delivery (or a
 * retry) can't double-bill an hour — Stripe collapses identical keys for 24h.
 *
 * No Stripe SDK is bundled (the dsql layer only carries pg + the signer); the
 * usage record is POSTed with raw https, mirroring how the webhook hand-rolls
 * Stripe HMAC. The Stripe secret key is read from SSM at runtime.
 */
const https = require("node:https");
const { Client } = require("pg");
const { DsqlSigner } = require("@aws-sdk/dsql-signer");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const DSQL_ENDPOINT = process.env.DSQL_ENDPOINT;
const TABLE_NAME = process.env.TABLE_NAME;
const STRIPE_SECRET_PARAM = process.env.STRIPE_SECRET_PARAM;
const MARKER_TTL_SECONDS = 3 * 24 * 60 * 60; // observability marker lifetime

const ssm = new SSMClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
let cachedKey;

async function getStripeKey() {
  if (cachedKey) return cachedKey;
  const res = await ssm.send(
    new GetParameterCommand({ Name: STRIPE_SECRET_PARAM, WithDecryption: true })
  );
  cachedKey = res.Parameter?.Value || "";
  return cachedKey;
}

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

// Active locked channels + their live member count, in one relational query.
const SELECT_ACTIVE = `
  SELECT b.channel_id, b.subscription_item_id, count(m.account_id)::int AS members
  FROM channel_billing b
  JOIN channels c ON c.id = b.channel_id
  LEFT JOIN channel_members m ON m.channel_id = b.channel_id
  WHERE b.status IN ('active','trialing')
    AND b.subscription_item_id IS NOT NULL
    AND c.status = 'active'
  GROUP BY b.channel_id, b.subscription_item_id
`;

/** POST a Stripe metered usage record over raw https. Resolves on 2xx. */
function reportUsage(secret, itemId, quantity, timestamp, idempotencyKey) {
  const body = `quantity=${quantity}&timestamp=${timestamp}&action=increment`;
  const options = {
    method: "POST",
    hostname: "api.stripe.com",
    path: `/v1/subscription_items/${encodeURIComponent(itemId)}/usage_records`,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      "Idempotency-Key": idempotencyKey,
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`stripe ${res.statusCode}: ${data}`));
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Best-effort billed-hour marker (observability; the idempotency key is the
 *  real double-bill guard). */
async function writeMarker(channelId, hourKey, quantity, nowSec) {
  if (!TABLE_NAME) return;
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `CHUSAGE#${channelId}`,
      SK: `HOUR#${hourKey}`,
      quantity,
      billedAt: nowSec,
      ttl: nowSec + MARKER_TTL_SECONDS,
    },
  })).catch(() => {});
}

exports.handler = async () => {
  const secret = await getStripeKey();
  if (!secret) {
    console.error("stripe secret not set in SSM:", STRIPE_SECRET_PARAM);
    return { ok: false, error: "not configured" };
  }

  // Floor to the start of the current clock hour (UTC) for the usage timestamp
  // and the idempotency/marker key.
  const nowSec = Math.floor(Date.now() / 1000);
  const hourStart = nowSec - (nowSec % 3600);
  const d = new Date(hourStart * 1000);
  const hourKey =
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}` +
    `${String(d.getUTCHours()).padStart(2, "0")}`;

  const client = await dsqlConnect();
  let billed = 0;
  try {
    const res = await client.query(SELECT_ACTIVE);
    for (const row of res.rows || []) {
      const members = Number(row.members || 0);
      if (members <= 0) continue; // nothing to bill this hour
      const key = `usage:${row.channel_id}:${hourKey}`;
      try {
        await reportUsage(secret, row.subscription_item_id, members, hourStart, key);
        await writeMarker(row.channel_id, hourKey, members, nowSec);
        billed++;
      } catch (err) {
        // Don't let one channel's failure abort the rest; the idempotency key
        // makes a future retry safe.
        console.error(`usage report failed for ${row.channel_id}:`, err.message);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  console.log("channel-meter-tick", { hourKey, billed });
  return { ok: true, billed };
};
