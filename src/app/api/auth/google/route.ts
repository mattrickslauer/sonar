import { verifyGoogleIdToken, googleConfigured } from "@/lib/server/google";
import { claimOrSignIn } from "@/lib/server/accounts";
import {
  createSessionToken,
  sessionCookie,
  sessionConfigured,
} from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/google  { credential, anonId? }
// `credential` is the Google ID token from Google Identity Services one-tap.
export async function POST(request: Request) {
  if (!dsqlConfigured() || !sessionConfigured() || !googleConfigured()) {
    return Response.json({ error: "google sign-in not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const credential = typeof body?.credential === "string" ? body.credential : "";
  const anonId = typeof body?.anonId === "string" ? body.anonId : undefined;
  if (!credential) {
    return Response.json({ error: "missing credential" }, { status: 400 });
  }

  const identity = await verifyGoogleIdToken(credential);
  if (!identity) {
    return Response.json({ error: "invalid google token" }, { status: 401 });
  }

  const { account, claimed } = await claimOrSignIn(anonId ?? "", {
    email: identity.email,
    googleSub: identity.sub,
    displayName: identity.name,
    avatarUrl: identity.picture,
    authMethod: "google",
  });
  const token = await createSessionToken(account);
  return Response.json(
    { account: { id: account.id, displayName: account.displayName }, claimed },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token) } },
  );
}
