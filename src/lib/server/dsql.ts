// Server-only: the Next/Vercel server's connection to Aurora DSQL — the
// relational system-of-record (accounts and other durable user data). The hot,
// ephemeral path stays in DynamoDB (see ./waypoints.ts); anything that must
// outlive a 24h TTL lives here.
//
// SECURITY POSTURE (hardened vs. the meter Lambda in infra/lambda/meter):
//   - Connects as a LEAST-PRIVILEGE, non-admin Postgres role (default
//     `sonar_app`) authed via `dsql:DbConnect` — NOT the `admin` role /
//     `dsql:DbConnectAdmin`. The role is created + IAM-linked in
//     infra/sql/000_app_role.sql and granted only the table privileges it needs
//     in infra/sql/001_accounts_auth.sql. Override with SONAR_DSQL_USER=admin
//     only for a throwaway local spike.
//   - Verifies TLS (`rejectUnauthorized: true`) — DSQL's cert chains to an
//     Amazon root CA already in Node's trust store. The Lambda code disables
//     verification; we do not.
//   - IAM auth tokens are short-lived (~15 min). We pass `password` as an async
//     function so node-postgres mints a FRESH token for every new physical
//     connection — no stale-token reconnect failures, no token kept in memory.
//   - No secret in env: auth is the caller's IAM identity (the scoped
//     `sonar-vercel` user via SONAR_AWS_*), the same credentials the DynamoDB
//     path already uses.
import { setDefaultResultOrder } from "node:dns";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

// Prefer IPv4 for DSQL: the endpoint resolves to A + AAAA records, and on
// networks without an IPv6 route the AAAA attempt fails with ENETUNREACH and
// wastes time before falling back. IPv4-first avoids that.
setDefaultResultOrder("ipv4first");

// Mirror waypoints.ts: SONAR_-prefixed config, never the bare AWS_* names that
// Vercel/Lambda reserve and inject for their own account.
const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const ENDPOINT = process.env.SONAR_DSQL_ENDPOINT; // <cluster-id>.dsql.<region>.on.aws
const DATABASE = process.env.SONAR_DSQL_DATABASE ?? "postgres";
const USER = process.env.SONAR_DSQL_USER ?? "sonar_app";
// Small pool: Vercel functions are single-request-at-a-time per instance, and
// DSQL connections are cheap to (re)open. Keep it tight so we don't fan out
// idle connections across warm containers.
const MAX = Number(process.env.SONAR_DSQL_POOL_MAX ?? "2");

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;
// Explicit creds in hosted envs; omit to use the default chain (~/.aws) locally.
const credentials =
  accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

/** Whether DSQL is configured. Account features degrade gracefully when not. */
export function dsqlConfigured(): boolean {
  return Boolean(ENDPOINT);
}

let signer: DsqlSigner | undefined;
function getSigner(): DsqlSigner {
  if (!signer) {
    signer = new DsqlSigner({
      hostname: ENDPOINT!,
      region: REGION,
      ...(credentials ? { credentials } : {}),
    });
  }
  return signer;
}

// `admin` uses the privileged token endpoint; every other role (our default
// `sonar_app`) uses the standard, least-privilege one.
async function freshToken(): Promise<string> {
  const s = getSigner();
  return USER === "admin"
    ? s.getDbConnectAdminAuthToken()
    : s.getDbConnectAuthToken();
}

let pool: Pool | undefined;

/** Lazily-built singleton pool. Throws if DSQL isn't configured. */
function getPool(): Pool {
  if (!ENDPOINT) {
    throw new Error(
      "DSQL is not configured: set SONAR_DSQL_ENDPOINT (the CDK DsqlEndpoint output).",
    );
  }
  if (!pool) {
    pool = new Pool({
      host: ENDPOINT,
      port: 5432,
      database: DATABASE,
      user: USER,
      // Async password → node-postgres calls this per new connection, so each
      // physical socket authenticates with a freshly-minted (non-stale) token.
      password: freshToken,
      ssl: { rejectUnauthorized: true },
      max: Number.isFinite(MAX) && MAX > 0 ? MAX : 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Belt-and-braces: cap any single statement so a hung query can't pin a
      // serverless function for its whole timeout.
      statement_timeout: 10_000,
      application_name: "sonar-web",
    });
    // A pooled connection erroring in the background must not crash the process.
    pool.on("error", (err) => {
      console.error("DSQL pool error", err);
    });
  }
  return pool;
}

// Connection-level errors worth retrying: a DSQL endpoint resolves to several
// frontend IPs and an individual one can be transiently unreachable or reset.
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "EPIPE",
]);

function isTransient(err: unknown): boolean {
  const e = err as { code?: string; errors?: unknown[] };
  if (e?.code && TRANSIENT_CODES.has(e.code)) return true;
  // node's connect() to a multi-address host throws an AggregateError whose
  // `errors` hold the per-IP failures.
  if (Array.isArray(e?.errors)) return e.errors.some(isTransient);
  return false;
}

/** Retry a unit of DB work on transient connection failures (NOT on query
 *  errors, which would re-run side effects). Each attempt acquires a fresh
 *  pooled connection, so a bad IP is retried against a new one. */
async function withConnRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Run a parameterized query. ALWAYS pass values via `params` ($1, $2, …) — never
 * interpolate into the SQL string — so the driver parameterizes and SQL
 * injection is structurally impossible. Transient connection failures are
 * retried; query errors propagate immediately.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return withConnRetry(() => getPool().query<T>(text, params as never[]));
}

/**
 * Run several statements on a single connection inside a transaction. The
 * callback gets a dedicated client; we COMMIT on success, ROLLBACK on throw,
 * and always release the connection back to the pool.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await withConnRetry(() => getPool().connect());
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Liveness probe — `SELECT 1`. Returns true if the cluster is reachable. */
export async function ping(): Promise<boolean> {
  const res = await query<{ ok: number }>("SELECT 1 AS ok");
  return res.rows[0]?.ok === 1;
}
