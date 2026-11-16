// Sonar Platform — tenants, keys, posts, likes and usage in the `sonar` table.
// Every item a tenant owns starts `T#<tenant>#`, so nothing here is reachable
// from the mysonar.zone radar (whose partitions start `CH#`) and the live
// fan-out skips it (infra/lambda/fanout). Contract: docs/platform/api.md.
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE } from "@/lib/server/dynamo";
import { cellAndNeighbors } from "@/lib/geohash";
import { distance } from "@/lib/geo";
import { viewUrl } from "@/lib/server/media";
import {
  FeedQuery,
  NewPost,
  hashApiKey,
  hourStamp,
  k,
  makePostId,
  minuteStamp,
  parsePostId,
  ulid,
} from "./core";

const PERMANENT_TTL = Math.floor(Date.UTC(2999, 0, 1) / 1000);
const LOVE_EXTENSION_SECONDS = 5 * 60;
const USAGE_TTL_SECONDS = 400 * 24 * 60 * 60;
export const DEFAULT_RATE_PER_MINUTE = 600;

// ---------------------------------------------------------------------------
// Tenants and keys (created and revoked by scripts/platform-tenant.mjs)
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  status: "active" | "suspended";
  /** Browser origins allowed to upload with this tenant's media tickets. */
  origins: string[];
  ratePerMinute: number;
  createdAt: number;
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: k.tenant(id) }));
  return (res.Item as Tenant | undefined) ?? null;
}

export type AuthResult =
  | { ok: true; tenant: Tenant }
  | { ok: false; status: 401 | 403; code: string; message: string };

export async function authenticateKey(key: string): Promise<AuthResult> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: k.apiKey(hashApiKey(key)) }));
  const item = res.Item;
  if (!item || item.revokedAt) {
    return { ok: false, status: 401, code: "invalid_key", message: "unknown or revoked API key" };
  }
  const tenant = await getTenant(String(item.tenant));
  if (!tenant) return { ok: false, status: 401, code: "invalid_key", message: "unknown or revoked API key" };
  if (tenant.status !== "active") {
    return { ok: false, status: 403, code: "tenant_suspended", message: "this account is suspended" };
  }
  return { ok: true, tenant };
}

// ---------------------------------------------------------------------------
// Rate limit and usage
// ---------------------------------------------------------------------------

/** Counts one request in this minute's window; false when the budget is spent. */
export async function takeRequest(tenant: Tenant, now = Date.now()): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: k.rate(tenant.id, minuteStamp(now)),
      UpdateExpression: "ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)",
      ConditionExpression: "attribute_not_exists(n) OR n < :max",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":max": tenant.ratePerMinute || DEFAULT_RATE_PER_MINUTE,
        ":ttl": Math.floor(now / 1000) + 180,
      },
    }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export type UsageField = "requests" | "posts" | "uploads" | "moderations";

/** Best-effort: adds to this hour's usage row. Never fails the request. */
export async function recordUsage(tenant: string, add: Partial<Record<UsageField, number>>, now = Date.now()): Promise<void> {
  const entries = Object.entries(add).filter(([, v]) => v);
  if (entries.length === 0) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: k.usage(tenant, hourStamp(now)),
    UpdateExpression: `ADD ${entries.map(([f]) => `#${f} :${f}`).join(", ")} SET #ttl = if_not_exists(#ttl, :ttl)`,
    ExpressionAttributeNames: { ...Object.fromEntries(entries.map(([f]) => [`#${f}`, f])), "#ttl": "ttl" },
    ExpressionAttributeValues: {
      ...Object.fromEntries(entries.map(([f, v]) => [`:${f}`, v])),
      ":ttl": Math.floor(now / 1000) + USAGE_TTL_SECONDS,
    },
  })).catch((e) => console.error("platform usage write failed", e?.name));
}

