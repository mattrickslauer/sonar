import { CHANNEL_MAP, ChannelId } from "@/lib/channels";
import { isUploadKind, validateMedia } from "@/lib/media";
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

  if (!channel || !CHANNEL_MAP[channel]) {
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
  const check = validateMedia(kind, contentType, size);
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
    const ticket = await createUpload(kind, channel, contentType);
    return Response.json(ticket, { status: 200 });
  } catch (err) {
    console.error("createUpload failed", err);
    const name = err instanceof Error ? err.name : "Error";
    return Response.json({ error: "could not sign upload", name }, { status: 500 });
  }
}
