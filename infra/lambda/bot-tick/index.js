"use strict";

/**
 * Bot liveness tick.
 *
 * Trigger: EventBridge schedule (~1 min).
 * Job: keep quiet places feeling alive near real users.
 *   1. Query PK = `PRESENCE` → the gh6 cells that currently have a real user.
 *   2. For each cell, count waypoints already in it (across channels).
 *   3. If below the liveness target, drop templated bot waypoints
 *      (actorType=bot) scattered near the cell, ttl = createdAt + 86400.
 *   4. Bot-love a couple of recent real drops (touches `love` only, never
 *      `realLove`, so it can't fake-promote).
 *
 * Content comes from a static template pool (mirrors SEEDS in
 * src/lib/waypoints.ts). No Bedrock call on the hot path. DynamoDB-only —
 * uses the AWS SDK v3 bundled in the Node 20 runtime.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const TABLE = process.env.TABLE_NAME || "sonar";
const REGION = process.env.AWS_REGION || "us-east-1";
const TTL_SECONDS = 24 * 60 * 60;
// Target live waypoints per active cell (across all channels). Below this we
// top up with bots; at/above it we leave the cell alone.
const LIVENESS_TARGET = Number(process.env.LIVENESS_TARGET || "8");
const MAX_DROPS_PER_TICK = Number(process.env.MAX_DROPS_PER_TICK || "4");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// --- self-contained geo/id helpers (mirror src/lib/{geohash,geo}.ts) --------
const crypto = require("node:crypto");
const GEOHASH_B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const ULID_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const EARTH_R = 6371000;

function encodeGeohash(lat, lng, precision = 6) {
  let idx = 0, bit = 0, even = true, hash = "";
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lng >= mid) { idx = idx * 2 + 1; lonMin = mid; } else { idx = idx * 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid; } else { idx = idx * 2; latMax = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += GEOHASH_B32[idx]; bit = 0; idx = 0; }
  }
  return hash;
}

function ulid(now) {
  let ts = "", t = now;
  for (let i = 9; i >= 0; i--) { ts = ULID_B32[t % 32] + ts; t = Math.floor(t / 32); }
  let rand = "";
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) rand += ULID_B32[bytes[i] & 31];
  return ts + rand;
}

function offset(origin, meters, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const dr = meters / EARTH_R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
    Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

// --- bot persona / content pool (mirrors SEEDS in src/lib/waypoints.ts) ------
const POOL = [
  { channel: "music", kind: "voice", author: "maya", text: "north stage just dropped the headliner set 🔊 it's unreal" },
  { channel: "food", kind: "photo", author: "deon", text: "birria tacos truck by gate C — line is short rn" },
  { channel: "social", kind: "text", author: "priya", text: "anyone near the ferris wheel? lost my crew lol" },
  { channel: "events", kind: "text", author: "sam", text: "silent disco starts in 20 at the grove tent" },
  { channel: "safety", kind: "text", author: "ops", text: "minor congestion at east exit, use north path" },
  { channel: "food", kind: "text", author: "lena", text: "vegan bowl spot ran out of tofu, fyi" },
  { channel: "music", kind: "video", author: "kai", text: "crowd surf moment at main stage 🤘" },
  { channel: "social", kind: "photo", author: "theo", text: "best sunset spot is the hill behind stage 2" },
  { channel: "events", kind: "text", author: "nina", text: "art installation lights up at dusk, worth it" },
  { channel: "food", kind: "photo", author: "marco", text: "fresh lemonade stand, $4, west plaza" },
  { channel: "music", kind: "text", author: "jules", text: "acoustic set at the cabin tent, super chill vibe" },
  { channel: "social", kind: "voice", author: "ade", text: "meetup at the flag pole in 10 if anyone's around" },
  { channel: "safety", kind: "text", author: "ops", text: "water refill station added near south gate" },
  { channel: "events", kind: "photo", author: "rosa", text: "fireworks confirmed 10pm over the lake" },
  { channel: "music", kind: "text", author: "finn", text: "bass tent is shaking the ground, come thru" },
  { channel: "food", kind: "text", author: "ivy", text: "coffee cart restocked oat milk ☕" },
  { channel: "social", kind: "text", author: "remy", text: "phone charging lockers by info booth, free" },
  { channel: "events", kind: "video", author: "zoe", text: "drone show rehearsal happening now look up" },
];

const CHANNELS = ["events", "food", "music", "social", "safety"];

function buildBotItem(template, center, now) {
  // Scatter 40–900m around the cell's resident, then re-derive the cell from
  // the scattered point so the item lands in its true geohash partition.
  const meters = 40 + Math.random() * 860;
  const bearing = Math.random() * 360;
  const pos = offset(center, meters, bearing);
  const gh6 = encodeGeohash(pos.lat, pos.lng, 6);
  // Stagger createdAt back up to 25 min so the radar shows a natural spread.
  const createdAt = now - Math.floor(Math.random() * 25 * 60000);
  const id = ulid(createdAt);
  const sk = `WP#${id}`;
  return {
    PK: `CH#${template.channel}#GEO#${gh6}`,
    SK: sk,
    GSI1PK: `USER#${template.author}`,
    GSI1SK: sk,
    id,
    channel: template.channel,
    actorType: "bot",
    kind: template.kind,
    author: template.author,
    text: template.text,
    lat: pos.lat,
    lng: pos.lng,
    gh9: encodeGeohash(pos.lat, pos.lng, 9),
    createdAt,
    ttl: Math.floor(createdAt / 1000) + TTL_SECONDS,
    love: Math.floor(Math.random() * 25),
    realLove: 0, // bots never touch realLove → can never fake-promote
    promoted: false,
  };
}

/** Distinct active cells from PRESENCE, each with a representative coordinate. */
async function activeCells() {
  const cells = new Map(); // gh6 → { lat, lng }
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :p",
      ExpressionAttributeValues: { ":p": "PRESENCE" },
      ExclusiveStartKey,
    }));
    for (const it of res.Items || []) {
      const gh6 = it.gh6 || (typeof it.lat === "number" ? encodeGeohash(it.lat, it.lng, 6) : null);
      if (gh6 && !cells.has(gh6) && typeof it.lat === "number") {
        cells.set(gh6, { lat: it.lat, lng: it.lng });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return cells;
}

/** All waypoints currently living in a gh6 cell, across every channel. */
async function waypointsInCell(gh6) {
  const perChannel = await Promise.all(
    CHANNELS.map((ch) =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :wp)",
        ExpressionAttributeValues: { ":pk": `CH#${ch}#GEO#${gh6}`, ":wp": "WP#" },
      }))
    )
  );
  return perChannel.flatMap((r) => r.Items || []);
}

