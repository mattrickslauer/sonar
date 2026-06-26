-- Sonar — per-channel Stripe billing state for LOCKED private channels. Kept in a
-- SEPARATE table from `channels` (not extra columns) on purpose:
--   * the per-account `subscriptions` table (003) is one-row-per-account for
--     PERMANENT WAYPOINTS — a locked channel is a DISTINCT, second Stripe
--     subscription for the same account, billed per member-hour via metered
--     usage records, so it cannot reuse that row;
--   * a channel can be cancelled and re-locked, so billing has its own lifecycle;
--   * keeps the channel read/validation path free of Stripe churn.
-- The hourly tick (infra/lambda/channel-meter-tick) reads subscription_item_id
-- and pushes one usage record per active locked channel per clock hour, with
-- quantity = current member count (per-member-per-hour capacity billing). The
-- Stripe webhook keeps this row in sync. See src/lib/server/channels.ts.
--
-- Apply ONCE per cluster as `admin`, AFTER 007, with the migration runner — one
-- DDL per transaction. DSQL: no FK; uniqueness via CREATE UNIQUE INDEX ASYNC.

-- 1. Base table. One row per locked channel (channel_id PK, 1:1 with channels).
--      subscription_item_id  the metered item usage records are posted to —
--                            load-bearing for the hourly tick; persisted by the
--                            webhook at subscription.created so the tick never
--                            calls Stripe to discover it.
--      status                mirrors Stripe subscription.status verbatim.
CREATE TABLE IF NOT EXISTS channel_billing (
  channel_id              text PRIMARY KEY,
  owner_account_id        uuid NOT NULL,
  stripe_customer_id      text NOT NULL,
  stripe_subscription_id  text,
  subscription_item_id    text,
  price_id                text,
  status                  text NOT NULL,
  current_period_end      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 2. The webhook resolves an inbound subscription.* event back to its channel by
--    stripe_subscription_id (the event carries the sub + customer, not our
--    channel_id except in metadata). Unique so that lookup is unambiguous.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS channel_billing_sub_uniq
  ON channel_billing (stripe_subscription_id);

-- 3. Customer index is NON-unique on purpose: one account (one Stripe customer,
--    reused via ensureCustomer) can own several locked channels, so the same
--    stripe_customer_id repeats across rows. (Contrast 003, where customer is
--    unique because there is exactly one per-account waypoint subscription.)
CREATE INDEX ASYNC IF NOT EXISTS channel_billing_customer_idx
  ON channel_billing (stripe_customer_id);

-- 4. Least-privilege grants. App reads (entitlement/tick) and upserts from the
--    webhook + create flow. No DELETE (cancel flips status, never deletes).
GRANT SELECT, INSERT, UPDATE ON channel_billing TO sonar_app;
