-- Sonar — subscriptions schema + least-privilege grants.
--
-- Apply ONCE per cluster as `admin`, AFTER 001_accounts_auth.sql, with the
-- migration runner (infra/sql/run.mjs) — one DDL statement per transaction
-- (Aurora DSQL allows only one DDL per tx and forbids mixing DDL with DML).
--
-- This is the durable system-of-record for paid subscriptions. Stripe is the
-- billing authority; this table mirrors the relevant subscription STATE so the
-- app can gate a feature (creating a permanent, non-TTL waypoint) without a
-- Stripe round-trip on the hot path. The webhook (/api/billing/webhook) keeps
-- it in sync; the app reads it (hasActiveSubscription) before honoring a
-- `permanent: true` drop. See src/lib/server/subscriptions.ts.
--
-- DSQL notes baked into this file (same constraints as the accounts migration):
--   * No FOREIGN KEY support — `account_id` references accounts(id) by
--     convention; referential integrity is enforced in app code.
--   * UUIDs are application-generated (crypto.randomUUID), per DSQL guidance.
--   * Uniqueness is added via CREATE UNIQUE INDEX ASYNC, not inline.

-- 1. Base table. One row per account (account_id is the PK): a Sonar account has
--    at most one subscription. Anonymous users cannot subscribe — only a claimed
--    account (with a session) reaches the checkout flow — so account_id always
--    points at a claimed accounts row.
--      status            mirrors Stripe's subscription.status verbatim
--                        ('active','trialing','past_due','canceled','unpaid'…).
--      current_period_end the paid-through instant; informational (the gate keys
--                         off status, which Stripe already flips at period end).
CREATE TABLE IF NOT EXISTS subscriptions (
  account_id             uuid PRIMARY KEY,
  stripe_customer_id     text NOT NULL,
  stripe_subscription_id text,
  status                 text NOT NULL,
  price_id               text,
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- 2. Uniqueness — the webhook resolves an inbound Stripe event back to a single
--    row by customer id (subscription.* events don't carry our account_id except
--    in metadata, so the customer id is the reliable join key). A unique index
--    makes that lookup unambiguous and the upsert-by-customer race-safe under
--    DSQL's optimistic concurrency. NULL subscription ids are DISTINCT by default
--    so a customer that hasn't completed checkout doesn't collide.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS subscriptions_customer_uniq     ON subscriptions (stripe_customer_id);
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS subscriptions_subscription_uniq ON subscriptions (stripe_subscription_id);

-- 3. Least-privilege grants for the app role (created in 000_app_role.sql). The
--    web server can read its own subscription state and upsert it from the
--    webhook — nothing else. No DELETE, no DDL. Same posture as the accounts
--    grant in 001; we do NOT grant USAGE ON SCHEMA public (DSQL rejects it for
--    the managed `public` entity; the table grant alone suffices).
GRANT SELECT, INSERT, UPDATE ON subscriptions TO sonar_app;
