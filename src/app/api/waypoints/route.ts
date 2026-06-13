import { ChannelId } from "@/lib/channels";
import { isUploadKind } from "@/lib/media";
import { isValidMediaKey } from "@/lib/server/media";
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
  // Optional fetch radius (metres) — the travel-mode range. Omitted = unbounded
  // (full cell-and-neighbours footprint).
  const radius = Number(searchParams.get("radius"));
  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : undefined;

  try {
    const waypoints = await queryNearby({ lat, lng }, channels, radiusMeters);
    return Response.json({ waypoints });
  } catch (err) {
    // Surface the real cause in the host's function logs (e.g. AccessDenied /
    // ResourceNotFound when AWS creds or region are misconfigured in prod).
    console.error("queryNearby failed", err);
    const name = err instanceof Error ? err.name : "Error";
    return Response.json({ error: "waypoint query failed", name }, { status: 500 });
  }
}

// POST /api/waypoints  { channel, kind, text, lat, lng, author?, mediaKey? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const kind = typeof body?.kind === "string" ? body.kind : "text";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const mediaKey = body?.mediaKey;

  if (!body?.channel || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json(
      { error: "channel, lat, lng are required" },
      { status: 400 },
    );
  }
  // A drop needs *something* to show: a caption, an uploaded blob, or both.
  if (!text && !mediaKey) {
    return Response.json(
      { error: "text or mediaKey is required" },
      { status: 400 },
    );
  }
  if (mediaKey !== undefined) {
    if (typeof mediaKey !== "string" || !isValidMediaKey(mediaKey)) {
      return Response.json({ error: "invalid mediaKey" }, { status: 400 });
    }
  } else if (isUploadKind(kind)) {
    // photo/video/voice kinds must carry the blob they claim.
    return Response.json(
      { error: `${kind} drops require an uploaded file` },
      { status: 400 },
    );
  }

  const lifespanSeconds = Number(body?.lifespanSeconds);
  const waypoint = await putWaypoint({
    channel: body.channel,
    kind,
    text,
    lat,
    lng,
    author: body.author,
    lifespanSeconds: Number.isFinite(lifespanSeconds) ? lifespanSeconds : undefined,
    mediaKey: typeof mediaKey === "string" ? mediaKey : undefined,
  });
  return Response.json({ waypoint }, { status: 201 });
}
