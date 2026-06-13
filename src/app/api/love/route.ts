import { ChannelId } from "@/lib/channels";
import { loveWaypoint, unloveWaypoint, LoveInput } from "@/lib/server/waypoints";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

// Mutates DynamoDB — never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Validate the waypoint coordinates; the loving `user` comes from the resolved
// identity, never from a client-supplied field.
function parseTarget(
  body: Record<string, unknown> | null,
  user: string,
): LoveInput | Response {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!body?.id || !body?.channel || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "id, channel, lat, lng are required" },
      { status: 400 },
    );
  }
  return {
    id: String(body.id),
    channel: body.channel as ChannelId,
    lat,
    lng,
    user,
  };
}

async function resolve(request: Request, body: Record<string, unknown> | null) {
  // Loving is a meaningful write → lazily create/claim the anon account. If the
  // caller arrived via a shared link, attribute the referral on that first row.
  return resolveIdentity(
    request,
    typeof body?.anonId === "string" ? body.anonId : undefined,
    { referredBy: typeof body?.ref === "string" ? body.ref : undefined },
  );
}

// POST /api/love  { id, channel, lat, lng, anonId? }  — add a love
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const identity = await resolve(request, body);
    const parsed = parseTarget(body, identity.userId);
    if (parsed instanceof Response) return parsed;
    return Response.json(await loveWaypoint(parsed));
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

// DELETE /api/love  { id, channel, lat, lng, anonId? }  — undo a love
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const identity = await resolve(request, body);
    const parsed = parseTarget(body, identity.userId);
    if (parsed instanceof Response) return parsed;
    return Response.json(await unloveWaypoint(parsed));
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
