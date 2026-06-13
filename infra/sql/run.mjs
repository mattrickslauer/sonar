// Aurora DSQL migration runner.
//
// Usage (from repo root, with AWS creds for the cluster's region on the
// default chain or via SONAR_AWS_*):
//   SONAR_DSQL_ENDPOINT=<cluster>.dsql.us-east-1.on.aws node infra/sql/run.mjs infra/sql/000_app_role.sql
//   node infra/sql/run.mjs --ping
//
// Connects as `admin` (migrations create roles, tables, indexes — privileged).
// Executes each statement on its OWN connection.query() call, because DSQL
// allows only one DDL statement per transaction and forbids mixing DDL + DML.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const ENDPOINT = process.env.SONAR_DSQL_ENDPOINT;
if (!ENDPOINT) {
  console.error("Set SONAR_DSQL_ENDPOINT (the CDK DsqlEndpoint output).");
  process.exit(1);
}

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;
const credentials =
  accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

async function connect() {
  const signer = new DsqlSigner({
    hostname: ENDPOINT,
    region: REGION,
    ...(credentials ? { credentials } : {}),
  });
  const client = new Client({
    host: ENDPOINT,
    port: 5432,
    user: "admin",
    database: "postgres",
    password: () => signer.getDbConnectAdminAuthToken(),
    // Verified TLS — DSQL's cert chains to an Amazon root CA in Node's store.
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

// Split a .sql file into individual statements: drop `--` line comments, then
// split on `;`. Adequate for our controlled migration files (no semicolons
// inside string literals).
function statements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const file = process.argv[2];

if (file === "--ping") {
  const client = await connect();
  try {
    const r = await client.query("SELECT 1 AS ok");
    console.log("DSQL reachable:", r.rows[0]?.ok === 1);
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(0);
}

if (!file) {
  console.error("Pass a .sql file path, or --ping.");
  process.exit(1);
}

const stmts = statements(readFileSync(file, "utf8"));
const client = await connect();
let ok = 0;
try {
  for (const stmt of stmts) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    try {
      await client.query(stmt); // own (implicit) transaction per statement
      ok++;
      console.log("  ✓", preview);
    } catch (err) {
      console.error("  ✗", preview, "\n    ", err.message);
      throw err;
    }
  }
  console.log(`Applied ${ok}/${stmts.length} statements from ${file}.`);
} finally {
  await client.end().catch(() => {});
}
