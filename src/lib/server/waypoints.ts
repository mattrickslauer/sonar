// Server-only: read/write waypoints in the sonar DynamoDB table.
import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { CHANNELS, ChannelId } from "@/lib/channels";
import { LngLat, distance, bearing } from "@/lib/geo";
import { Waypoint, MediaKind } from "@/lib/waypoints";
import { cellAndNeighbors, encodeGeohash } from "@/lib/geohash";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const TABLE = process.env.SONAR_TABLE ?? "sonar";
const TTL_SECONDS = 24 * 60 * 60;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const ULID32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now: number): string {
  let ts = "", t = now;
  for (let i = 9; i >= 0; i--) { ts = ULID32[t % 32] + ts; t = Math.floor(t / 32); }
  let rand = "";
  const b = randomBytes(16);
  for (let i = 0; i < 16; i++) rand += ULID32[b[i] & 31];
  return ts + rand;
}

// DynamoDB item → the Waypoint shape the radar UI consumes (meters/bearing/age
// are computed relative to the requesting center + now).
function toWaypoint(it: Record<string, unknown>, center: LngLat, now: number): Waypoint {
  const pos: LngLat = { lng: Number(it.lng), lat: Number(it.lat) };
  const createdAt = Number(it.createdAt);
  const expiresAt = it.ttl != null
    ? Number(it.ttl) * 1000
    : createdAt + TTL_SECONDS * 1000;
  return {
    id: String(it.id),
    channel: it.channel as ChannelId,
    kind: it.kind as MediaKind,
    author: String(it.author),
    text: String(it.text),
    pos,
    minutesAgo: Math.max(0, (now - createdAt) / 60000),
    love: Number(it.love ?? 0),
    promoted: Boolean(it.promoted),
    bearing: bearing(center, pos),
    meters: distance(center, pos),
    expiresAt,
    lifespanMs: Math.max(1, expiresAt - createdAt),
  };
}

/** "What's near me": query the center cell + 8 neighbors per channel, merged. */
export async function queryNearby(
  center: LngLat,
  channels: ChannelId[] = CHANNELS.map((c) => c.id),
): Promise<Waypoint[]> {
  const cells = cellAndNeighbors(center.lat, center.lng, 6);
  const now = Date.now();

  const queries = channels.flatMap((ch) =>
    cells.map((cell) =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :wp)",
        ExpressionAttributeValues: { ":pk": `CH#${ch}#GEO#${cell}`, ":wp": "WP#" },
      })),
    ),
  );

  const results = await Promise.all(queries);
  const items = results.flatMap((r) => r.Items ?? []);
  return items
    .map((it) => toWaypoint(it, center, now))
    .sort((a, b) => a.meters - b.meters); // proximity-ranked
}

export interface DropInput {
  channel: ChannelId;
  kind: MediaKind;
  text: string;
  lat: number;
  lng: number;
  author?: string;
  lifespanSeconds?: number;
}

// Author-chosen lifespan bounds. Capped at 24h to keep the feed ephemeral.
const MIN_LIFESPAN_SECONDS = 15 * 60;
const MAX_LIFESPAN_SECONDS = TTL_SECONDS; // 24h

/** Persist a real (human) drop. */
export async function putWaypoint(input: DropInput): Promise<Waypoint> {
  const now = Date.now();
  const id = ulid(now);
  const author = input.author ?? "you";
  const gh6 = encodeGeohash(input.lat, input.lng, 6);
  const sk = `WP#${id}`;
  const lifespan = Math.min(
    MAX_LIFESPAN_SECONDS,
    Math.max(MIN_LIFESPAN_SECONDS, Math.round(input.lifespanSeconds ?? TTL_SECONDS)),
  );
  const item = {
    PK: `CH#${input.channel}#GEO#${gh6}`,
    SK: sk,
    GSI1PK: `USER#${author}`,
    GSI1SK: sk,
    id,
    channel: input.channel,
    actorType: "human",
    kind: input.kind,
    author,
    text: input.text,
    lat: input.lat,
    lng: input.lng,
    gh9: encodeGeohash(input.lat, input.lng, 9),
    createdAt: now,
    ttl: Math.floor(now / 1000) + lifespan,
    love: 0,
    realLove: 0,
    promoted: false,
  };
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: item,
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  return toWaypoint(item, { lat: input.lat, lng: input.lng }, now);
}

export interface LoveInput {
  id: string;
  channel: ChannelId;
  lat: number;
  lng: number;
  user: string;
}

