// Server-only: stateless session as a signed JWT in an httpOnly cookie. No
// session table — the token IS the session, so DynamoDB stays purely ephemeral
// and DSQL stays focused on durable account data.
//
// SECURITY:
//   - HS256 signed with SONAR_SESSION_SECRET (must be ≥ 32 bytes of entropy).
//     Verified with the `jose` library (audited) — we never hand-roll crypto.
//   - Cookie is httpOnly (no JS access → XSS can't exfiltrate it), Secure in
//     production (HTTPS-only), SameSite=Lax (the browser omits it on cross-site
//     POSTs, which makes our state-changing API routes CSRF-safe by default).
//   - The token carries only the account id + display name (no secrets/PII
//     beyond the name already shown publicly).
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "sonar_session";
const ISSUER = "sonar";
const AUDIENCE = "sonar-web";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

const secretValue = process.env.SONAR_SESSION_SECRET;
let secretKey: Uint8Array | undefined;
function key(): Uint8Array {
  if (!secretValue || secretValue.length < 32) {
    throw new Error(
      "SONAR_SESSION_SECRET must be set to a random string of at least 32 chars.",
    );
  }
  if (!secretKey) secretKey = new TextEncoder().encode(secretValue);
  return secretKey;
}

/** True when sessions are configured (secret present). */
export function sessionConfigured(): boolean {
  return Boolean(secretValue && secretValue.length >= 32);
}

export interface SessionClaims {
  /** accounts.id — the canonical userId. */
  sub: string;
  name: string;
}

/** Mint a signed session token for an account. */
export async function createSessionToken(account: {
  id: string;
  displayName: string;
}): Promise<string> {
  return new SignJWT({ name: account.displayName })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(account.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

/** Verify a session token; returns its claims or null if invalid/expired. */
export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const p = payload as JWTPayload & { name?: unknown };
    if (typeof p.sub !== "string" || typeof p.name !== "string") return null;
    return { sub: p.sub, name: p.name };
  } catch {
    return null;
  }
}

/** Read + verify the session from a request's Cookie header. */
export async function readSession(req: Request): Promise<SessionClaims | null> {
  const token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token);
}

/** Set-Cookie value that installs the session. */
export function sessionCookie(token: string): string {
  return cookie(SESSION_COOKIE, token, MAX_AGE_SECONDS);
}

/** Set-Cookie value that clears the session (logout). */
export function clearSessionCookie(): string {
  return cookie(SESSION_COOKIE, "", 0);
}

function cookie(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  // Secure everywhere except local dev (no HTTPS on localhost).
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}
