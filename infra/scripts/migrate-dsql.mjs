// Apply the Sonar DSQL schema (the tables the promote + meter consumers write).
//
// Usage:
//   node infra/scripts/migrate-dsql.mjs --endpoint <cluster>.dsql.us-east-1.on.aws
//   node infra/scripts/migrate-dsql.mjs            # auto-reads CFN output DsqlEndpoint
//
// DSQL is Postgres-compatible but does NOT support foreign keys or sequences,
// and requires the primary key inline at CREATE TABLE. The DDL below is written
// to those constraints; the richer relational model in docs/data-model.md
// (accounts/channels/subscriptions/invoices) can be layered on later.
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

const REGION = process.env.AWS_REGION || "us-east-1";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function resolveEndpoint() {
  const explicit = arg("endpoint") || process.env.DSQL_ENDPOINT;
  if (explicit) return explicit;
  // Fall back to the deployed stack's output.
  const out = execFileSync("aws", [
    "cloudformation", "describe-stacks",
    "--stack-name", "SonarStack",
    "--query", "Stacks[0].Outputs[?OutputKey=='DsqlEndpoint'].OutputValue",
    "--output", "text",
    "--region", REGION,
  ]).toString().trim();
  if (!out || out === "None") {
    throw new Error("Could not resolve DSQL endpoint. Pass --endpoint <host>.");
  }
  return out;
}

const STATEMENTS = [
  // The promoted "greatest hits" archive. waypoint_id is the idempotency key
  // from the stream, so it doubles as the primary key (ON CONFLICT target).
  `CREATE TABLE IF NOT EXISTS greatest_hits (
     waypoint_id        text PRIMARY KEY,
     channel_id         text,
     lat                double precision NOT NULL,
     lng                double precision NOT NULL,
     geohash            text NOT NULL,
     author             text,
     kind               text NOT NULL,
     text               text,
     love_at_promotion  integer NOT NULL,
     promoted_at        timestamptz NOT NULL DEFAULT now()
   )`,
  // Metered usage, one row per (channel, hour), atomically incremented.
  `CREATE TABLE IF NOT EXISTS usage_rollups (
     channel_id          text NOT NULL,
     period_start        timestamptz NOT NULL,
     connection_minutes  numeric NOT NULL DEFAULT 0,
     messages_delivered  bigint NOT NULL DEFAULT 0,
     PRIMARY KEY (channel_id, period_start)
   )`,
];

async function main() {
  const host = resolveEndpoint();
  console.log(`Connecting to DSQL: ${host}`);
  const signer = new DsqlSigner({ hostname: host, region: REGION });
  const token = await signer.getDbConnectAdminAuthToken();
  const client = new Client({
    host, port: 5432, user: "admin", database: "postgres",
    password: token, ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      // DSQL allows one DDL statement per transaction — run them individually.
      await client.query(sql);
      console.log("applied:", sql.split("\n")[0].trim(), "…");
    }
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log("public tables:", rows.map((r) => r.table_name).join(", "));
  } finally {
    await client.end();
  }
  console.log("DSQL migration complete.");
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
