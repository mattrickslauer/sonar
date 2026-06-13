// Server-only: verify a Google ID token from Google Identity Services one-tap.
//
// SECURITY: the browser sends a Google-issued ID token (JWT). We verify its
// signature against Google's published JWKS and check issuer + audience +
// expiry with `jose`. A token is only trusted if `aud` equals OUR client id —
// so a token minted for another site can't be replayed here. We also require
// email_verified. No Google secret is needed for ID-token verification.
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

// Server-side audience check. Falls back to the public (build-time) id so a
// single env var works for both client and server.
const CLIENT_ID =
  process.env.SONAR_GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function googleConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Verify a Google ID token; returns the identity or null if invalid/untrusted. */
export async function verifyGoogleIdToken(
  credential: string,
): Promise<GoogleIdentity | null> {
  if (!CLIENT_ID) return null;
  try {
    const { payload } = await jwtVerify(credential, JWKS, {
      issuer: ISSUERS,
      audience: CLIENT_ID,
    });
    const p = payload as JWTPayload & {
      email?: unknown;
      email_verified?: unknown;
      name?: unknown;
      picture?: unknown;
    };
    if (typeof p.sub !== "string" || typeof p.email !== "string") return null;
    const emailVerified = p.email_verified === true || p.email_verified === "true";
    if (!emailVerified) return null; // never trust an unverified Google email
    return {
      sub: p.sub,
      email: p.email,
      emailVerified,
      name: typeof p.name === "string" ? p.name : undefined,
      picture: typeof p.picture === "string" ? p.picture : undefined,
    };
  } catch {
    return null;
  }
}
