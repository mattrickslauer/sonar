"use strict";

/**
 * Usage metering rollup.
 *
 * Trigger: DynamoDB stream, INSERT records on the `sonar` table.
 * Job: aggregate raw connect/message usage events (PK = `USAGE#<channel>#<hour>`,
 * written by ws-disconnect and fanout) into the DSQL `usage_rollups` table that
 * feeds Stripe metered billing, via an atomic per-(channel, period) upsert.
 *
 * Bot-origin events are excluded upstream (bots are not billed). DSQL deps
 * (pg, @aws-sdk/dsql-signer) come from the shared layer at /opt/nodejs/node_modules.
 */
const { Client } = require("pg");
const { DsqlSigner } = require("@aws-sdk/dsql-signer");

const REGION = process.env.AWS_REGION || "us-east-1";
const DSQL_ENDPOINT = process.env.DSQL_ENDPOINT;

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

// yyyymmddhh (UTC) → ISO timestamptz for the period_start key.
function bucketToTimestamp(bucket) {
  const y = bucket.slice(0, 4), mo = bucket.slice(4, 6), d = bucket.slice(6, 8), h = bucket.slice(8, 10);
  return `${y}-${mo}-${d}T${h}:00:00Z`;
}

const UPSERT = `
  INSERT INTO usage_rollups (channel_id, period_start, connection_minutes, messages_delivered)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (channel_id, period_start) DO UPDATE SET
    connection_minutes = usage_rollups.connection_minutes + EXCLUDED.connection_minutes,
    messages_delivered = usage_rollups.messages_delivered + EXCLUDED.messages_delivered
`;

exports.handler = async (event) => {
  const rollups = [];
  for (const record of event.Records || []) {
    if (record.eventName !== "INSERT") continue;
    const pk = record.dynamodb?.Keys?.PK?.S || "";
    if (!pk.startsWith("USAGE#")) continue; // only metering events

    // PK = USAGE#<channel>#<yyyymmddhh>
    const parts = pk.split("#");
    const channel = parts[1];
    const bucket = parts[2];
    if (!channel || !bucket) continue;

    const img = record.dynamodb?.NewImage || {};
    const type = img.type?.S;
    const units = Number(img.units?.N || "0");
    if (!units) continue;

    rollups.push({
      channel,
      period: bucketToTimestamp(bucket),
      connMinutes: type === "connection" ? units : 0,
      messages: type === "message" ? units : 0,
    });
  }

  if (rollups.length === 0) return { ok: true, rolled: 0 };

  const client = await dsqlConnect();
  let rolled = 0;
  try {
    for (const r of rollups) {
      await client.query(UPSERT, [r.channel, r.period, r.connMinutes, r.messages]);
      rolled++;
    }
  } finally {
    await client.end().catch(() => {});
  }

  console.log("meter", { rolled });
  return { ok: true, rolled };
};