export interface LoveResult {
  love: number;
  realLove: number;
  /** false when this user had already loved the waypoint (no double-count). */
  counted: boolean;
}

/**
 * Record a human love: a one-per-user dedup edge plus an atomic bump of both
 * the display `love` and the promotion-driving `realLove`. The waypoint's
 * partition is rederived from its coordinates (same gh6 as on write).
 */
export async function loveWaypoint(input: LoveInput): Promise<LoveResult> {
  const gh6 = encodeGeohash(input.lat, input.lng, 6);
  const pk = `CH#${input.channel}#GEO#${gh6}`;
  const sk = `WP#${input.id}`;
  const now = Date.now();

  // Dedup edge: one love per (waypoint, user). If it already exists, bail
  // without touching the counters.
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `WP#${input.id}`,
        SK: `LOVE#${input.user}`,
        createdAt: now,
        ttl: Math.floor(now / 1000) + TTL_SECONDS,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Already loved — report current state without incrementing.
      const cur = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: { ":pk": pk, ":sk": sk },
      }));
      const it = cur.Items?.[0];
      return {
        love: Number(it?.love ?? 0),
        realLove: Number(it?.realLove ?? 0),
        counted: false,
      };
    }
    throw err;
  }

  // Bump both counters atomically. realLove crossing the threshold is what the
  // promote stream consumer watches.
  const res = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: "ADD love :one, realLove :one",
    ConditionExpression: "attribute_exists(PK)",
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  return {
    love: Number(res.Attributes?.love ?? 0),
    realLove: Number(res.Attributes?.realLove ?? 0),
    counted: true,
  };
}

/**
 * Undo a love: remove this user's dedup edge and decrement both counters. The
 * inverse of loveWaypoint; idempotent (if the edge isn't there, nothing moves).
 * Promotion is one-way — already-archived greatest-hits are not un-archived.
 */
export async function unloveWaypoint(input: LoveInput): Promise<LoveResult> {
  const gh6 = encodeGeohash(input.lat, input.lng, 6);
  const pk = `CH#${input.channel}#GEO#${gh6}`;
  const sk = `WP#${input.id}`;

  // Remove the edge; if it wasn't there, this user hadn't loved it → no change.
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `WP#${input.id}`, SK: `LOVE#${input.user}` },
      ConditionExpression: "attribute_exists(PK)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const cur = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: { ":pk": pk, ":sk": sk },
      }));
      const it = cur.Items?.[0];
      return {
        love: Number(it?.love ?? 0),
        realLove: Number(it?.realLove ?? 0),
        counted: false,
      };
    }
    throw err;
  }

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "ADD love :neg, realLove :neg",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":neg": -1 },
      ReturnValues: "UPDATED_NEW",
    }));
    return {
      love: Number(res.Attributes?.love ?? 0),
      realLove: Number(res.Attributes?.realLove ?? 0),
      counted: true,
    };
  } catch (err) {
    // Waypoint vanished (expired) after we removed the edge — edge cleanup still
    // succeeded, so report success with no counters.
    if (err instanceof ConditionalCheckFailedException) {
      return { love: 0, realLove: 0, counted: true };
    }
    throw err;
  }
}

/**
 * Of the given waypoint ids, which has this user already loved? Reads the
 * `WP#<id>` / `LOVE#<user>` dedup edges in batches, so the client can seed its
 * loved-state on load instead of starting blank.
 */
export async function lovedAmong(ids: string[], user: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const loved: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE]: {
          Keys: chunk.map((id) => ({ PK: `WP#${id}`, SK: `LOVE#${user}` })),
          ProjectionExpression: "PK",
        },
      },
    }));
    for (const it of res.Responses?.[TABLE] ?? []) {
      loved.push(String(it.PK).slice("WP#".length));
    }
  }
  return loved;
}

const PRESENCE_TTL_SECONDS = 3 * 60; // bots react to recent presence only

/** Heartbeat: mark this user present in their gh6 cell (drives the bot tick). */
export async function recordPresence(lat: number, lng: number, user: string): Promise<void> {
  const gh6 = encodeGeohash(lat, lng, 6);
  const now = Date.now();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: "PRESENCE",
      SK: `GEO#${gh6}#USER#${user}`,
      gh6,
      lat,
      lng,
      updatedAt: now,
      ttl: Math.floor(now / 1000) + PRESENCE_TTL_SECONDS,
    },
  }));
}
