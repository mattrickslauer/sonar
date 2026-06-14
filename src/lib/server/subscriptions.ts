// Server-only: durable subscription state in Aurora DSQL — the app's mirror of
// Stripe's billing authority. Written by the webhook (/api/billing/webhook),
// read by the permanent-waypoint gate (POST /api/waypoints) and the status
// endpoint. One row per account (account_id PK); see infra/sql/003_subscriptions.sql.
import { query } from "@/lib/server/dsql";

export interface Subscription {
  accountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  priceId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

// Stripe statuses that entitle the user to the paid feature. `trialing` counts
// (a trial is a live, paid-intent subscription); `past_due` deliberately does
// NOT — access lapses the moment payment fails, and returns on recovery.
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/** Whether a Stripe subscription status grants paid access. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status);
}

const SERIALIZATION_FAILURE = "40001"; // DSQL OCC conflict

const SELECT_COLS = `
  account_id AS "accountId", stripe_customer_id AS "stripeCustomerId",
  stripe_subscription_id AS "stripeSubscriptionId", status,
  price_id AS "priceId", current_period_end AS "currentPeriodEnd",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

/** Retry a unit of work on DSQL optimistic-concurrency conflicts (mirrors
 *  accounts.ts): DSQL aborts conflicting txns at commit rather than blocking. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if ((err as { code?: string })?.code === SERIALIZATION_FAILURE) continue;
      throw err;
    }
  }
  throw lastErr;
}

/** This account's subscription row, or null if they never started checkout. */
export async function getSubscriptionByAccount(
  accountId: string,
): Promise<Subscription | null> {
  const res = await query<Subscription>(
    `SELECT ${SELECT_COLS} FROM subscriptions WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

/** Look up by Stripe customer id — the webhook's join key for subscription.*
 *  events, which carry the customer but not our account_id (except in metadata). */
export async function getSubscriptionByCustomer(
  stripeCustomerId: string,
): Promise<Subscription | null> {
  const res = await query<Subscription>(
    `SELECT ${SELECT_COLS} FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
    [stripeCustomerId],
  );
  return res.rows[0] ?? null;
}

/** True when this account currently has an entitling subscription. The gate. */
export async function hasActiveSubscription(accountId: string): Promise<boolean> {
  const sub = await getSubscriptionByAccount(accountId);
  return isActiveStatus(sub?.status);
}

export interface UpsertInput {
  accountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  status: string;
  priceId?: string | null;
  /** Epoch seconds (Stripe's current_period_end), or null. */
  currentPeriodEnd?: number | null;
}

/**
 * Insert-or-update this account's subscription row from a Stripe event. Keyed on
 * account_id (one sub per account); idempotent so webhook retries/out-of-order
 * deliveries converge. Every column binds its OWN placeholder even when values
 * repeat — DSQL deduces a single type per placeholder and reusing one across
 * columns of differing types fails with 42P08 (see dsql-gotchas / accounts.ts).
 */
export async function upsertSubscription(input: UpsertInput): Promise<void> {
  const periodEnd =
    input.currentPeriodEnd != null
      ? new Date(input.currentPeriodEnd * 1000).toISOString()
      : null;
  await withRetry(async () => {
    await query(
      `INSERT INTO subscriptions
         (account_id, stripe_customer_id, stripe_subscription_id, status,
          price_id, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (account_id) DO UPDATE SET
         stripe_customer_id     = $7,
         stripe_subscription_id = $8,
         status                 = $9,
         price_id               = $10,
         current_period_end     = $11,
         updated_at             = now()`,
      [
        input.accountId,
        input.stripeCustomerId,
        input.stripeSubscriptionId ?? null,
        input.status,
        input.priceId ?? null,
        periodEnd,
        // ON CONFLICT update half — distinct placeholders, same values.
        input.stripeCustomerId,
        input.stripeSubscriptionId ?? null,
        input.status,
        input.priceId ?? null,
        periodEnd,
      ],
    );
  });
}

/** Update status (+ optional period end) for an existing customer row. Used by
 *  subscription.updated/deleted events, which key off the customer id. No-op if
 *  no row matches (an event for a customer we never recorded). */
export async function updateSubscriptionStatusByCustomer(
  stripeCustomerId: string,
  status: string,
  stripeSubscriptionId?: string | null,
  currentPeriodEnd?: number | null,
): Promise<void> {
  const periodEnd =
    currentPeriodEnd != null
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null;
  await withRetry(async () => {
    await query(
      `UPDATE subscriptions
         SET status = $2, stripe_subscription_id = $3,
             current_period_end = $4, updated_at = now()
       WHERE stripe_customer_id = $1`,
      [stripeCustomerId, status, stripeSubscriptionId ?? null, periodEnd],
    );
  });
}
