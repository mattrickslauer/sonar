-- Sonar — channel join links. A private channel's `id` is reused on the hot
-- WebSocket/map paths, so it must NOT double as a public join secret. Instead a
-- locked channel carries a separate, rotatable `join_token`: the public link is
-- /j/<join_token>, which grants membership. Rotating the token (regenerate)
-- invalidates every old link — the link-level complement to per-member revoke.
-- See src/lib/server/channels.ts (getOrCreateJoinToken/rotateJoinToken).
--
-- Apply ONCE per cluster as `admin`, AFTER 008, with the migration runner
-- (infra/sql/run.mjs) — one DDL statement per transaction (Aurora DSQL allows
-- only one DDL per tx).
--
-- DSQL notes (same as 005/007): secondary/unique indexes via CREATE INDEX ASYNC,
-- not inline; no new grants needed (channels already has SELECT/INSERT/UPDATE).

-- 1. The rotatable per-channel join secret. NULL until the owner first views the
--    link (lazily minted by getOrCreateJoinToken). URL-safe so it drops cleanly
--    into the /j/<token> path.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS join_token text;

-- 2. Unique + the lookup index for resolving /j/<token> → channel. NULLs are
--    DISTINCT in DSQL, so the many channels without a token yet don't collide.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS channels_join_token_uniq
  ON channels (join_token);
