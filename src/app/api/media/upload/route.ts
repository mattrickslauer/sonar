import { ChannelId, isValidChannelId } from "@/lib/channels";
import { isUploadKind, validateMedia } from "@/lib/media";
import { maxBytesForLifespan } from "@/lib/waypoints";
import { createUpload, mediaConfigured } from "@/lib/server/media";

// Mints a presigned S3 POST — never cached.
export const dynamic = "force-dynamic";

// POST /api/media/upload  { channel, kind, contentType, size }
// → { key, url, fields }  (post `fields` + the file as multipart/form-data to `url`)
export async function POST(request: Request) {
  if (!mediaConfigured()) {
    return Response.json(
      { error: "media uploads are not configured" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const channel = body?.channel as ChannelId | undefined;
  const kind = body?.kind;
  const contentType = body?.contentType;
  const size = Number(body?.size);
  const lifespanSeconds = Number(body?.lifespanSeconds);

  // Accept any valid channel slug — open/custom channels (and locked channels
  // being set up before payment) aren't in the static core map. The drop route
  // is the authoritative gate on channel existence + membership; the key here
  // only needs a clean slug for its S3 path.
  if (!channel || !isValidChannelId(channel)) {
    return Response.json({ error: "unknown channel" }, { status: 400 });
  }
  if (typeof kind !== "string" || !isUploadKind(kind)) {
    return Response.json(
      { error: "kind must be photo, video, or voice" },
      { status: 400 },
    );
  }
  if (typeof contentType !== "string") {
    return Response.json({ error: "contentType is required" }, { status: 400 });
  }

  // Same whitelist + cap the browser used — this is the authoritative check.
  // The byte cap is governed by the chosen lifespan (the byte-hour budget):
  // longer-lived drops may carry fewer bytes.
  const cap = Number.isFinite(lifespanSeconds)
    ? maxBytesForLifespan(lifespanSeconds)
    : undefined;
  const check = validateMedia(kind, contentType, size, cap);
  if (!check.ok) {
    // 415 for a bad type, 413 for an oversize payload, 400 otherwise.
    const status = /unsupported|not a/.test(check.error)
      ? 415
      : /too large/.test(check.error)
        ? 413
        : 400;
    return Response.json({ error: check.error }, { status });
  }

  try {
    const ticket = await createUpload(kind, channel, contentType, cap);
    return Response.json(ticket, { status: 200 });
  } catch (err) {
    console.error("createUpload failed", err);
    const name = err instanceof Error ? err.name : "Error";
    return Response.json({ error: "could not sign upload", name }, { status: 500 });
  }
}
