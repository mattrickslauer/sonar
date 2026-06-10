import { ChannelId } from "@/lib/channels";
import { queryNearby, putWaypoint } from "@/lib/server/waypoints";

// Hits DynamoDB on every request — never cached.
export const dynamic = "force-dynamic";

// GET /api/waypoints?lat=&lng=&channels=food,music
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat and lng are required" }, { status: 400 });
  }
  const channelsParam = searchParams.get("channels");
  const channels = channelsParam
    ? (channelsParam.split(",") as ChannelId[])
    : undefined;

  const waypoints = await queryNearby({ lat, lng }, channels);
  return Response.json({ waypoints });
}

// POST /api/waypoints  { channel, kind, text, lat, lng, author? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!body?.channel || !body?.text || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "channel, text, lat, lng are required" },
      { status: 400 },
    );
  }
  const waypoint = await putWaypoint({
    channel: body.channel,
    kind: body.kind ?? "text",
    text: body.text,
    lat,
    lng,
    author: body.author,
  });
  return Response.json({ waypoint }, { status: 201 });
}
