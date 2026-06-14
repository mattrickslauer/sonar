-- Sonar — per-waypoint subscription quantity.
--
-- Apply ONCE per cluster as `admin`, AFTER 003_subscriptions.sql, with the
-- migration runner (infra/sql/run.mjs) — one DDL statement per transaction
-- (Aurora DSQL allows only one DDL per tx and forbids mixing DDL with DML).
--
-- Billing model: ONE Stripe subscription per account, whose `quantity` = the
-- number of permanent waypoints the account is paying for ($5/mo each). Adding a
-- permanent waypoint increments the quantity; deleting one decrements it; at
-- quantity 0 the subscription is canceled. This column mirrors
-- subscription.items[0].quantity from Stripe so the management console can show
-- "N permanent waypoints · $5/mo each" without a Stripe round-trip.
--
-- Bare column only — DSQL disallows inline constraints/defaults on ADD COLUMN.
-- The app treats NULL as 0 (a row that predates this column, or a canceled sub).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quantity integer;

-- No new GRANT needed: 003_subscriptions.sql already grants the app role
-- SELECT/INSERT/UPDATE on subscriptions at the table level, covering new columns.
