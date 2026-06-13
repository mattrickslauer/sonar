import { lovedAmong } from "@/lib/server/waypoints";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

// Reads DynamoDB per request — never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/loves  { ids: string[], anonId? }  →  { loved: string[] }
// Which of `ids` has the caller already loved? Seeds loved-state on load. Pure
// read → ensure:false (no account creation).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : null;
  if (!ids) {
    return Response.json({ error: "ids[] is required" }, { status: 400 });
  }
  try {
    const identity = await resolveIdentity(
      request,
      typeof body?.anonId === "string" ? body.anonId : undefined,
      { ensure: false },
    );
    const loved = await lovedAmong(ids, identity.userId);
    return Response.json({ loved });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
