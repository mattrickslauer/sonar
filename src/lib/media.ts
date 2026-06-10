// Shared media-upload rules — imported by both the browser (DropComposer) and
// the server route handlers, so the SAME limits are enforced client-side (fast
// feedback) and server-side (the presigned-POST policy is the real gate).
//
// We default to the SYSTEM media types: each kind accepts whatever the device's
// native picker/capture produces for that family (any image/*, video/*, or
// audio/*), rather than a narrow whitelist. The only hard gate is the per-kind
// byte cap (enforced again in the S3 POST policy) and that the family matches.
//
// IMPORTANT: keep this file free of Node-only imports — it runs in the browser.
import { MediaKind } from "./waypoints";

/** The non-text kinds that carry an uploaded blob. */
export type UploadKind = Exclude<MediaKind, "text">;

export interface MediaLimit {
  /** MIME family prefix this kind accepts, e.g. "image/". */
  prefix: string;
  /** The `accept` attribute for the file input — the system-default wildcard. */
  accept: string;
  /** Hard byte cap, enforced both client-side and in the S3 POST policy. */
  maxBytes: number;
  /** Human label for the cap, shown in the UI. */
  label: string;
}

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<UploadKind, MediaLimit> = {
  photo: { prefix: "image/", accept: "image/*", maxBytes: 10 * MB, label: "10 MB" },
  video: { prefix: "video/", accept: "video/*", maxBytes: 50 * MB, label: "50 MB" },
  voice: { prefix: "audio/", accept: "audio/*", maxBytes: 10 * MB, label: "10 MB" },
};

// Friendly extensions for the common system types; anything else falls back to
// the MIME subtype (sanitized) so the S3 key still gets a sensible suffix.
const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "weba",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

export function extForMime(mime: string): string {
  if (EXT_FOR_MIME[mime]) return EXT_FOR_MIME[mime];
  // e.g. "image/heif" → "heif", "audio/x-caf" → "xcaf". Matches the key regex.
  const sub = (mime.split("/")[1] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return sub || "bin";
}

export function isUploadKind(kind: string): kind is UploadKind {
  return kind === "photo" || kind === "video" || kind === "voice";
}

/** Which kind does this MIME family belong to? null if none. */
export function mediaKindForMime(mime: string): UploadKind | null {
  for (const k of Object.keys(MEDIA_LIMITS) as UploadKind[]) {
    if (mime.startsWith(MEDIA_LIMITS[k].prefix)) return k;
  }
  return null;
}

/** The `accept` attribute for a file input, per kind (system-default wildcard). */
export function acceptFor(kind: UploadKind): string {
  return MEDIA_LIMITS[kind].accept;
}

export type MediaCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a (kind, mime, size) tuple: the MIME must be in the kind's family and
 * the size within the cap. Shared by the browser (before upload) and the upload
 * route (before signing). `size` may be omitted when only type is being checked.
 */
export function validateMedia(
  kind: string,
  mime: string,
  size?: number,
): MediaCheck {
  if (!isUploadKind(kind)) {
    return { ok: false, error: "kind must be photo, video, or voice" };
  }
  const limit = MEDIA_LIMITS[kind];
  if (!mime || !mime.startsWith(limit.prefix)) {
    return { ok: false, error: `unsupported ${kind} type: ${mime || "unknown"}` };
  }
  if (size != null) {
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, error: "empty file" };
    }
    if (size > limit.maxBytes) {
      return { ok: false, error: `${kind} too large (max ${limit.label})` };
    }
  }
  return { ok: true };
}
