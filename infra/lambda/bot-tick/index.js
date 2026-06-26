"use strict";

/**
 * Bot liveness tick.
 *
 * Trigger: EventBridge schedule (~1 min).
 * Job: keep quiet places feeling alive near real users.
 *   1. Query PK = `PRESENCE` → the gh6 cells that currently have a real user.
 *   2. For each cell, count waypoints already in it (across channels).
 *   3. If below the liveness target, drop templated bot waypoints
 *      (actorType=bot) scattered near the cell, ttl = createdAt + 15 min (BOT_TTL_SECONDS).
 *   4. Bot-love a couple of recent real drops (touches `love` only, never
 *      `realLove`, so it can't buy them time or make them permanent).
 *
 * Post text is generated fresh each tick by Claude Haiku (anthropic SDK +
 * SSM-resident API key, both in the `anthropic` layer) so drops read like real
 * in-the-moment festival chatter instead of a fixed script. The persona names,
 * channel, post kind, and the pre-uploaded seed media are unchanged — only the
 * caption text is model-written. Any failure (no key, API error, bad JSON)
 * falls back to the static FALLBACK_POOL below, so the tick never breaks.
 * DynamoDB access uses the AWS SDK v3 bundled in the Node 20 runtime.
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
// Bot drops are short-lived by default (15 min) so quiet cells churn fresh
// content instead of accreting a day's worth; override with BOT_TTL_SECONDS.
const TTL_SECONDS = Number(process.env.BOT_TTL_SECONDS || String(15 * 60));
// Cap how far back createdAt is staggered so a drop is never born already
// expired — must stay well under the lifespan. ~1/3 of it, capped at 5 min.
const MAX_STAGGER_MS = Math.min(5 * 60000, Math.floor(TTL_SECONDS * 1000 * 0.33));
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

// Claude model for bot caption generation. Haiku is fast + cheap enough to run
// on the per-minute hot path; quality is fine for short, casual status posts.
const BOT_MODEL = "claude-haiku-4-5";
// SSM Parameter Store path holding the Anthropic API key (set by the stack as
// ANTHROPIC_API_KEY_PARAM). A plain ANTHROPIC_API_KEY env var, if present, wins.
const API_KEY_PARAM = process.env.ANTHROPIC_API_KEY_PARAM;
// Mapbox token for reverse-geocoding a cell to a place name, so captions are
// grounded in where they actually drop. Public (NEXT_PUBLIC) token; unset →
// captions still generate, just without a location hint. Set by the stack.
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
// Soft cap on deficit cells that get a live (Haiku + geocode) top-up per tick;
// any beyond it fall back to the static pool, bounding per-tick model spend.
const MAX_LLM_CELLS = Number(process.env.BOT_LLM_CELLS_PER_TICK || "10");

// --- bot persona / content pool ----------------------------------------------
// FALLBACK_POOL is the static script used when Haiku is unavailable (no key,
// API error, or malformed output). The live path replaces the `text` with a
// model-written caption but keeps the same personas, kinds, and channel.
// Every bot drop lands in the always-present `general` channel so the radar is
// never empty there. The text stays varied (the old per-topic flavor) but the
// channel is uniform — bots no longer scatter across the five themed channels.
const FALLBACK_POOL = [
  { channel: "general", kind: "voice", author: "maya", text: "north stage just dropped the headliner set 🔊 it's unreal" },
  { channel: "general", kind: "photo", author: "deon", text: "birria tacos truck by gate C — line is short rn" },
  { channel: "general", kind: "text", author: "priya", text: "anyone near the ferris wheel? lost my crew lol" },
  { channel: "general", kind: "text", author: "sam", text: "silent disco starts in 20 at the grove tent" },
  { channel: "general", kind: "text", author: "ops", text: "minor congestion at east exit, use north path" },
  { channel: "general", kind: "text", author: "lena", text: "vegan bowl spot ran out of tofu, fyi" },
  { channel: "general", kind: "video", author: "kai", text: "crowd surf moment at main stage 🤘" },
  { channel: "general", kind: "photo", author: "theo", text: "best sunset spot is the hill behind stage 2" },
  { channel: "general", kind: "text", author: "nina", text: "art installation lights up at dusk, worth it" },
  { channel: "general", kind: "photo", author: "marco", text: "fresh lemonade stand, $4, west plaza" },
  { channel: "general", kind: "text", author: "jules", text: "acoustic set at the cabin tent, super chill vibe" },
  { channel: "general", kind: "voice", author: "ade", text: "meetup at the flag pole in 10 if anyone's around" },
  { channel: "general", kind: "text", author: "ops", text: "water refill station added near south gate" },
  { channel: "general", kind: "photo", author: "rosa", text: "fireworks confirmed 10pm over the lake" },
  { channel: "general", kind: "text", author: "finn", text: "bass tent is shaking the ground, come thru" },
  { channel: "general", kind: "text", author: "ivy", text: "coffee cart restocked oat milk ☕" },
  { channel: "general", kind: "text", author: "remy", text: "phone charging lockers by info booth, free" },
  { channel: "general", kind: "video", author: "zoe", text: "drone show rehearsal happening now look up" },
];

// The channels the bot considers when measuring per-cell liveness and topping
// up. Bots post only to `general`, so this is the deficit denominator too.
const CHANNELS = ["general"];

// Persistent seed media in the media bucket under seed/ (never lifecycle-expired;
// see infra/lib/sonar-stack.ts). Bot photo/video drops point at these so the
// radar shows real blobs, resolved client-side via /api/media/view.
const SEED_PHOTOS = [
  "seed/photo/scene-1.jpg",
  "seed/photo/scene-2.jpg",
  "seed/photo/scene-3.jpg",
  "seed/photo/scene-4.jpg",
];
const SEED_VIDEOS = ["seed/video/clip-1.mp4", "seed/video/clip-2.mp4"];

function seedMediaKey(kind) {
  if (kind === "photo") return SEED_PHOTOS[Math.floor(Math.random() * SEED_PHOTOS.length)];
  if (kind === "video") return SEED_VIDEOS[Math.floor(Math.random() * SEED_VIDEOS.length)];
  return undefined; // text/voice carry no blob
}

// --- Haiku caption generation -----------------------------------------------
// The personas and the four post kinds the model may use. Constrained via the
// structured-output schema so authors stay consistent and `kind` always maps to
// the media wiring above (photo/video → a seed blob; text/voice → none).
const AUTHORS = [...new Set(FALLBACK_POOL.map((p) => p.author))];
const KINDS = ["text", "photo", "video", "voice"];

const POST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: KINDS },
          author: { type: "string", enum: AUTHORS },
          text: { type: "string" },
        },
        required: ["kind", "author", "text"],
      },
    },
  },
  required: ["posts"],
};

const SYSTEM_PROMPT = [
  "You write short, in-the-moment posts for Sonar, a location-based radar app.",
  "Every post is from someone physically at a big outdoor music festival right now",
  "— stages, food trucks, crowds, art installations, sunset, fireworks, drone shows.",
  "Match that scene: the app shows real festival photos and clips, so captions must",
  "fit festival imagery.",
  "",
  "Voice and rules:",
  "- Casual, lowercase, present-tense, like a quick phone status. Usually under 100 chars.",
  "- A real person reacting to or sharing something happening near them right now.",
  "- At most one emoji, and only sometimes. No hashtags, no @mentions, no quotation marks.",
  "- Vary the content: music, food, meetups, lost-and-found, logistics, scenery, hype.",
  "- The persona named `ops` is the official event operations account — only ops posts",
  "  logistics/announcements (exits, water, charging, congestion); everyone else is an attendee.",
  "- `kind` is the post type: `text` (no media), `photo` (sharing a still),",
  "  `video` (sharing motion/a clip), `voice` (a spoken shout-out). Bias toward `text`,",
  "  with a few `photo`/`voice` and the occasional `video`.",
  "- If a location is given, ground the posts in that place — its local flavor, landmarks,",
  "  and the season for its hemisphere/time of year — while still fitting festival imagery.",
  "- Make the captions distinct from one another.",
].join("\n");

// Reverse-geocode a cell center to a human place name (e.g. "Punta Arenas,
// Magallanes, Chile"). Cached per gh6 across warm invocations — a ~1.2km cell's
// place name doesn't change, so we hit Mapbox at most once per cell per cold
// start. Returns null when there's no token or the lookup fails.
const _placeCache = new Map(); // gh6 → place name | null
async function placeForCell(gh6, lat, lng) {
  if (!MAPBOX_TOKEN) return null;
  if (_placeCache.has(gh6)) return _placeCache.get(gh6);
  let place = null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,region&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      place = data?.features?.[0]?.place_name || null;
    } else {
      console.error("bot tick: reverse geocode HTTP", res.status);
    }
  } catch (err) {
    console.error("bot tick: reverse geocode failed", err);
  }
  _placeCache.set(gh6, place);
  return place;
}

let _anthropic; // memoized SDK client (warm-invocation reuse)
let _keyPromise; // memoized key lookup

async function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (!API_KEY_PARAM) return null;
  if (!_keyPromise) {
    _keyPromise = (async () => {
      try {
        const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
        const ssm = new SSMClient({ region: REGION });
        const res = await ssm.send(
          new GetParameterCommand({ Name: API_KEY_PARAM, WithDecryption: true })
        );
        return res.Parameter?.Value || null;
      } catch (err) {
        console.error("bot tick: failed to load Anthropic key from SSM", err);
        return null;
      }
    })();
  }
  return _keyPromise;
}

async function getClient() {
  const key = await getApiKey();
  if (!key) return null;
  if (!_anthropic) {
    const mod = require("@anthropic-ai/sdk");
    const Anthropic = mod.default ?? mod;
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

/**
 * Ask Haiku for a fresh batch of festival captions, optionally grounded in a
 * place name. Returns an array of { channel, kind, author, text } in the same
 * shape as FALLBACK_POOL, or null on any failure so the caller can fall back to
 * the static pool.
 */
