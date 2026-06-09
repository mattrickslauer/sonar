"use strict";

/**
 * Live fan-out.
 *
 * Trigger: DynamoDB stream, INSERT records on the `sonar` table.
 * Job: when a new waypoint lands, push it to everyone subscribed to its channel.
 *
 * Real impl (TODO): for the waypoint's channel, Query PK = `CONN#<channel>` and
 * postToConnection() each connId via the API Gateway Management API. The WS API
 * is not provisioned yet, so this stub just logs.
 */
exports.handler = async (event) => {
  for (const record of event.Records || []) {
    if (record.eventName !== "INSERT") continue;
    const keys = record.dynamodb?.Keys || {};
    const sk = keys.SK?.S || "";
    if (!sk.startsWith("WP#")) continue; // only waypoints fan out

    const img = record.dynamodb?.NewImage || {};
    console.log("fanout", {
      pk: keys.PK?.S,
      sk,
      channel: img.channel?.S,
      actorType: img.actorType?.S,
    });
    // TODO: query CONN#<channel>; postToConnection to each connId.
  }
  return { ok: true };
};
