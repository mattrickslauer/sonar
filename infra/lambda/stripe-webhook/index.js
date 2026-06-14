"use strict";

/**
 * Stripe webhook → DSQL subscription state.
 *
 * Trigger: a public Lambda Function URL (Stripe POSTs events here).
 * Job: verify the Stripe signature, then mirror subscription STATE into the
 * DSQL `subscriptions` table so the Next app can gate the permanent-waypoint
 * feature (hasActiveSubscription) without a Stripe round-trip.
 *
 * Security:
 *  - The Function URL is public (auth NONE) — Stripe must reach it — but every
 *    request is authenticated by HMAC-SHA256 signature verification against the
 *    webhook signing secret. An unsigned/forged request is rejected (400).
 *  - The signing secret is read from SSM Parameter Store at runtime (env
 *    WEBHOOK_SECRET_PARAM names it), so it never lives in git or the CFN
 *    template, and rotating it needs no redeploy.
 *  - We verify with Node's built-in crypto (no Stripe SDK to bundle) and read
 *    everything we need straight off the event's subscription object (status,
 *    price, period, metadata.account_id) — so no Stripe API key is needed here.
 *
 * DSQL: connects as the admin Postgres role via IAM auth, mirroring the meter
 * consumer. pg + @aws-sdk/dsql-signer come from the shared layer at
 * /opt/nodejs/node_modules. The upsert is idempotent (account_id PK), so
 * Stripe's at-least-once / out-of-order retries converge.
 */
const crypto = require("node:crypto");
const { Client } = require("pg");
const { DsqlSigner } = require("@aws-sdk/dsql-signer");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const REGION = process.env.AWS_REGION || "us-east-1";
const DSQL_ENDPOINT = process.env.DSQL_ENDPOINT;
const WEBHOOK_SECRET_PARAM = process.env.WEBHOOK_SECRET_PARAM;
// Reject events whose timestamp is older than this (replay protection).
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const ssm = new SSMClient({ region: REGION });
let cachedSecret;

/** Fetch + cache the webhook signing secret from SSM (decrypted). */
async function getWebhookSecret() {
  if (cachedSecret) return cachedSecret;
  const res = await ssm.send(
    new GetParameterCommand({ Name: WEBHOOK_SECRET_PARAM, WithDecryption: true })
  );
  cachedSecret = res.Parameter?.Value || "";
  return cachedSecret;
}

/**
 * Verify a Stripe-Signature header against the raw body, returning the parsed
 * event or throwing. Reimplements stripe.webhooks.constructEvent: signed payload
 * is `${t}.${rawBody}`, HMAC-SHA256 with the secret, compared to the v1 scheme.
 */
function constructEvent(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error("missing Stripe-Signature header");
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) throw new Error("malformed Stripe-Signature header");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("signature mismatch");
  }

  const age = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error("timestamp outside tolerance");
  }
  return JSON.parse(rawBody);
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

// Idempotent per-account upsert; mirrors src/lib/server/subscriptions.ts.
// Distinct $-placeholders per column even when values repeat (DSQL 42P08).
const UPSERT = `
  INSERT INTO subscriptions
    (account_id, stripe_customer_id, stripe_subscription_id, status,
     price_id, current_period_end, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, now())
  ON CONFLICT (account_id) DO UPDATE SET
    stripe_customer_id     = $7,
    stripe_subscription_id = $8,
    status                 = $9,
    price_id               = $10,
    current_period_end     = $11,
    updated_at             = now()
`;

// Status update keyed by customer, for events that lack our account_id metadata.
const UPDATE_BY_CUSTOMER = `
  UPDATE subscriptions
     SET status = $2, stripe_subscription_id = $3,
         current_period_end = $4, updated_at = now()
   WHERE stripe_customer_id = $1
`;

/** epoch-seconds → ISO timestamptz (or null). */
function toIso(sec) {
  return typeof sec === "number" && sec > 0
    ? new Date(sec * 1000).toISOString()
    : null;
}

/** A Stripe field that's an id string or an expanded object → the id. */
function asId(v) {
  if (!v) return null;
  return typeof v === "string" ? v : v.id || null;
}

/** current_period_end lives on the subscription (older API) or its item (newer). */
function periodEnd(sub) {
  if (typeof sub.current_period_end === "number") return sub.current_period_end;
  const item = sub.items && sub.items.data && sub.items.data[0];
  return item && typeof item.current_period_end === "number"
    ? item.current_period_end
    : null;
}

exports.handler = async (event) => {
  const secret = await getWebhookSecret();
  if (!secret) {
    console.error("webhook secret not set in SSM:", WEBHOOK_SECRET_PARAM);
    return { statusCode: 503, body: JSON.stringify({ error: "not configured" }) };
  }

  // Function URL (payload format 2.0): headers are lowercased; the body may be
  // base64-encoded. Verify against the EXACT raw bytes Stripe signed.
  const headers = event.headers || {};
  const sig = headers["stripe-signature"] || headers["Stripe-Signature"];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  let stripeEvent;
  try {
    stripeEvent = constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("signature verification failed:", err.message);
    return { statusCode: 400, body: JSON.stringify({ error: "invalid signature" }) };
  }

  let client;
  try {
    switch (stripeEvent.type) {
      case "checkout.session.completed": {
        const cs = stripeEvent.data.object;
        if (cs.mode !== "subscription") break;
        const accountId = cs.client_reference_id || (cs.metadata && cs.metadata.account_id) || null;
        const customerId = asId(cs.customer);
        const subscriptionId = asId(cs.subscription);
        if (!accountId || !customerId) break;
        // We don't fetch the subscription here (no API key); the
        // customer.subscription.created event that fires alongside carries the
        // authoritative status. Record the mapping with a provisional status.
        client = client || (await dsqlConnect());
        await client.query(UPSERT, [
          accountId, customerId, subscriptionId, "incomplete", null, null,
          customerId, subscriptionId, "incomplete", null, null,
        ]);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        const customerId = asId(sub.customer);
        if (!customerId) break;
        const accountId = sub.metadata && sub.metadata.account_id;
        const priceId =
          sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
            ? sub.items.data[0].price.id
            : null;
        const pEnd = toIso(periodEnd(sub));
        client = client || (await dsqlConnect());
        if (accountId) {
          await client.query(UPSERT, [
            accountId, customerId, sub.id, sub.status, priceId, pEnd,
            customerId, sub.id, sub.status, priceId, pEnd,
          ]);
        } else {
          await client.query(UPDATE_BY_CUSTOMER, [customerId, sub.status, sub.id, pEnd]);
        }
        break;
      }
      default:
        // Acknowledge unhandled types so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // Processing error → 500 so Stripe retries (the handler is idempotent).
    console.error(`handler failed for ${stripeEvent.type}:`, err);
    return { statusCode: 500, body: JSON.stringify({ error: "handler error" }) };
  } finally {
    if (client) await client.end().catch(() => {});
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
