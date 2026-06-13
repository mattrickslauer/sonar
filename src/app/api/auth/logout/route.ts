import { clearSessionCookie } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/logout — clears the session cookie.
export async function POST() {
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": clearSessionCookie() } },
  );
}
