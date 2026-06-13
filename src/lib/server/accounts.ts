// Server-only: durable account records in Aurora DSQL — the system-of-record
// for identity. The canonical userId across BOTH stores is `accounts.id`; the
// DynamoDB hot path (waypoints/loves/presence) only ever references it. See
// docs/data-model.md and the auth design.
//
// Identity lifecycle: an anonymous device is an `accounts` row with
// claimed_at = null (id generated client-side). "Claiming" upgrades that row
// in place — set email/google_sub/claimed_at — so the id never changes and all
// existing DynamoDB activity stays attached with ZERO migration.
import { randomUUID } from "node:crypto";
import { query } from "@/lib/server/dsql";

export interface Account {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isBot: boolean;
  email: string | null;
  googleSub: string | null;
  authMethod: string | null;
  claimedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Raised when an unauthenticated caller supplies the id of an already-claimed
 *  account. A claimed account may only be acted as via its session — never via
 *  a spoofed anonymous id — so the write path must reject this. */
export class AccountClaimedError extends Error {
  constructor() {
    super("account is claimed; sign in to act as it");
    this.name = "AccountClaimedError";
  }
}

// PostgreSQL SQLSTATEs we branch on.
const UNIQUE_VIOLATION = "23505";
const SERIALIZATION_FAILURE = "40001"; // DSQL OCC conflict

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/** A fresh client-side identity. Used when the browser has none yet. */
export function newAccountId(): string {
  return randomUUID();
}

const SELECT_COLS = `
  id, handle, display_name AS "displayName", avatar_url AS "avatarUrl",
  is_bot AS "isBot", email, google_sub AS "googleSub",
  auth_method AS "authMethod", claimed_at AS "claimedAt",
  last_login_at AS "lastLoginAt", created_at AS "createdAt"
`;

async function fetchOne(where: string, params: unknown[]): Promise<Account | null> {
  const res = await query<Account>(
    `SELECT ${SELECT_COLS} FROM accounts WHERE ${where} LIMIT 1`,
    params,
  );
  return res.rows[0] ?? null;
}

export function getAccountById(id: string): Promise<Account | null> {
  return fetchOne("id = $1", [id]);
}

export function getAccountByEmail(email: string): Promise<Account | null> {
  // Emails are matched case-insensitively; we always store them lowercased.
  return fetchOne("email = $1", [email.toLowerCase()]);
}

export function getAccountByGoogleSub(sub: string): Promise<Account | null> {
  return fetchOne("google_sub = $1", [sub]);
}

/**
 * Retry a unit of work on DSQL optimistic-concurrency conflicts. DSQL aborts
 * conflicting transactions at commit with a serialization error rather than
 * blocking; the documented pattern is idempotent retry.
 */
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

/**
 * Ensure an anonymous account row exists for a client-generated id, creating an
 * unclaimed one on first write. Idempotent (ON CONFLICT DO NOTHING).
 *
 * SECURITY: rejects ids that already belong to a *claimed* account — an
 * unauthenticated caller must not be able to write as a claimed account by
 * guessing/replaying its id. Such callers must present a session instead.
 *
 * @param referredBy when this account was reached via a shared waypoint link
 *   (`?r=<username>`), the sharer's username — stamped set-once for attribution
 *   (best-effort; never blocks the write). See attachReferral.
 */
export async function ensureAnonymousAccount(
  id: string,
  referredBy?: string,
): Promise<Account> {
  if (!isUuid(id)) throw new Error("invalid account id");
  return withRetry(async () => {
    // Create the unclaimed row if absent. handle = id keeps the UNIQUE NOT NULL
    // handle satisfied without a human handle yet; display_name defaults to "you".
    await query(
      `INSERT INTO accounts (id, handle, display_name)
       VALUES ($1, $1, 'you')
       ON CONFLICT (id) DO NOTHING`,
      [id],
    );
    const account = await getAccountById(id);
    if (!account) throw new Error("account row vanished after insert");
    if (account.claimedAt) throw new AccountClaimedError();
    if (referredBy) await attachReferral(id, referredBy);
    return account;
  });
}

/**
 * Record who referred this (still anonymous) account, set-once. Attribution is
 * strictly best-effort: it must NEVER break the user's drop/love, so a missing
 * `referred_by` column (cluster not yet migrated with 002_referrals.sql) or any
 * other failure is swallowed. The `referred_by IS NULL` guard makes it idempotent
 * — the first referral wins and later writes are cheap no-ops — and the
 * `claimed_at IS NULL` guard avoids relabelling an already-established account.
 */
async function attachReferral(id: string, referrer: string): Promise<void> {
  const clean = referrer.trim().slice(0, 64);
  if (!clean) return;
  try {
    await query(
      `UPDATE accounts SET referred_by = $2, referred_at = now()
       WHERE id = $1 AND referred_by IS NULL AND claimed_at IS NULL`,
      [id, clean],
    );
  } catch (err) {
    console.error("attachReferral failed (non-fatal)", err);
  }
}

export interface ClaimIdentity {
  /** Verified email (from OTP) or the Google account's email. */
  email?: string;
  /** Google subject id, when signing in with Google. */
  googleSub?: string;
  /** Display name to set on claim (e.g. Google name, or email local-part). */
  displayName?: string;
  avatarUrl?: string;
  authMethod: "email_otp" | "google";
}

export interface ClaimResult {
  account: Account;
  /** true if this created/upgraded an account (first claim); false if it was an
   *  existing account the user signed back into. */
  claimed: boolean;
}

/**
 * Resolve a verified sign-in into an account, binding it to the caller's
 * anonymous device row when this is a first claim.
 *
 * - If an account already exists for this identity (email or google_sub) →
 *   SIGN IN: return it (the device's ephemeral anon row is simply abandoned and
 *   TTL-expires). For Google-on-an-email-only account, link the google_sub.
 * - Otherwise → CLAIM: upgrade the device's anon row in place (zero DynamoDB
 *   migration). If that row is missing or already claimed by someone else,
 *   create a fresh account.
 *
 * Concurrency: a unique-violation (two devices claiming one identity at once)
 * collapses to the sign-in path.
 */
export async function claimOrSignIn(
  deviceAccountId: string,
  identity: ClaimIdentity,
): Promise<ClaimResult> {
  const email = identity.email?.toLowerCase();
  const { googleSub, authMethod } = identity;
  if (!email && !googleSub) throw new Error("claim needs an email or google_sub");

  return withRetry(async () => {
    // 1) Already known identity? → sign in.
    const existing = googleSub
      ? (await getAccountByGoogleSub(googleSub)) ?? (email ? await getAccountByEmail(email) : null)
      : email
        ? await getAccountByEmail(email)
        : null;

    if (existing) {
      // Link a google_sub onto an email-first account the first time they use Google.
      if (googleSub && !existing.googleSub) {
        await query(
          `UPDATE accounts SET google_sub = $2, last_login_at = now() WHERE id = $1`,
          [existing.id, googleSub],
        );
      } else {
        await query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [existing.id]);
      }
      const refreshed = (await getAccountById(existing.id))!;
      return { account: refreshed, claimed: false };
    }

    // 2) New identity → claim the device's anon row in place if we can.
    const displayName = identity.displayName?.trim() || email?.split("@")[0] || "you";
    let targetId = deviceAccountId;
    const device = isUuid(deviceAccountId) ? await getAccountById(deviceAccountId) : null;
    if (!device || device.claimedAt || device.isBot) {
      // No usable anon row (never wrote, already claimed, or a bot id) → fresh account.
      targetId = newAccountId();
      await query(`INSERT INTO accounts (id, handle, display_name) VALUES ($1, $1, $2)`, [
        targetId,
        displayName,
      ]);
    }

    try {
      // Claim only if still unclaimed — guards against a concurrent claim of the
      // same device row.
      const upd = await query<Account>(
        `UPDATE accounts
           SET email = $2, google_sub = $3, auth_method = $4,
               display_name = $5, claimed_at = now(), last_login_at = now()
         WHERE id = $1 AND claimed_at IS NULL
         RETURNING ${SELECT_COLS}`,
        [targetId, email ?? null, googleSub ?? null, authMethod, displayName],
      );
      if (upd.rows[0]) return { account: upd.rows[0], claimed: true };
      // Row got claimed underneath us → fall through to re-read by identity.
    } catch (err) {
      if ((err as { code?: string })?.code !== UNIQUE_VIOLATION) throw err;
      // Someone else claimed this email/google_sub first → sign into theirs.
    }

    const winner =
      (googleSub && (await getAccountByGoogleSub(googleSub))) ||
      (email && (await getAccountByEmail(email))) ||
      null;
    if (!winner) throw new Error("claim failed and no existing account found");
    return { account: winner, claimed: false };
  });
}

/** Record a successful login timestamp (best-effort). */
export async function recordLogin(id: string): Promise<void> {
  await query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [id]);
}
