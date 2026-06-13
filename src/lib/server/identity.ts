// Server-only: resolve the acting identity for a request to the canonical
// userId (= accounts.id) used across DynamoDB and DSQL.
//
// Precedence:
//   1. A valid session cookie → the claimed account. Authoritative; the client
//      cannot override it with a body/query field.
//   2. Otherwise → the client-supplied anonymous id, which must be an unclaimed
//      account (ensureAnonymousAccount enforces this — a claimed id is rejected
//      so nobody can write as someone else's account without their session).
//
// When DSQL isn't configured we degrade to a pure-DynamoDB anonymous identity
// (the app still works; accounts/claiming are just unavailable).
import { readSession } from "@/lib/server/session";
import {
  ensureAnonymousAccount,
  AccountClaimedError,
  isUuid,
} from "@/lib/server/accounts";
import { dsqlConfigured } from "@/lib/server/dsql";

export interface Identity {
  /** The canonical userId for keying DynamoDB + joining DSQL. */
  userId: string;
  /** Display handle for denormalized `author` on drops. */
  displayName: string;
  /** Whether this came from a verified session (claimed account). */
  authed: boolean;
}

/** Raised when the anonymous id is missing/invalid and no session is present. */
export class NoIdentityError extends Error {
  constructor() {
    super("no session and no valid anonymous id");
    this.name = "NoIdentityError";
  }
}

export interface ResolveOptions {
  /**
   * Whether a meaningful write action should lazily create the anonymous
   * account row in DSQL (per the "create on first drop/love" design). Set false
   * for hot, non-sensitive, or read paths (heartbeats, loved-state reads): they
   * use the validated anon id as an opaque userId without touching DSQL.
   */
  ensure?: boolean;
}

/**
 * @param anonId the client-supplied anonymous account id (from body/query),
 *               used only when there is no session.
 */
export async function resolveIdentity(
  req: Request,
  anonId: string | undefined,
  { ensure = true }: ResolveOptions = {},
): Promise<Identity> {
  const session = await readSession(req);
  if (session) {
    return { userId: session.sub, displayName: session.name, authed: true };
  }

  if (!isUuid(anonId)) throw new NoIdentityError();

  // Read/hot path, or no DSQL configured → treat the (validated) id as an
  // opaque anonymous userId without a DSQL round-trip.
  if (!ensure || !dsqlConfigured()) {
    return { userId: anonId, displayName: "you", authed: false };
  }

  // Write path: lazily create the anon row, and reject ids belonging to a
  // CLAIMED account (AccountClaimedError) — acting as a claimed account
  // requires a session, not a guessable id.
  const account = await ensureAnonymousAccount(anonId);
  return { userId: account.id, displayName: account.displayName, authed: false };
}

export { AccountClaimedError };

/** Map an identity-resolution error to an HTTP response, or null to rethrow. */
export function identityErrorResponse(err: unknown): Response | null {
  if (err instanceof NoIdentityError) {
    return Response.json({ error: "a session or valid anonId is required" }, { status: 400 });
  }
  if (err instanceof AccountClaimedError) {
    return Response.json({ error: "sign in to act as this account" }, { status: 401 });
  }
  return null;
}
