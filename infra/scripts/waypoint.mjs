// Shared helpers for building a Sonar waypoint item.
// Dependency-free; used by the drop CLI now and reusable by the seeder later.
// Item shape matches docs/data-model.md.
import crypto from "node:crypto";

const GEOHASH_B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const ULID_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford

/** Standard base32 geohash encode. */
export function encodeGeohash(lat, lng, precision = 6) {
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

/** Minimal ULID: 48-bit ms timestamp + 80 bits randomness, sortable. */
export function ulid(now = Date.now()) {
  let ts = "", t = now;
  for (let i = 9; i >= 0; i--) { ts = ULID_B32[t % 32] + ts; t = Math.floor(t / 32); }
  let rand = "";
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) rand += ULID_B32[bytes[i] & 31];
  return ts + rand;
}

const EARTH_R = 6371000; // meters

/** Offset a coordinate by distance (m) along a bearing (deg). Mirrors src/lib/geo.ts. */
export function offset(origin, meters, bearingDeg) {
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

/** Seeded PRNG (mulberry32) so a given --seed yields a stable scatter. */
export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * Build a waypoint as both a plain object and a marshalled DynamoDB item.
 * @returns {{ plain, item, key, gh6, id }}
 */
export function buildWaypoint({
  channel, text, author, kind = "text", lat, lng,
  actorType = "human", love = 0, realLove = 0, now = Date.now(),
}) {
  const id = ulid(now);
  const gh6 = encodeGeohash(lat, lng, 6);
  const gh9 = encodeGeohash(lat, lng, 9);
  const pk = `CH#${channel}#GEO#${gh6}`;
  const sk = `WP#${id}`;

  const plain = {
    PK: pk, SK: sk,
    GSI1PK: `USER#${author}`, GSI1SK: sk,
    id, channel, actorType, kind, author, text,
    lat, lng, gh9,
    createdAt: now,
    ttl: Math.floor(now / 1000) + TTL_SECONDS,
    love, realLove, promoted: false,
  };

  const S = (v) => ({ S: String(v) });
  const N = (v) => ({ N: String(v) });
  const item = {
    PK: S(pk), SK: S(sk),
    GSI1PK: S(plain.GSI1PK), GSI1SK: S(sk),
    id: S(id), channel: S(channel), actorType: S(actorType),
    kind: S(kind), author: S(author), text: S(text),
    lat: N(lat), lng: N(lng), gh9: S(gh9),
    createdAt: N(plain.createdAt), ttl: N(plain.ttl),
    love: N(love), realLove: N(realLove), promoted: { BOOL: false },
  };

  return { plain, item, key: { PK: pk, SK: sk }, gh6, id };
}
