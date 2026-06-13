import { verifyOtp } from "@/lib/server/otp";
import { claimOrSignIn } from "@/lib/server/accounts";
import {
  createSessionToken,
  sessionCookie,
  sessionConfigured,
} from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

// POST /api/auth/verify  { email, code, anonId? }
// Verifies the code, then claims the caller's anonymous account (or signs into
// the existing one), and installs the session cookie.
export async function POST(request: Request) {
  if (!dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "auth not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const anonId = typeof body?.anonId === "string" ? body.anonId : undefined;

  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "valid email required" }, { status: 400 });
  }
  if (!CODE_RE.test(code)) {
    return Response.json({ error: "6-digit code required" }, { status: 400 });
  }

  const verdict = await verifyOtp(email, code);
  if (!verdict.ok) {
    // Generic message — don't distinguish wrong code from expired/burned.
    return Response.json({ error: "invalid or expired code" }, { status: 401 });
  }

  const { account, claimed } = await claimOrSignIn(anonId ?? "", {
    email,
    authMethod: "email_otp",
  });
  const token = await createSessionToken(account);
  return Response.json(
    { account: { id: account.id, displayName: account.displayName }, claimed },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token) } },
  );
}
