// Sonar Platform — the pure rules (no AWS): API keys, post ids, and request
// validation. Kept separate from the DynamoDB store so they can be unit-tested.
// The contract these implement is docs/platform/api.md.
import { createHash, randomBytes } from "node:crypto";
import { encodeGeohash } from "@/lib/geohash";

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const KEY_PREFIX = "sk_live_";
const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const KEY_BODY_LENGTH = 32;
const KEY_RE = /^sk_live_[a-z0-9]{32}$/;

/** A new secret key. Shown once; only its hash is stored. */
export function generateApiKey(): string {
  const bytes = randomBytes(KEY_BODY_LENGTH);
  let body = "";
  // 256 % 36 bias is irrelevant at 32 chars × ~5.2 bits ≈ 165 bits of entropy.
  for (let i = 0; i < KEY_BODY_LENGTH; i++) body += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return KEY_PREFIX + body;
}

/** The stored form of a key: hex SHA-256. Keys are high-entropy, so no salt/KDF is needed. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The non-secret label shown in listings: `sk_live_abcd`. */
export function keyLabel(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 4);
}

/** The key from an `Authorization: Bearer …` header, or null when absent/malformed. */
export function bearerKey(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m && KEY_RE.test(m[1]) ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

/** Tenant ids are short lowercase slugs; they appear in keys and S3 paths. */
export const TENANT_ID_RE = /^[a-z][a-z0-9]{1,23}$/;

// ---------------------------------------------------------------------------
// Post ids: `wp_<gh6><ulid>` — the geohash cell is part of the id, so a post's
// partition (T#<tenant>#GEO#<gh6>) is recovered from the id alone, no lookup.
// ---------------------------------------------------------------------------

const ULID32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GH_RE = "[0-9bcdefghjkmnpqrstuvwxyz]{6}";
const ULID_RE = "[0-9A-HJKMNP-TV-Z]{26}";
const POST_ID_RE = new RegExp(`^wp_(${GH_RE})(${ULID_RE})$`);

export function ulid(now = Date.now()): string {
  let ts = "", t = now;
  for (let i = 9; i >= 0; i--) { ts = ULID32[t % 32] + ts; t = Math.floor(t / 32); }
  const b = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ULID32[b[i] & 31];
  return ts + rand;
}

export function makePostId(gh6: string, id: string): string {
  return `wp_${gh6}${id}`;
}

export function parsePostId(postId: string): { gh6: string; ulid: string } | null {
  const m = POST_ID_RE.exec(postId);
  return m ? { gh6: m[1], ulid: m[2] } : null;
}

// ---------------------------------------------------------------------------
// Keys in the `sonar` table
// ---------------------------------------------------------------------------

export const k = {
  tenant: (t: string) => ({ PK: `TENANT#${t}`, SK: "TENANT" }),
  apiKey: (hash: string) => ({ PK: `APIKEY#${hash}`, SK: "APIKEY" }),
  post: (t: string, gh6: string, id: string) => ({ PK: `T#${t}#GEO#${gh6}`, SK: `WP#${id}` }),
  cell: (t: string, gh6: string) => `T#${t}#GEO#${gh6}`,
  place: (t: string, place: string) => `T#${t}#PLACE#${place}`,
  love: (t: string, id: string, user: string) => ({ PK: `T#${t}#WP#${id}`, SK: `LOVE#${user}` }),
  usage: (t: string, hour: string) => ({ PK: `T#${t}#USAGE`, SK: hour }),
  rate: (t: string, minute: string) => ({ PK: `T#${t}#RATE`, SK: minute }),
};

/** UTC `yyyymmddhh` (usage rows) and `yyyymmddhhmm` (rate windows). */
export function hourStamp(now = Date.now()): string {
  return new Date(now).toISOString().replace(/[-T:]/g, "").slice(0, 10);
}
export function minuteStamp(now = Date.now()): string {
  return new Date(now).toISOString().replace(/[-T:]/g, "").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const LIMITS = {
  text: 2000,
  userId: 128,
  userName: 60,
  place: 64,
  sponsor: 60,
  metaBytes: 2048,
  minLifespan: 15 * 60,
  maxLifespan: 24 * 60 * 60,
  maxRadius: 1800,
  maxLimit: 100,
  defaultLimit: 50,
} as const;

const CHANNEL_RE = /^[a-z0-9-]{1,32}$/;
const PLACE_RE = /^[A-Za-z0-9:._-]{1,64}$/;
const USER_ID_RE = /^[A-Za-z0-9:._@-]{1,128}$/;
const KINDS = ["text", "photo", "video", "voice"] as const;
export type PostKind = (typeof KINDS)[number];

export class InputError extends Error {
  constructor(message: string, readonly code = "invalid_request") {
    super(message);
  }
}

export interface PlatformUser {
  id: string;
  name?: string;
}

export function parseUser(raw: unknown, { needName = false } = {}): PlatformUser {
  if (!raw || typeof raw !== "object") throw new InputError("user must be an object with an id");
  const { id, name } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !USER_ID_RE.test(id)) {
    throw new InputError("user.id must be 1–128 chars of letters, digits and :._@-");
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0 || name.length > LIMITS.userName)) {
    throw new InputError(`user.name must be 1–${LIMITS.userName} chars`);
  }
  if (needName && name === undefined) throw new InputError("user.name is required");
  return { id, name: typeof name === "string" ? name.trim() : undefined };
}

