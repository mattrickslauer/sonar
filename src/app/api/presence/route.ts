import { recordPresence } from "@/lib/server/waypoints";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

// Mutates DynamoDB — never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/presence  { lat, lng, anonId? }
// Heartbeat is hot + non-sensitive, so it does NOT lazily create an account
// (ensure:false) — it just keys presence by the session or validated anon id.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat, lng are required" }, { status: 400 });
  }
  try {
    const identity = await resolveIdentity(
      request,
      typeof body?.anonId === "string" ? body.anonId : undefined,
      { ensure: false },
    );
    await recordPresence(lat, lng, identity.userId);
    return Response.json({ ok: true });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