export async function readUsage(tenant: string, days: number, now = Date.now()) {
  const from = hourStamp(now - days * 86400_000);
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk AND SK >= :from",
    ExpressionAttributeValues: { ":pk": k.usage(tenant, "").PK, ":from": from },
  }));
  return (res.Items ?? []).map((it) => ({
    hour: String(it.SK),
    requests: Number(it.requests ?? 0),
    posts: Number(it.posts ?? 0),
    uploads: Number(it.uploads ?? 0),
    moderations: Number(it.moderations ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface Post {
  id: string;
  channel: string;
  kind: string;
  text: string;
  author: string;
  userId: string;
  lat: number;
  lng: number;
  place: string | null;
  createdAt: number;
  expiresAt: number | null;
  permanent: boolean;
  sponsor: string | null;
  love: number;
  loved?: boolean;
  mediaUrl: string | null;
  meters?: number;
  meta: Record<string, unknown> | null;
}

type Item = Record<string, unknown>;

function isLiveItem(it: Item, now: number): boolean {
  return Number(it.ttl) * 1000 > now;
}

async function toPost(it: Item): Promise<Post> {
  const permanent = Boolean(it.permanent);
  const mediaKey = typeof it.mediaKey === "string" ? it.mediaKey : null;
  return {
    id: makePostId(String(it.gh6), String(it.ulid)),
    channel: String(it.channel),
    kind: String(it.kind),
    text: String(it.text ?? ""),
    author: String(it.author),
    userId: String(it.userId),
    lat: Number(it.lat),
    lng: Number(it.lng),
    place: typeof it.place === "string" ? it.place : null,
    createdAt: Number(it.createdAt),
    expiresAt: permanent ? null : Number(it.ttl) * 1000,
    permanent,
    sponsor: typeof it.sponsor === "string" ? it.sponsor : null,
    love: Number(it.love ?? 0),
    mediaUrl: mediaKey ? await viewUrl(mediaKey) : null,
    meta: it.meta ? (JSON.parse(String(it.meta)) as Record<string, unknown>) : null,
  };
}

export async function createPost(tenant: string, p: NewPost, now = Date.now()): Promise<Post> {
  const id = ulid(now);
  const item: Item = {
    ...k.post(tenant, p.gh6, id),
    // GSI1 = the place wall, newest last by ULID.
    ...(p.place ? { GSI1PK: k.place(tenant, p.place), GSI1SK: `WP#${id}` } : {}),
    tenant,
    ulid: id,
    gh6: p.gh6,
    channel: p.channel,
    kind: p.kind,
    text: p.text,
    author: p.user.name,
    userId: p.user.id,
    lat: p.lat,
    lng: p.lng,
    place: p.place,
    mediaKey: p.mediaKey,
    createdAt: now,
    ttl: p.lifespan === null ? PERMANENT_TTL : Math.floor(now / 1000) + p.lifespan,
    permanent: p.lifespan === null,
    sponsor: p.sponsor,
    actorType: p.lifespan === null ? "sponsor" : "human",
    love: 0,
    // meta is stored as a JSON string so arbitrary tenant shapes never collide
    // with DynamoDB's type rules (empty strings, nested sets, …).
    meta: p.meta ? JSON.stringify(p.meta) : undefined,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
  return toPost(item);
}

async function getItem(tenant: string, postId: string): Promise<Item | null> {
  const parsed = parsePostId(postId);
  if (!parsed) return null;
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: k.post(tenant, parsed.gh6, parsed.ulid) }));
  return res.Item ?? null;
}

async function lovedSet(tenant: string, items: Item[], user: string): Promise<Set<string>> {
  const loved = new Set<string>();
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE]: { Keys: chunk.map((it) => k.love(tenant, String(it.ulid), user)), ProjectionExpression: "PK" },
      },
    }));
    for (const r of res.Responses?.[TABLE] ?? []) loved.add(String(r.PK).split("#WP#")[1]);
  }
  return loved;
}

async function decorate(tenant: string, items: Item[], user?: string): Promise<Post[]> {
  const loved = user ? await lovedSet(tenant, items, user) : null;
  return Promise.all(items.map(async (it) => {
    const post = await toPost(it);
    if (loved) post.loved = loved.has(String(it.ulid));
    return post;
  }));
}

export async function getPost(tenant: string, postId: string, user?: string, now = Date.now()): Promise<Post | null> {
  const it = await getItem(tenant, postId);
  if (!it || !isLiveItem(it, now)) return null;
  return (await decorate(tenant, [it], user))[0];
}

