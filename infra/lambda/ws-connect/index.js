"use strict";

/**
 * WebSocket $connect.
 *
 * The browser opens one socket with `?channels=food,music,...`. We record one
 * fan-out target per channel so the fanout consumer can Query `CONN#<channel>`
 * directly. Each item also mirrors onto GSI1 keyed by the connection id, so
 * $disconnect can find and delete every row for this socket.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.TABLE_NAME || "sonar";
const REGION = process.env.AWS_REGION || "us-east-1";
const CONN_TTL_SECONDS = 2 * 60 * 60; // safety net if $disconnect is missed
// Channels are an open set, so we validate STRUCTURALLY (a normalized slug) here
// rather than against a closed list — a bogus channel just creates a dead CONN#
// partition no one publishes to. Private-channel access is enforced upstream by
// the $connect authorizer (it denies the handshake for non-members), so by the
// time we run, every requested channel is authorized. Empty → the public core.
const CORE_CHANNELS = ["events", "food", "music", "social", "safety"];
const VALID_CHANNEL = /^[a-z0-9]{1,16}$/;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

exports.handler = async (event) => {
  const connId = event.requestContext?.connectionId;
  if (!connId) return { statusCode: 400, body: "no connection id" };

  // The $connect authorizer has already verified the session ticket; record the
  // account so connections are attributable (and fan-out can be scoped later).
  const account = event.requestContext?.authorizer?.sub || null;

  const raw = event.queryStringParameters?.channels;
  const channels = [
    ...new Set(
      (raw ? raw.split(",") : CORE_CHANNELS)
        .map((c) => c.trim().toLowerCase())
        .filter((c) => VALID_CHANNEL.test(c)),
    ),
  ];
  if (channels.length === 0) channels.push(...CORE_CHANNELS);

  const now = Date.now();
  const ttl = Math.floor(now / 1000) + CONN_TTL_SECONDS;
  const items = channels.map((ch) => ({
    PutRequest: {
      Item: {
        PK: `CONN#${ch}`,
        SK: `CID#${connId}`,
        GSI1PK: `CONN#${connId}`, // reverse lookup for $disconnect cleanup
        GSI1SK: `CH#${ch}`,
        connId,
        channel: ch,
        account,
        connectedAt: now,
        ttl,
      },
    },
  }));

  await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items } }));
  console.log("ws connect", { connId, channels });
  return { statusCode: 200, body: "connected" };
};
