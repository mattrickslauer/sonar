-- Sonar — private-channel membership allow-list. The relational SYSTEM-OF-RECORD
-- for who may read/post in a locked private channel. Membership is mirrored to a
-- DynamoDB cache (PK=CH#<id> / SK=MEMBER#<accountId>) that the WebSocket
-- authorizer reads on the hot $connect path; this table is the authority the REST
-- guard checks and the cache is rebuilt from. See src/lib/server/membership.ts.
--
-- Apply ONCE per cluster as `admin`, AFTER 005/006, with the migration runner —
-- one DDL per transaction.
--
-- DSQL notes (same as 001/003): no FOREIGN KEY (channel_id → channels.id and
-- account_id → accounts.id by convention); composite uniqueness via
-- CREATE UNIQUE INDEX ASYNC, not an inline PRIMARY KEY.

-- 1. Base table. (channel_id, account_id) is logically the PK; DSQL expresses
--    that as a unique index (below). role is 'owner' (the channel creator/payer)
--    or 'member' (an invited account).
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id  text NOT NULL,
  account_id  uuid NOT NULL,
  role        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Dedupe boundary: one row per (channel, account). Makes addMember's
--    INSERT ... ON CONFLICT DO NOTHING idempotent and race-safe under DSQL OCC.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS channel_members_pk
  ON channel_members (channel_id, account_id);

-- 3. Reverse lookup "channels this account belongs to" — powers listMyChannels
--    (the dynamic channel list) and rebuilding the DynamoDB membership cache.
CREATE INDEX ASYNC IF NOT EXISTS channel_members_by_account
  ON channel_members (account_id);

-- 4. Least-privilege grants. Unlike accounts/subscriptions we DO grant DELETE:
--    revoking a member (and the unlock cascade on cancel) is a real operation.
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_members TO sonar_app;
