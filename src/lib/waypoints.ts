import { ChannelId } from "./channels";
import { LngLat, offset, bearing, distance } from "./geo";

export type MediaKind = "text" | "photo" | "video" | "voice";

export interface Waypoint {
  id: string;
  channel: ChannelId;
  kind: MediaKind;
  author: string;
  text: string;
  pos: LngLat;
  minutesAgo: number; // age since createdAt
  love: number;
  sponsored: boolean; // a paid, permanent waypoint (never expires)
  sponsor?: string; // sponsor/brand label, shown on sponsored waypoints
  bearing: number; // for layout only
  meters: number;
  expiresAt: number; // epoch ms when the waypoint is destroyed (ttl)
  lifespanMs: number; // total chosen lifespan; drives the countdown ring
  mediaKey?: string; // S3 object key for photo/video/voice drops
  mediaUrl?: string; // /api/media/view URL to render the blob (presigned on hit)
}

/** The /api/media/view URL that 307s to a presigned GET for this object. */
export function mediaViewUrl(mediaKey: string): string {
  return `/api/media/view?key=${encodeURIComponent(mediaKey)}`;
}

// Author-selectable lifespans (capped at 24h to keep the feed ephemeral).
export const LIFESPAN_PRESETS: { label: string; seconds: number }[] = [
  { label: "15m", seconds: 15 * 60 },
  { label: "1h", seconds: 60 * 60 },
  { label: "6h", seconds: 6 * 60 * 60 },
  { label: "12h", seconds: 12 * 60 * 60 },
  { label: "24h", seconds: 24 * 60 * 60 },
];
export const DEFAULT_LIFESPAN_SECONDS = 24 * 60 * 60;

export function lifespanLabel(seconds: number): string {
  const match = LIFESPAN_PRESETS.find((p) => p.seconds === seconds);
  if (match) return match.label;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

// Tiny seeded PRNG (mulberry32) so the map is stable across renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seed {
  channel: ChannelId;
  kind: MediaKind;
  author: string;
  text: string;
}

const SEEDS: Seed[] = [
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

/** Build a stable set of waypoints scattered around a center point. */
export function generateWaypoints(center: LngLat, seed = 1337): Waypoint[] {
  const rand = mulberry32(seed);
  return SEEDS.map((s, i) => {
    const meters = 40 + rand() * 900;
    const bearing = rand() * 360;
    const minutesAgo = Math.floor(rand() * 1440);
    const love = Math.floor(rand() * 70);
    const lifespanMs = 24 * 60 * 60 * 1000;
    return {
      id: `wp_${i}`,
      channel: s.channel,
      kind: s.kind,
      author: s.author,
      text: s.text,
      pos: offset(center, meters, bearing),
      minutesAgo,
      love,
      sponsored: false, // seed/offline data carries no sponsored pins
      bearing,
      meters,
      lifespanMs,
      expiresAt: Date.now() + (lifespanMs - minutesAgo * 60000),
    };
  });
}

/** Fetch live waypoints near a center from the API (DynamoDB-backed). */
export async function fetchWaypoints(
  center: LngLat,
  channels?: ChannelId[],
  radiusMeters?: number,
): Promise<Waypoint[]> {
  const params = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
  });
  if (channels) params.set("channels", channels.join(","));
  if (radiusMeters) params.set("radius", String(Math.round(radiusMeters)));
  const res = await fetch(`/api/waypoints?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchWaypoints failed: ${res.status}`);
  const data = await res.json();
  return data.waypoints as Waypoint[];
}

/** Persist a drop at `center` and return the saved waypoint. */
export async function postDrop(input: {
  channel: ChannelId;
  kind: MediaKind;
  text: string;
  center: LngLat;
  author?: string;
  lifespanSeconds?: number;
  mediaKey?: string;
}): Promise<Waypoint> {
  const res = await fetch("/api/waypoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channel: input.channel,
      kind: input.kind,
      text: input.text,
      lat: input.center.lat,
      lng: input.center.lng,
      author: input.author ?? "you",
      lifespanSeconds: input.lifespanSeconds,
      mediaKey: input.mediaKey,
    }),
  });
  if (!res.ok) throw new Error(`postDrop failed: ${res.status}`);
  const data = await res.json();
  return data.waypoint as Waypoint;
}

