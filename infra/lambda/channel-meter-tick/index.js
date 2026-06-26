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
// The Stripe Billing Meter event_name the channel price is backed by. Member-
// hours are reported as meter events carrying this name + the channel's customer.
const METER_EVENT = process.env.STRIPE_CHANNEL_METER_EVENT || "sonar_channel_member_hours";
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

// Active locked channels + their dedicated customer + live member count.
const SELECT_ACTIVE = `
  SELECT b.channel_id, b.stripe_customer_id, count(m.account_id)::int AS members
  FROM channel_billing b
  JOIN channels c ON c.id = b.channel_id
  LEFT JOIN channel_members m ON m.channel_id = b.channel_id
  WHERE b.status IN ('active','trialing')
    AND b.stripe_customer_id IS NOT NULL
    AND c.status = 'active'
  GROUP BY b.channel_id, b.stripe_customer_id
`;

/**
 * Report member-hours as a Stripe Billing Meter EVENT (the flexible-billing
 * model; usage records are deprecated). The event carries the channel's
 * dedicated customer id, so Stripe attributes it to that channel's subscription.
 * `identifier` makes it idempotent per channel-hour (Stripe dedupes repeats).
 */
function reportMeterEvent(secret, customerId, value, timestamp, identifier) {
  const body =
    `event_name=${encodeURIComponent(METER_EVENT)}` +
    `&timestamp=${timestamp}` +
    `&identifier=${encodeURIComponent(identifier)}` +
    `&payload[value]=${value}` +
    `&payload[stripe_customer_id]=${encodeURIComponent(customerId)}`;
  const options = {
    method: "POST",
    hostname: "api.stripe.com",
    path: `/v1/billing/meter_events`,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
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
      const identifier = `usage:${row.channel_id}:${hourKey}`;
      try {
        await reportMeterEvent(secret, row.stripe_customer_id, members, hourStart, identifier);
        await writeMarker(row.channel_id, hourKey, members, nowSec);
        billed++;
      } catch (err) {
        // Don't let one channel's failure abort the rest; the identifier makes a
        // future retry safe (Stripe dedupes meter events by identifier).
        console.error(`meter event failed for ${row.channel_id}:`, err.message);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  console.log("channel-meter-tick", { hourKey, billed });
  return { ok: true, billed };
};
