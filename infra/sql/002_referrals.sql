-- Sonar — referral attribution columns.
--
-- Apply ONCE per cluster as `admin`, AFTER 001_accounts_auth.sql, with the
-- migration runner (infra/sql/run.mjs) — one DDL statement per transaction
-- (Aurora DSQL allows only one DDL per tx and forbids mixing DDL with DML).
--
-- When a brand-new visitor opens a shared waypoint link (`?r=<username>`), the
-- referrer's username rides along to the backend on that visitor's FIRST write
-- (drop/love) and is stamped here, set-once, on their freshly-created anonymous
-- account row (see ensureAnonymousAccount / attachReferral in
-- src/lib/server/accounts.ts). Because the canonical id never changes when the
-- account is later claimed, the attribution survives sign-in with zero
-- migration — same property the rest of the identity model relies on.
--
-- Bare columns only — DSQL disallows inline constraints/defaults on ADD COLUMN.

-- The sharer's username (their display name at share time). Free text, not a
-- foreign key: display names are not unique and DSQL has no FK support, so this
-- is a denormalized attribution breadcrumb, not a join key.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referred_by text;

-- When the referral was first recorded (set alongside referred_by, set-once).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referred_at timestamptz;

-- No new GRANT needed: 001_accounts_auth.sql already grants the app role
-- SELECT/INSERT/UPDATE on accounts at the table level, which covers new columns.
