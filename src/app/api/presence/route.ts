import { recordPresence } from "@/lib/server/waypoints";

// Mutates DynamoDB — never cached.
export const dynamic = "force-dynamic";

// POST /api/presence  { lat, lng, user }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!body?.user || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat, lng, user are required" }, { status: 400 });
  }
  await recordPresence(lat, lng, body.user);
  return Response.json({ ok: true });
}
