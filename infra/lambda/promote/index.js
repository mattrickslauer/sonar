"use strict";

/**
 * Promotion — "earned permanence".
 *
 * Trigger: DynamoDB stream, MODIFY records on the `sonar` table.
 * Job: when a *human* waypoint's realLove crosses the threshold (the rising
 * edge only), copy it into the DSQL greatest_hits archive (idempotent on
 * waypoint_id) and flag the source item promoted=true.
 *
 * Bots never promote: they only ever touch the display `love` counter, never
 * `realLove`, and we hard-gate on actorType here as a second guard.
 */
const THRESHOLD = Number(process.env.PROMOTE_THRESHOLD || "40");

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    if (record.eventName !== "MODIFY") continue;

    const keys = record.dynamodb?.Keys || {};
    const sk = keys.SK?.S || "";
    if (!sk.startsWith("WP#")) continue;

    const img = record.dynamodb?.NewImage || {};
    const old = record.dynamodb?.OldImage || {};
    if (img.actorType?.S !== "human") continue; // bots never promote

    const now = Number(img.realLove?.N || "0");
    const before = Number(old.realLove?.N || "0");
    // Only the crossing edge: was below, now at/above. Avoids re-promoting on
    // every subsequent love and on at-least-once stream redelivery.
    if (before >= THRESHOLD || now < THRESHOLD) continue;

    console.log("promote", { waypointId: img.id?.S, realLove: now });
    // TODO: connect to DSQL (process.env.DSQL_ENDPOINT) and
    //   INSERT INTO greatest_hits (...) ON CONFLICT (waypoint_id) DO NOTHING;
    // then UpdateItem promoted=true on the source row.
  }
  return { ok: true };
};
