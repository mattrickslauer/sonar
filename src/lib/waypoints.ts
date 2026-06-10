import { ChannelId } from "./channels";
import { LngLat, offset } from "./geo";

export type MediaKind = "text" | "photo" | "video" | "voice";

export interface Waypoint {
  id: string;
  channel: ChannelId;
  kind: MediaKind;
  author: string;
  text: string;
  pos: LngLat;
  minutesAgo: number; // 0–1440 (24h window)
  love: number;
  promoted: boolean; // crossed the love threshold → "greatest hits"
  bearing: number; // for layout only
  meters: number;
}

const PROMOTE_THRESHOLD = 40;

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
    return {
      id: `wp_${i}`,
      channel: s.channel,
      kind: s.kind,
      author: s.author,
      text: s.text,
      pos: offset(center, meters, bearing),
      minutesAgo,
      love,
      promoted: love >= PROMOTE_THRESHOLD,
      bearing,
      meters,
    };
  });
}

/** Fetch live waypoints near a center from the API (DynamoDB-backed). */
export async function fetchWaypoints(
  center: LngLat,
  channels?: ChannelId[],
): Promise<Waypoint[]> {
  const params = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
  });
  if (channels) params.set("channels", channels.join(","));
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
    }),
  });
  if (!res.ok) throw new Error(`postDrop failed: ${res.status}`);
  const data = await res.json();
  return data.waypoint as Waypoint;
}

export const MEDIA_ICON: Record<MediaKind, string> = {
  text: "✎",
  photo: "❏",
  video: "►",
  voice: "🎙",
};
