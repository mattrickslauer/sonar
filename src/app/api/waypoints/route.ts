import { normalizeChannelSlug, CORE_CHANNEL_IDS } from "@/lib/channels";
import { isUploadKind } from "@/lib/media";
import { normalizeTags } from "@/lib/tags";
import { isValidMediaKey } from "@/lib/server/media";
import { queryNearby, queryTagZones, putWaypoint } from "@/lib/server/waypoints";
import { getChannelsCached, channelExists } from "@/lib/server/channels";
import { isMember } from "@/lib/server/membership";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

// Hits DynamoDB on every request — never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve which of the requested channels the caller may read. Public channels
 * are always allowed; unknown ids are dropped (never error a read); private
 * channels are included only when the caller is a member (DSQL-backed). Returns
 * undefined to mean "use the default public set" (no channels filter supplied).
 */
async function accessibleChannels(
  requested: string[] | undefined,
  accountId: string | null,
): Promise<string[] | undefined> {
  if (!requested) return undefined; // queryNearby defaults to the public core set
  const known = await getChannelsCached();
  const out: string[] = [];
  for (const raw of requested) {
    const id = normalizeChannelSlug(raw);
    if (!id) continue;
    const row = known.get(id);
    const isCore = CORE_CHANNEL_IDS.includes(id);
    if (!row && !isCore) continue; // unknown channel → silently drop
    if (row?.isPrivate) {
      // Private: include only if the caller is a member (defense-in-depth; the
      // client should only request private channels it belongs to).
      if (accountId && (await isMember(id, accountId))) out.push(id);
    } else {
      out.push(id);
    }
  }
  return out;
}

/** Best-effort identity for a read: session cookie, else an optional anonId
 *  query param. Never throws — returns null when neither is present. */
async function readIdentity(request: Request, anonId: string | null): Promise<string | null> {
  try {
    const id = await resolveIdentity(request, anonId ?? undefined, { ensure: false });
    return id.userId;
  } catch {
    return null;
  }
}

// GET /api/waypoints?lat=&lng=&channels=food,music[&tags=1][&anonId=]
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: "lat and lng are required" }, { status: 400 });
  }
  const channelsParam = searchParams.get("channels");
  const requested = channelsParam ? channelsParam.split(",") : undefined;
  const wantTags = searchParams.get("tags") === "1";
  // Optional fetch radius (metres) — the travel-mode range. Omitted = unbounded
  // (full cell-and-neighbours footprint).
  const radius = Number(searchParams.get("radius"));
  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : undefined;

  try {
    const accountId = await readIdentity(request, searchParams.get("anonId"));
    const channels = await accessibleChannels(requested, accountId);
    // A supplied-but-fully-inaccessible channel set → empty result, NOT the
    // default public set (only `undefined` means "use the default").
    const [waypoints, tagZones] = await Promise.all([
      queryNearby({ lat, lng }, channels, radiusMeters),
      wantTags ? queryTagZones({ lat, lng }, channels, radiusMeters) : Promise.resolve([]),
    ]);
    return Response.json(wantTags ? { waypoints, tagZones } : { waypoints });
  } catch (err) {
    // Surface the real cause in the host's function logs (e.g. AccessDenied /
    // ResourceNotFound when AWS creds or region are misconfigured in prod).
    console.error("queryNearby failed", err);
    const name = err instanceof Error ? err.name : "Error";
    return Response.json({ error: "waypoint query failed", name }, { status: 500 });
  }
}

// POST /api/waypoints  { channel, kind, text, lat, lng, author?, mediaKey?, tags? }
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

  // The channel must be a registered slug (open set, validated against the DSQL
  // registry). Normalize first so "Tacos & Trucks!" → "tacostrucks".
  const channel = normalizeChannelSlug(String(body.channel));
  if (!channel || !(await channelExists(channel))) {
    return Response.json({ error: "unknown channel" }, { status: 400 });
  }

  // Identity is authoritative: a signed-in user's drop is attributed to their
  // account; an anonymous drop lazily creates/uses the device's account. We do
  // NOT trust a client-supplied author — it's derived from the resolved identity.
  let identity;
  try {
    identity = await resolveIdentity(request, body?.anonId, {
      referredBy: typeof body?.ref === "string" ? body.ref : undefined,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  // Private channels are post-gated on membership (DSQL authoritative).
  const known = await getChannelsCached();
  if (known.get(channel)?.isPrivate) {
    if (!(await isMember(channel, identity.userId))) {
      return Response.json({ error: "not a member of this channel" }, { status: 403 });
    }
  }

  // This route only creates ephemeral drops. Permanent (paid) waypoints are
  // created via POST /api/billing/permanent, which handles Stripe Checkout /
  // quantity and writes the sponsored item itself.
  const lifespanSeconds = Number(body?.lifespanSeconds);
  const tags = normalizeTags(body?.tags);
  const waypoint = await putWaypoint({
    channel,
    kind,
    text,
    lat,
    lng,
    ownerId: identity.userId,
    author: identity.displayName,
    lifespanSeconds: Number.isFinite(lifespanSeconds) ? lifespanSeconds : undefined,
    mediaKey: typeof mediaKey === "string" ? mediaKey : undefined,
    tags,
  });
  return Response.json({ waypoint }, { status: 201 });
}
