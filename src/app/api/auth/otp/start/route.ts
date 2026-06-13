import { startOtp } from "@/lib/server/otp";
import { sendOtpEmail } from "@/lib/server/ses";
import { dsqlConfigured } from "@/lib/server/dsql";
import { sessionConfigured } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Basic shape check — full validity is proven by the user receiving the code.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/otp/start  { email }
// Generates a one-time code and emails it. Always responds the same way for any
// well-formed email (no account enumeration); throttling returns 429.
export async function POST(request: Request) {
  if (!dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "auth not configured" }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return Response.json({ error: "valid email required" }, { status: 400 });
  }

  const result = await startOtp(email);
  if (!result.ok) {
    return Response.json(
      { error: "please wait before requesting another code" },
      { status: 429 },
    );
  }

  try {
    await sendOtpEmail(email, result.code);
  } catch (err) {
    console.error("sendOtpEmail failed", err);
    return Response.json({ error: "could not send code" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