export async function deletePost(tenant: string, postId: string): Promise<boolean> {
  const parsed = parsePostId(postId);
  if (!parsed) return false;
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: k.post(tenant, parsed.gh6, parsed.ulid),
      ConditionExpression: "attribute_exists(PK)",
    }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function readFeed(tenant: string, q: FeedQuery, now = Date.now()): Promise<Post[]> {
  const wanted = (it: Item) =>
    isLiveItem(it, now) && (!q.channels || q.channels.includes(String(it.channel)));

  if (q.by === "place") {
    const out: Item[] = [];
    let start: Record<string, unknown> | undefined;
    // Newest first; expired posts are skipped, so page until the limit fills.
    do {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :p AND begins_with(GSI1SK, :wp)",
        ExpressionAttributeValues: { ":p": k.place(tenant, q.place), ":wp": "WP#" },
        ScanIndexForward: false,
        Limit: 100,
        ExclusiveStartKey: start,
      }));
      out.push(...(res.Items ?? []).filter(wanted));
      start = res.LastEvaluatedKey;
    } while (start && out.length < q.limit);
    return decorate(tenant, out.slice(0, q.limit), q.user);
  }

  const center = { lat: q.lat, lng: q.lng };
  const pages = await Promise.all(cellAndNeighbors(q.lat, q.lng, 6).map((cell) =>
    ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :wp)",
      ExpressionAttributeValues: { ":pk": k.cell(tenant, cell), ":wp": "WP#" },
    })),
  ));
  const near = pages
    .flatMap((r) => r.Items ?? [])
    .filter(wanted)
    .map((it) => ({ it, meters: distance(center, { lat: Number(it.lat), lng: Number(it.lng) }) }))
    .filter((x) => x.meters <= q.radius)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, q.limit);
  const posts = await decorate(tenant, near.map((x) => x.it), q.user);
  posts.forEach((p, i) => { p.meters = Math.round(near[i].meters); });
  return posts;
}

// ---------------------------------------------------------------------------
// Likes buy time
// ---------------------------------------------------------------------------

export interface LoveResult {
  love: number;
  counted: boolean;
  expiresAt: number | null;
}

/** `+1` likes (adds 5 minutes of life), `-1` unlikes (refunds them). Null when the post is gone. */
export async function setLove(tenant: string, postId: string, user: string, dir: 1 | -1, now = Date.now()): Promise<LoveResult | null> {
  const it = await getItem(tenant, postId);
  if (!it || !isLiveItem(it, now)) return null;
  const permanent = Boolean(it.permanent);
  const edge = k.love(tenant, String(it.ulid), user);
  const current = (): LoveResult => ({
    love: Number(it.love ?? 0),
    counted: false,
    expiresAt: permanent ? null : Number(it.ttl) * 1000,
  });

  try {
    if (dir === 1) {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        // The edge outlives the post by a day so a like can't be repeated while it lives.
        Item: { ...edge, createdAt: now, ...(permanent ? {} : { ttl: Number(it.ttl) + 86400 + 86400 }) },
        ConditionExpression: "attribute_not_exists(PK)",
      }));
    } else {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: edge, ConditionExpression: "attribute_exists(PK)" }));
    }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return current();
    throw err;
  }

  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: String(it.PK), SK: String(it.SK) },
      // Permanent pins keep their far-future ttl; only the count moves.
      UpdateExpression: permanent ? "ADD love :d" : "ADD love :d, #ttl :ext",
      ConditionExpression: "attribute_exists(PK)",
      ...(permanent ? {} : { ExpressionAttributeNames: { "#ttl": "ttl" } }),
      ExpressionAttributeValues: { ":d": dir, ...(permanent ? {} : { ":ext": dir * LOVE_EXTENSION_SECONDS }) },
      ReturnValues: "ALL_NEW",
    }));
    const a = res.Attributes ?? {};
    return { love: Number(a.love ?? 0), counted: true, expiresAt: permanent ? null : Number(a.ttl) * 1000 };
  } catch (err) {
    // The post vanished between the read and the bump: undo the edge.
    if (err instanceof ConditionalCheckFailedException) {
      if (dir === 1) await ddb.send(new DeleteCommand({ TableName: TABLE, Key: edge })).catch(() => {});
      return null;
    }
    throw err;
  }
}
