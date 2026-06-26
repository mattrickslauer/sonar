-- Sonar — seed the always-present "general" system channel. PURE DML (no DDL):
-- Aurora DSQL forbids mixing DDL with DML in one transaction, so this runs as a
-- SEPARATE migration after 005_channels.sql created the table.
--
-- `general` is the public "everyone" channel: system-owned (owner_account_id is
-- null), public (is_private = false), and the default-on channel in the dock so
-- the radar is never empty. The bot-tick lambda tops it up
-- (infra/lambda/bot-tick/index.js), and src/lib/channels.ts mirrors it as the
-- offline fallback. INSERT ... ON CONFLICT (id) DO NOTHING so re-runs are no-ops.

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('general', 'General', '📢', '#60a5fa', false, null) ON CONFLICT (id) DO NOTHING;