async function generatePool(count, place) {
  const client = await getClient();
  if (!client) return null;
  try {
    const where = place ? ` near ${place}` : "";
    const resp = await client.messages.create({
      model: BOT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write ${count} distinct festival posts happening right now${where}.`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: POST_SCHEMA } },
    });
    const block = (resp.content || []).find((b) => b.type === "text");
    if (!block) return null;
    const parsed = JSON.parse(block.text);
    const posts = (parsed.posts || [])
      .filter(
        (p) =>
          p &&
          KINDS.includes(p.kind) &&
          AUTHORS.includes(p.author) &&
          typeof p.text === "string" &&
          p.text.trim().length > 0
      )
      .map((p) => ({
        channel: "general", // bots post only to the always-present general channel
        kind: p.kind,
        author: p.author,
        text: p.text.trim(),
      }));
    return posts.length ? posts : null;
  } catch (err) {
    console.error("bot tick: Haiku caption generation failed", err);
    return null;
  }
}

function buildBotItem(template, center, now) {
  // Scatter 40–900m around the cell's resident, then re-derive the cell from
  // the scattered point so the item lands in its true geohash partition.
  const meters = 40 + Math.random() * 860;
  const bearing = Math.random() * 360;
  const pos = offset(center, meters, bearing);
  const gh6 = encodeGeohash(pos.lat, pos.lng, 6);
  // Stagger createdAt back a few minutes for a natural spread, but never past
  // the (short) lifespan or the drop would be born expired.
  const createdAt = now - Math.floor(Math.random() * MAX_STAGGER_MS);
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
    realLove: 0, // bots never touch realLove → can't buy time or earn permanence
    sponsored: false,
    // photo/video bots get a seed blob; undefined is stripped (removeUndefinedValues).
    mediaKey: seedMediaKey(template.kind),
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
  let llmCells = 0; // deficit cells given a live (Haiku) top-up this tick

  for (const [gh6, center] of cells) {
    const existing = await waypointsInCell(gh6);
    const deficit = LIVENESS_TARGET - existing.length;

    // 1. Top up quiet cells with fresh bot waypoints, captioned by Haiku and
    //    grounded in the cell's actual place. Beyond MAX_LLM_CELLS per tick, or
    //    on any model failure, fall back to the static pool.
    if (deficit > 0) {
      const n = Math.min(deficit, MAX_DROPS_PER_TICK);
      let pool = null;
      if (llmCells < MAX_LLM_CELLS) {
        const place = await placeForCell(gh6, center.lat, center.lng);
        pool = await generatePool(n, place);
        if (pool) llmCells++;
      }
      const source = pool ? "haiku" : "fallback";
      pool = pool ?? FALLBACK_POOL;
      const start = Math.floor(Math.random() * pool.length);
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push(buildBotItem(pool[(start + i) % pool.length], center, now));
      }
      await batchPut(items);
      dropped += items.length;
      console.log("bot tick: topup", { gh6, source, n });
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
