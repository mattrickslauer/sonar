-- Sonar — seed the original five system channels as rows, so the previously
-- hardcoded closed set becomes data. PURE DML (no DDL): Aurora DSQL forbids
-- mixing DDL with DML in one transaction, so this is a SEPARATE migration that
-- runs AFTER 005_channels.sql creates the table.
--
-- One INSERT ... ON CONFLICT (id) DO NOTHING per row so the runner's `;`-split
-- applies each independently and re-runs are no-ops. owner_account_id is null
-- (system-owned). These mirror the TS CHANNELS array in src/lib/channels.ts,
-- which is retained only as a seed manifest + offline fallback. `safety` keeps
-- its is_private flag for parity with the old UI lock, though enforced private
-- channels are the user-created (random-id) ones.

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('events', 'Events', '🎪', '#f5a524', false, null) ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('food', 'Food', '🍔', '#fb7185', false, null) ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('music', 'Music', '🎶', '#a855f7', false, null) ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('social', 'Social', '💬', '#22d3ee', false, null) ON CONFLICT (id) DO NOTHING;

INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id)
  VALUES ('safety', 'Safety', '🛟', '#ef4444', true, null) ON CONFLICT (id) DO NOTHING;
