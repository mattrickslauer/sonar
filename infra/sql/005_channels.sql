-- Sonar — channel registry. The relational system-of-record for the OPEN channel
-- set: what used to be a hardcoded 5-value enum in code becomes a row per channel
-- so users can create their own. The channel `id` is the canonical, normalized
-- slug (lowercase [a-z0-9], <=16 chars); for a locked private channel it is a
-- random 16-char token instead (unguessable, unlisted). The DynamoDB waypoint
-- partition `CH#<id>#GEO#<gh6>` already accepts any id, so no DynamoDB change is
-- needed — this table just authorizes which ids may be created and carries the
-- private/lifecycle flags. See src/lib/server/channels.ts.
--
-- Apply ONCE per cluster as `admin`, AFTER 004, with the migration runner
-- (infra/sql/run.mjs) — one DDL statement per transaction (Aurora DSQL allows
-- only one DDL per tx and forbids mixing DDL with DML; the seed rows are a
-- SEPARATE migration, 006_seed_channels.sql).
--
-- DSQL notes (same constraints as 001/003):
--   * No FOREIGN KEY support — `owner_account_id` references accounts(id) by
--     convention; integrity is enforced in app code.
--   * UUIDs are application-generated.
--   * Secondary indexes are added via CREATE INDEX ASYNC, not inline.

-- 1. Base table. id is the PK, which gives us the UNIQUE constraint that
--    search-or-create upserts against for free (INSERT ... ON CONFLICT (id)).
--      is_private        public (slug) channels are false; locked channels true.
--      owner_account_id  null for the seeded system channels; the creator's
--                        accounts.id for user-created (esp. private) channels.
--      status            channel lifecycle, distinct from Stripe billing state
--                        (which lives in channel_billing): 'active' (usable),
--                        'locked_unpaid' (private channel awaiting checkout),
--                        'expired' (owner cancelled — denied + unlisted).
CREATE TABLE IF NOT EXISTS channels (
  id                text PRIMARY KEY,
  label             text NOT NULL,
  emoji             text,
  color             text,
  is_private        boolean NOT NULL DEFAULT false,
  owner_account_id  uuid,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 2. Label index for the picker's type-ahead search (label ILIKE '%q%'). The PK
--    already covers id lookups; this supports search by human-readable name.
CREATE INDEX ASYNC IF NOT EXISTS channels_label_idx ON channels (label);

-- 3. Least-privilege grants (role from 000_app_role.sql). The app reads channels
--    on the validation path, inserts on search-or-create, and updates `status`
--    on the locked-channel lifecycle. id/label are treated as immutable in app
--    code. No DELETE, no DDL. Same posture as 003; no GRANT USAGE ON SCHEMA.
GRANT SELECT, INSERT, UPDATE ON channels TO sonar_app;
