import { ChannelId } from "@/lib/channels";
import { loveWaypoint, unloveWaypoint, LoveInput } from "@/lib/server/waypoints";

// Mutates DynamoDB — never cached.
export const dynamic = "force-dynamic";

// Shared validation for love/unlove. Returns the input or an error Response.
function parseLove(body: Record<string, unknown> | null): LoveInput | Response {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!body?.id || !body?.channel || !body?.user || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "id, channel, lat, lng, user are required" },
      { status: 400 },
    );
  }
  return {
    id: String(body.id),
    channel: body.channel as ChannelId,
    lat,
    lng,
    user: String(body.user),
  };
}

// POST /api/love  { id, channel, lat, lng, user }  — add a love
export async function POST(request: Request) {
  const parsed = parseLove(await request.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  return Response.json(await loveWaypoint(parsed));
}

// DELETE /api/love  { id, channel, lat, lng, user }  — undo a love
export async function DELETE(request: Request) {
  const parsed = parseLove(await request.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  return Response.json(await unloveWaypoint(parsed));
}
