-- Sonar — drop the bot persona flag from accounts.
--
-- `is_bot` existed to mark the reusable persona pool the bot-tick lambda posted
-- as, and to stop the anonymous-device path ever handing a bot's row to a real
-- visitor. The bot tick, its EventBridge schedule, its PRESENCE feed and its
-- seed media were all removed when Sonar stopped generating synthetic content,
-- so nothing writes or reads the flag any more.
--
-- Safe to run against a live table: no row can have is_bot = true once the tick
-- is gone, so this drops a column that is uniformly false. Pure DDL — Aurora
-- DSQL forbids mixing DDL and DML in one transaction, so it stands alone.

ALTER TABLE accounts DROP COLUMN IF EXISTS is_bot;
