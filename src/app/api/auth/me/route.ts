import { readSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/me — the current signed-in account, or { account: null }.
// Reads the session straight from the cookie (no DB round-trip).
export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) return Response.json({ account: null });
  return Response.json({
    account: { id: session.sub, displayName: session.name },
  });
}