async function batchPut(items) {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) },
    }));
  }
}

exports.handler = async () => {
  const now = Date.now();
  const cells = await activeCells();
  if (cells.size === 0) {
    console.log("bot tick: no active presence");
    return { ok: true, cells: 0, dropped: 0 };
  }

  let dropped = 0;
  let botLoved = 0;

  for (const [gh6, center] of cells) {
    const existing = await waypointsInCell(gh6);
    const deficit = LIVENESS_TARGET - existing.length;

    // 1. Top up quiet cells with fresh bot waypoints.
    if (deficit > 0) {
      const n = Math.min(deficit, MAX_DROPS_PER_TICK);
      const start = Math.floor(Math.random() * POOL.length);
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push(buildBotItem(POOL[(start + i) % POOL.length], center, now));
      }
      await batchPut(items);
      dropped += items.length;
    }

    // 2. Bot-love a couple of recent *human* drops (display-only warmth).
    const humans = existing
      .filter((w) => w.actorType === "human")
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .slice(0, 3);
    for (const w of humans) {
      if (Math.random() > 0.4) continue; // not every tick
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: w.PK, SK: w.SK },
        // ADD only the display counter — never realLove.
        UpdateExpression: "ADD love :one",
        ExpressionAttributeValues: { ":one": 1 + Math.floor(Math.random() * 2) },
      }));
      botLoved++;
    }
  }

  console.log("bot tick", { cells: cells.size, dropped, botLoved });
  return { ok: true, cells: cells.size, dropped, botLoved };
};
