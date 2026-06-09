"use strict";

/**
 * Usage metering rollup.
 *
 * Trigger: DynamoDB stream, INSERT records on the `sonar` table.
 * Job: aggregate raw connect/message usage events (PK = `USAGE#<channel>#<hour>`)
 * into the DSQL usage_rollups table that feeds Stripe metered billing.
 *
 * Bot-origin events are excluded upstream (bots are not billed).
 */
exports.handler = async (event) => {
  for (const record of event.Records || []) {
    if (record.eventName !== "INSERT") continue;
    const pk = record.dynamodb?.Keys?.PK?.S || "";
    if (!pk.startsWith("USAGE#")) continue; // only metering events

    const img = record.dynamodb?.NewImage || {};
    console.log("meter", { pk, type: img.type?.S, units: img.units?.N });
    // TODO: upsert into DSQL usage_rollups (channel_id, period_start) with an
    // atomic add of connection_minutes / messages_delivered.
  }
  return { ok: true };
};
