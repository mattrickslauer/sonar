// Server-only: the DSQL `channels` registry — the relational system-of-record
// for the OPEN channel set (replacing the old hardcoded enum) plus per-channel
// Stripe billing state for locked private channels. The hot radar read path must
// NOT hit DSQL per request, so channelExists()/getChannelsCached() serve from a
// short-lived in-process cache and degrade to the static core channels when DSQL
// is unreachable. See infra/sql/005_channels.sql + 008_channel_billing.sql.
import { randomBytes } from "node:crypto";
import { query } from "@/lib/server/dsql";
import { dsqlConfigured } from "@/lib/server/dsql";
import { CORE_CHANNEL_IDS, normalizeChannelSlug } from "@/lib/channels";

/** A random, unguessable URL-safe join-link token (base64url, 16 bytes ≈ 22
 *  chars). Distinct from the channel id — see 009_channel_join_token.sql. */
export function randomJoinToken(): string {
  return randomBytes(16).toString("base64url");
}

const SERIALIZATION_FAILURE = "40001"; // DSQL OCC conflict

/** Retry a unit of work on DSQL optimistic-concurrency conflicts (mirrors
 *  subscriptions.ts/accounts.ts). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if ((err as { code?: string })?.code === SERIALIZATION_FAILURE) continue;
      throw err;
    }
  }
  throw lastErr;
}

export interface ChannelRow {
  id: string;
  label: string;
  emoji: string | null;
  color: string | null;
  isPrivate: boolean;
  ownerAccountId: string | null;
  status: string;
  createdAt: string;
  joinToken: string | null;
}

const SELECT_COLS = `
  id, label, emoji, color, is_private AS "isPrivate",
  owner_account_id AS "ownerAccountId", status, created_at AS "createdAt",
  join_token AS "joinToken"
`;

/** One channel by id, or null. */
export async function getChannel(id: string): Promise<ChannelRow | null> {
  const res = await query<ChannelRow>(
    `SELECT ${SELECT_COLS} FROM channels WHERE id = $1 LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

/** All public channels (the discoverable set), PLUS the always-visible core
 *  channels regardless of their privacy flag — `safety` is seeded private only
 *  to keep its cosmetic lock icon, but it must still appear in the dock (its
 *  membership is never enforced; see accessibleChannels). User-created private
 *  channels remain unlisted and surface only via membership. */
export async function listPublicChannels(): Promise<ChannelRow[]> {
  const res = await query<ChannelRow>(
    `SELECT ${SELECT_COLS} FROM channels
       WHERE (is_private = false OR id = ANY($1)) AND status = 'active'
       ORDER BY created_at`,
    [CORE_CHANNEL_IDS],
  );
  return res.rows;
}

/** Type-ahead search over public channels by id or human label. */
export async function searchPublicChannels(q: string): Promise<ChannelRow[]> {
  const like = `%${q}%`;
  const res = await query<ChannelRow>(
    `SELECT ${SELECT_COLS} FROM channels
       WHERE is_private = false AND status = 'active'
         AND (label ILIKE $1 OR id ILIKE $2)
       ORDER BY created_at LIMIT 20`,
    [like, like],
  );
  return res.rows;
}

export interface InsertChannelInput {
  id: string;
  label: string;
  emoji?: string | null;
  color?: string | null;
  isPrivate?: boolean;
  ownerAccountId?: string | null;
  status?: string;
}

/**
 * Insert a channel, or return the existing one if the id is already taken. This
 * is the race-proof search-or-create primitive: `INSERT ... ON CONFLICT (id) DO
 * NOTHING RETURNING` — under a concurrent double-create exactly one INSERT wins
 * and RETURNINGs the row (created:true); the loser gets an empty RETURNING and
 * falls to the read-back (created:false). Duplicates are structurally impossible
 * because id is the PK. Distinct $-placeholders per column (DSQL 42P08).
 */
async function insertChannel(
  input: InsertChannelInput,
): Promise<{ channel: ChannelRow; created: boolean }> {
  return withRetry(async () => {
    const ins = await query<ChannelRow>(
      `INSERT INTO channels (id, label, emoji, color, is_private, owner_account_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING ${SELECT_COLS}`,
      [
        input.id,
        input.label.slice(0, 48),
        input.emoji ?? null,
        input.color ?? null,
        Boolean(input.isPrivate),
        input.ownerAccountId ?? null,
        input.status ?? "active",
      ],
    );
    if (ins.rows[0]) return { channel: ins.rows[0], created: true };
    const existing = await getChannel(input.id);
    if (!existing) throw new Error("channel vanished after conflict"); // retry on OCC
    return { channel: existing, created: false };
  });
}

/**
 * Search-or-create a PUBLIC channel from a user-entered name. The normalized
 * slug is the id, so re-creating an existing public name just joins it. A name
 * already claimed by a PRIVATE channel can't be reused publicly (names are
 * globally unique) → ChannelTakenError. Throws ChannelNameError if the name has
 * no usable characters (caller → 400). Invalidates the cache on create.
 */
export async function searchOrCreateChannel(input: {
  rawLabel: string;
  emoji?: string;
  color?: string;
  ownerAccountId?: string;
}): Promise<{ channel: ChannelRow; created: boolean }> {
  const id = normalizeChannelSlug(input.rawLabel);
  if (!id) throw new ChannelNameError();
  const result = await insertChannel({
    id,
    label: input.rawLabel.trim() || id,
    emoji: input.emoji ?? "📍",
    color: input.color ?? "#22d3ee",
    isPrivate: false,
    ownerAccountId: input.ownerAccountId ?? null,
    status: "active",
  });
  // The slug is already taken by a private channel — don't surface/join it.
  if (!result.created && result.channel.isPrivate) {
    throw new ChannelTakenError(`“${id}” is a private channel — choose another name`);
  }
  if (result.created) invalidateCache();
  return result;
}

/**
 * Create a LOCKED private channel. The normalized slug is the id (same keyspace
 * as public channels), so the name is reserved globally: status 'locked_unpaid'
 * until the Stripe webhook confirms payment, is_private=true so it never appears
 * in public search. If the slug is already taken, throws ChannelTakenError —
 * EXCEPT when the same owner is re-attempting their own still-unpaid channel, in
 * which case the existing row is returned so they can resume Checkout.
 */
export async function createPrivateChannel(input: {
  label: string;
  ownerAccountId: string;
  emoji?: string;
  color?: string;
}): Promise<ChannelRow> {
  const id = normalizeChannelSlug(input.label);
  if (!id) throw new ChannelNameError();
  const { channel, created } = await insertChannel({
    id,
    label: input.label.trim() || "Private channel",
    emoji: input.emoji ?? "🔒",
    color: input.color ?? "#a855f7",
    isPrivate: true,
    ownerAccountId: input.ownerAccountId,
    status: "locked_unpaid",
  });
  if (!created) {
    const ownerRetry =
      channel.isPrivate &&
      channel.status === "locked_unpaid" &&
      channel.ownerAccountId === input.ownerAccountId;
    if (!ownerRetry) {
      throw new ChannelTakenError(
        channel.isPrivate
          ? `“${id}” is already taken`
          : `“${id}” already exists as a public channel`,
      );
    }
    // Same owner, still unpaid → let them resume checkout on the existing row.
    return channel;
  }
  invalidateCache();
  return channel;
}

/** Flip a channel's lifecycle status ('active' | 'locked_unpaid' | 'expired'). */
export async function setChannelStatus(id: string, status: string): Promise<void> {
  await withRetry(async () => {
    await query(`UPDATE channels SET status = $2 WHERE id = $1`, [id, status]);
  });
  invalidateCache();
}

// ---------------------------------------------------------------------------
// Join links. The public link is /j/<joinToken>; the token is minted lazily the
// first time the owner views the link and can be rotated (regenerate) to revoke
// every outstanding link at once. See 009_channel_join_token.sql.
// ---------------------------------------------------------------------------

/** Resolve a join-link token to its channel, or null. Used by /api/join/[token];
 *  callers must still check status === 'active' && isPrivate before granting. */
export async function getChannelByJoinToken(token: string): Promise<ChannelRow | null> {
  if (!token) return null;
  const res = await query<ChannelRow>(
    `SELECT ${SELECT_COLS} FROM channels WHERE join_token = $1 LIMIT 1`,
    [token],
  );
  return res.rows[0] ?? null;
}

/** The channel's join token, minting one on first access. The conditional UPDATE
 *  (join_token IS NULL) is idempotent under DSQL OCC — two concurrent first-views
 *  converge on whichever token committed first (re-read after the retry). */
export async function getOrCreateJoinToken(channelId: string): Promise<string> {
  return withRetry(async () => {
    const existing = await getChannel(channelId);
    if (existing?.joinToken) return existing.joinToken;
    const token = randomJoinToken();
    const upd = await query<{ joinToken: string }>(
      `UPDATE channels SET join_token = $2
         WHERE id = $1 AND join_token IS NULL
         RETURNING join_token AS "joinToken"`,
      [channelId, token],
    );
    if (upd.rows[0]) {
      invalidateCache();
      return upd.rows[0].joinToken;
    }
    // Someone minted one underneath us → re-read it.
    const fresh = await getChannel(channelId);
    if (!fresh?.joinToken) throw new Error("join token vanished after mint"); // retry on OCC
    return fresh.joinToken;
  });
}

/** Rotate the join token, invalidating every existing link. Returns the new token. */
export async function rotateJoinToken(channelId: string): Promise<string> {
  const token = randomJoinToken();
  await withRetry(async () => {
    await query(`UPDATE channels SET join_token = $2 WHERE id = $1`, [channelId, token]);
  });
  invalidateCache();
  return token;
}

export interface MyChannelRow extends ChannelRow {
  role: string;
}

/** Active channels the account owns or belongs to, with the caller's membership
 *  role — powers the "My Channels" sheet. Joins channel_members → channels. */
export async function listMyChannelsWithRole(accountId: string): Promise<MyChannelRow[]> {
  const res = await query<MyChannelRow>(
    `SELECT c.id, c.label, c.emoji, c.color, c.is_private AS "isPrivate",
            c.owner_account_id AS "ownerAccountId", c.status,
            c.created_at AS "createdAt", c.join_token AS "joinToken", m.role
       FROM channel_members m
       JOIN channels c ON c.id = m.channel_id
      WHERE m.account_id = $1 AND c.status = 'active'
      ORDER BY c.created_at`,
    [accountId],
  );
  return res.rows;
}

/** Raised when a channel name normalizes to the empty string. */
export class ChannelNameError extends Error {
  constructor() {
    super("channel name has no usable characters");
    this.name = "ChannelNameError";
  }
}

/** Raised when a name is already in use. Channel names are globally unique (the
 *  normalized slug is the id for BOTH public and private channels), so a name
 *  claimed privately can't be reused publicly and vice versa — no duplicates. */
export class ChannelTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelTakenError";
  }
}

// ---------------------------------------------------------------------------
// Per-channel billing (locked private channels). See 008_channel_billing.sql.
// ---------------------------------------------------------------------------

export interface ChannelBillingRow {
  channelId: string;
  ownerAccountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  subscriptionItemId: string | null;
  priceId: string | null;
  status: string;
  currentPeriodEnd: string | null;
}

const BILLING_COLS = `
  channel_id AS "channelId", owner_account_id AS "ownerAccountId",
  stripe_customer_id AS "stripeCustomerId",
  stripe_subscription_id AS "stripeSubscriptionId",
  subscription_item_id AS "subscriptionItemId",
  price_id AS "priceId", status, current_period_end AS "currentPeriodEnd"
`;

export async function getChannelBilling(channelId: string): Promise<ChannelBillingRow | null> {
  const res = await query<ChannelBillingRow>(
    `SELECT ${BILLING_COLS} FROM channel_billing WHERE channel_id = $1 LIMIT 1`,
    [channelId],
  );
  return res.rows[0] ?? null;
}

/** The webhook's join key: subscription.* events carry the sub id, not channel_id
 *  (except in metadata) — resolve the channel by subscription id. */
export async function getChannelBillingBySubscription(
  subscriptionId: string,
): Promise<ChannelBillingRow | null> {
  const res = await query<ChannelBillingRow>(
    `SELECT ${BILLING_COLS} FROM channel_billing WHERE stripe_subscription_id = $1 LIMIT 1`,
    [subscriptionId],
  );
  return res.rows[0] ?? null;
}

export interface UpsertChannelBillingInput {
  channelId: string;
  ownerAccountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  subscriptionItemId?: string | null;
  priceId?: string | null;
  status: string;
  currentPeriodEnd?: number | null; // epoch seconds
}

/**
 * Insert-or-update a channel's billing row from a Stripe event. Keyed on
 * channel_id; idempotent so webhook retries/out-of-order deliveries converge.
 * Distinct $-placeholders per column even where values repeat (DSQL 42P08).
 */
export async function upsertChannelBilling(input: UpsertChannelBillingInput): Promise<void> {
  const periodEnd =
    input.currentPeriodEnd != null
      ? new Date(input.currentPeriodEnd * 1000).toISOString()
      : null;
  await withRetry(async () => {
    await query(
      `INSERT INTO channel_billing
         (channel_id, owner_account_id, stripe_customer_id, stripe_subscription_id,
          subscription_item_id, price_id, status, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (channel_id) DO UPDATE SET
         owner_account_id       = $9,
         stripe_customer_id     = $10,
         stripe_subscription_id = $11,
         subscription_item_id   = $12,
         price_id               = $13,
         status                 = $14,
         current_period_end     = $15,
         updated_at             = now()`,
      [
        input.channelId,
        input.ownerAccountId,
        input.stripeCustomerId,
        input.stripeSubscriptionId ?? null,
        input.subscriptionItemId ?? null,
        input.priceId ?? null,
        input.status,
        periodEnd,
        // ON CONFLICT update half — distinct placeholders, same values.
        input.ownerAccountId,
        input.stripeCustomerId,
        input.stripeSubscriptionId ?? null,
        input.subscriptionItemId ?? null,
        input.priceId ?? null,
        input.status,
        periodEnd,
      ],
    );
  });
}

/** Set just a billing row's status (cancel cascade keys off this). */
export async function setChannelBillingStatus(channelId: string, status: string): Promise<void> {
  await withRetry(async () => {
    await query(
      `UPDATE channel_billing SET status = $2, updated_at = now() WHERE channel_id = $1`,
      [channelId, status],
    );
  });
}

// ---------------------------------------------------------------------------
// In-process channel-set cache. Channels are tiny + change rarely; a short TTL
// keeps DSQL off the hot radar read path. Per-instance (Vercel functions are
// single-flight), and force-refresh-on-miss closes the create→drop window.
// ---------------------------------------------------------------------------

const CHANNEL_CACHE_TTL_MS = 60_000;
const CACHE_MISS_REFRESH_MS = 5_000; // don't re-hammer DSQL for genuinely-absent ids

let cache: { at: number; byId: Map<string, ChannelRow> } | undefined;

function invalidateCache(): void {
  cache = undefined;
}

async function refreshCache(): Promise<Map<string, ChannelRow>> {
  // Cache the FULL set (public + private) so channelExists works for any id.
  const res = await query<ChannelRow>(`SELECT ${SELECT_COLS} FROM channels`);
  const byId = new Map<string, ChannelRow>();
  for (const row of res.rows) byId.set(row.id, row);
  cache = { at: Date.now(), byId };
  return byId;
}

/** The channel set as a map, served from the in-process cache (refreshed every
 *  CHANNEL_CACHE_TTL_MS). Falls back to the static core channels if DSQL is
 *  unreachable/unconfigured so the radar never hard-fails. */
export async function getChannelsCached(): Promise<Map<string, ChannelRow>> {
  if (cache && Date.now() - cache.at < CHANNEL_CACHE_TTL_MS) return cache.byId;
  if (!dsqlConfigured()) return staticFallbackMap();
  try {
    return await refreshCache();
  } catch (err) {
    console.error("channel cache refresh failed; using static fallback", err);
    return cache?.byId ?? staticFallbackMap();
  }
}

function staticFallbackMap(): Map<string, ChannelRow> {
  const byId = new Map<string, ChannelRow>();
  for (const id of CORE_CHANNEL_IDS) {
    byId.set(id, {
      id,
      label: id,
      emoji: null,
      color: null,
      isPrivate: id === "safety",
      ownerAccountId: null,
      status: "active",
      createdAt: new Date(0).toISOString(),
      joinToken: null,
    });
  }
  return byId;
}

/**
 * Whether a channel id is registered. Consults the cache; on a miss against a
 * stale-enough cache it forces one refresh (covers a channel created on another
 * instance moments ago) before answering false. Always true for core ids even
 * when DSQL is down.
 */
export async function channelExists(id: string): Promise<boolean> {
  if (!id) return false;
  const byId = await getChannelsCached();
  if (byId.has(id)) return true;
  if (CORE_CHANNEL_IDS.includes(id)) return true;
  // Miss: if the cache is old enough, refresh once and re-check (a just-created
  // channel may not be in this instance's snapshot yet).
  if (dsqlConfigured() && (!cache || Date.now() - cache.at > CACHE_MISS_REFRESH_MS)) {
    try {
      const fresh = await refreshCache();
      return fresh.has(id);
    } catch {
      return false;
    }
  }
  return false;
}

/** Whether a channel is private (locked). Cache-served; unknown ids → false. */
export async function isPrivateChannel(id: string): Promise<boolean> {
  const byId = await getChannelsCached();
  return byId.get(id)?.isPrivate ?? false;
}
