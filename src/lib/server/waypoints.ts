// Server-only: read/write waypoints in the sonar DynamoDB table.
import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
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
  return {
    id: String(it.id),
    channel: it.channel as ChannelId,
    kind: it.kind as MediaKind,
    author: String(it.author),
    text: String(it.text),
    pos,
    minutesAgo: Math.max(0, (now - Number(it.createdAt)) / 60000),
    love: Number(it.love ?? 0),
    promoted: Boolean(it.promoted),
    bearing: bearing(center, pos),
    meters: distance(center, pos),
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
}

/** Persist a real (human) drop. */
export async function putWaypoint(input: DropInput): Promise<Waypoint> {
  const now = Date.now();
  const id = ulid(now);
  const author = input.author ?? "you";
  const gh6 = encodeGeohash(input.lat, input.lng, 6);
  const sk = `WP#${id}`;
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
    ttl: Math.floor(now / 1000) + TTL_SECONDS,
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