export interface NewPost {
  user: PlatformUser;
  channel: string;
  kind: PostKind;
  text: string;
  lat: number;
  lng: number;
  gh6: string;
  place?: string;
  mediaKey?: string;
  /** Seconds of life, or null for a permanent (sponsored) pin. */
  lifespan: number | null;
  sponsor?: string;
  meta?: Record<string, unknown>;
}

function finiteIn(v: unknown, min: number, max: number, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new InputError(`${name} must be a number between ${min} and ${max}`);
  }
  return v;
}

/** A tenant's media keys live under `tenants/<tenant>/` and nowhere else. */
export function isTenantMediaKey(tenant: string, key: string): boolean {
  return new RegExp(`^tenants/${tenant}/[0-9a-f]{32}\\.[a-z0-9]+$`).test(key);
}

export function parseNewPost(tenant: string, body: unknown): NewPost {
  if (!body || typeof body !== "object") throw new InputError("body must be a JSON object");
  const b = body as Record<string, unknown>;

  const user = parseUser(b.user, { needName: true });

  if (typeof b.channel !== "string" || !CHANNEL_RE.test(b.channel)) {
    throw new InputError("channel must be 1–32 chars of a-z, 0-9 and -");
  }
  const kind = (b.kind ?? "text") as PostKind;
  if (!KINDS.includes(kind)) throw new InputError(`kind must be one of ${KINDS.join(", ")}`);

  const text = b.text === undefined ? "" : b.text;
  if (typeof text !== "string" || text.length > LIMITS.text) {
    throw new InputError(`text must be a string of at most ${LIMITS.text} chars`);
  }
  if (kind === "text" && text.trim().length === 0) throw new InputError("a text post needs text");

  const lat = finiteIn(b.lat, -90, 90, "lat");
  const lng = finiteIn(b.lng, -180, 180, "lng");

  let place: string | undefined;
  if (b.place !== undefined) {
    if (typeof b.place !== "string" || !PLACE_RE.test(b.place)) {
      throw new InputError("place must be 1–64 chars of letters, digits and :._-");
    }
    place = b.place;
  }

  let mediaKey: string | undefined;
  if (kind !== "text") {
    if (typeof b.mediaKey !== "string" || !isTenantMediaKey(tenant, b.mediaKey)) {
      throw new InputError(`a ${kind} post needs the mediaKey from POST /media`);
    }
    mediaKey = b.mediaKey;
  } else if (b.mediaKey !== undefined) {
    throw new InputError("a text post takes no mediaKey");
  }

  let lifespan: number | null = LIMITS.maxLifespan;
  let sponsor: string | undefined;
  if (b.lifespan === "permanent") {
    if (typeof b.sponsor !== "string" || b.sponsor.trim().length === 0 || b.sponsor.length > LIMITS.sponsor) {
      throw new InputError(`a permanent post needs a sponsor label (1–${LIMITS.sponsor} chars)`);
    }
    lifespan = null;
    sponsor = b.sponsor.trim();
  } else if (b.lifespan !== undefined) {
    lifespan = Math.round(finiteIn(b.lifespan, LIMITS.minLifespan, LIMITS.maxLifespan, "lifespan"));
    if (b.sponsor !== undefined) throw new InputError('sponsor is only for lifespan: "permanent"');
  } else if (b.sponsor !== undefined) {
    throw new InputError('sponsor is only for lifespan: "permanent"');
  }

  let meta: Record<string, unknown> | undefined;
  if (b.meta !== undefined) {
    if (!b.meta || typeof b.meta !== "object" || Array.isArray(b.meta)) throw new InputError("meta must be a JSON object");
    if (Buffer.byteLength(JSON.stringify(b.meta)) > LIMITS.metaBytes) {
      throw new InputError(`meta must be at most ${LIMITS.metaBytes} bytes of JSON`);
    }
    meta = b.meta as Record<string, unknown>;
  }

  return {
    user, channel: b.channel, kind, text, lat, lng, gh6: encodeGeohash(lat, lng, 6),
    place, mediaKey, lifespan, sponsor, meta,
  };
}

export type FeedQuery =
  | { by: "place"; place: string; channels?: string[]; limit: number; user?: string }
  | { by: "near"; lat: number; lng: number; radius: number; channels?: string[]; limit: number; user?: string };

export function parseFeedQuery(params: URLSearchParams): FeedQuery {
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? LIMITS.defaultLimit : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.maxLimit) {
    throw new InputError(`limit must be an integer from 1 to ${LIMITS.maxLimit}`);
  }
  const channelRaw = params.get("channel");
  const channels = channelRaw ? channelRaw.split(",") : undefined;
  if (channels?.some((c) => !CHANNEL_RE.test(c))) throw new InputError("channel must be a comma list of slugs");
  const userRaw = params.get("user");
  if (userRaw !== null && !USER_ID_RE.test(userRaw)) throw new InputError("user must be a user id");
  const user = userRaw ?? undefined;

  const place = params.get("place");
  if (place !== null) {
    if (!PLACE_RE.test(place)) throw new InputError("place must be 1–64 chars of letters, digits and :._-");
    return { by: "place", place, channels, limit, user };
  }
  if (params.get("lat") === null || params.get("lng") === null) {
    throw new InputError("pass either place, or lat and lng");
  }
  const lat = finiteIn(Number(params.get("lat")), -90, 90, "lat");
  const lng = finiteIn(Number(params.get("lng")), -180, 180, "lng");
  const radius = params.get("radius") === null
    ? LIMITS.maxRadius
    : finiteIn(Number(params.get("radius")), 1, LIMITS.maxRadius, "radius");
  return { by: "near", lat, lng, radius, channels, limit, user };
}