/**
 * Upload a media file straight to S3 via a presigned POST, returning the object
 * key to persist on the waypoint. The browser POSTs the file directly to S3 (it
 * never transits our function), and S3 enforces the size/type policy minted by
 * /api/media/upload. Throws with the server's message on rejection.
 */
export async function uploadMedia(
  file: File,
  channel: ChannelId,
  kind: MediaKind,
): Promise<string> {
  const init = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channel,
      kind,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (!init.ok) {
    const data = await init.json().catch(() => null);
    throw new Error(data?.error ?? `upload init failed: ${init.status}`);
  }
  const { url, fields, key } = (await init.json()) as {
    url: string;
    fields: Record<string, string>;
    key: string;
  };

  // The S3 POST policy requires the form fields first, then the file last.
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file);

  const put = await fetch(url, { method: "POST", body: form });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  return key;
}

/** The normalized waypoint payload the fanout consumer pushes over WebSocket. */
export interface RawWaypoint {
  id: string;
  channel: ChannelId;
  kind: MediaKind;
  author: string;
  text: string;
  lat: number;
  lng: number;
  createdAt: number;
  ttl?: number; // epoch seconds; expiry for the countdown ring
  love: number;
  sponsored: boolean;
  sponsor?: string;
  actorType?: string;
  mediaKey?: string;
}

/** A pushed RawWaypoint → the Waypoint shape, with layout relative to `center`. */
export function rawToWaypoint(raw: RawWaypoint, center: LngLat): Waypoint {
  const pos: LngLat = { lng: raw.lng, lat: raw.lat };
  const expiresAt = raw.ttl
    ? raw.ttl * 1000
    : raw.createdAt + DEFAULT_LIFESPAN_SECONDS * 1000;
  return {
    id: raw.id,
    channel: raw.channel,
    kind: raw.kind,
    author: raw.author,
    text: raw.text,
    pos,
    minutesAgo: Math.max(0, (Date.now() - raw.createdAt) / 60000),
    love: raw.love ?? 0,
    sponsored: !!raw.sponsored,
    sponsor: raw.sponsor,
    bearing: bearing(center, pos),
    meters: distance(center, pos),
    expiresAt,
    lifespanMs: Math.max(1, expiresAt - raw.createdAt),
    mediaKey: raw.mediaKey,
    mediaUrl: raw.mediaKey ? mediaViewUrl(raw.mediaKey) : undefined,
  };
}

export interface LoveResult {
  love: number;
  realLove: number;
  counted: boolean;
  /** new expiry (epoch ms) after the like bought/refunded time; 0 if unknown. */
  expiresAt: number;
}

export interface LoveArgs {
  id: string;
  channel: ChannelId;
  lat: number;
  lng: number;
  user: string;
}

/** Persist a love and return the server's authoritative counters. */
export async function postLove(input: LoveArgs): Promise<LoveResult> {
  const res = await fetch("/api/love", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`postLove failed: ${res.status}`);
  return (await res.json()) as LoveResult;
}

/** Undo a love and return the server's authoritative counters. */
export async function postUnlove(input: LoveArgs): Promise<LoveResult> {
  const res = await fetch("/api/love", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`postUnlove failed: ${res.status}`);
  return (await res.json()) as LoveResult;
}

/** Which of these waypoint ids has the user already loved? Seeds loved-state. */
export async function fetchLoves(ids: string[], user: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const res = await fetch("/api/loves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, user }),
  });
  if (!res.ok) throw new Error(`fetchLoves failed: ${res.status}`);
  const data = await res.json();
  return data.loved as string[];
}

/** Heartbeat the user's location so the bot tick keeps the area lively. */
export async function postPresence(input: {
  lat: number;
  lng: number;
  user: string;
}): Promise<void> {
  await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  });
}

export const MEDIA_ICON: Record<MediaKind, string> = {
  text: "✎",
  photo: "❏",
  video: "►",
  voice: "🎙",
};
