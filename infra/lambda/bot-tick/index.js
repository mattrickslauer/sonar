"use strict";

/**
 * Bot liveness tick.
 *
 * Trigger: EventBridge schedule (~1 min).
 * Job: keep quiet places feeling alive near real users.
 *   1. Query PK = `PRESENCE` → the gh6 cells that currently have a real user.
 *   2. For each cell, count real (actorType=human) waypoints in it.
 *   3. If below the liveness target, drop templated bot waypoints
 *      (actorType=bot) with staggered createdAt and ttl = createdAt + 86400.
 *   4. Optionally bot-love a few recent real drops (touches `love` only,
 *      never `realLove`, so it can't fake-promote).
 *
 * Content comes from a static template pool (mirrors SEEDS in
 * src/lib/waypoints.ts). No Bedrock call on the hot path.
 */
exports.handler = async () => {
  // TODO: Query PK=PRESENCE; for each active cell, density-check and top up
  // from the channel-tagged template pool.
  console.log("bot tick: no active presence (stub)");
  return { ok: true };
};
