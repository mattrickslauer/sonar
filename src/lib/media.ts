// Shared media-upload rules — imported by both the browser (DropComposer) and
// the server route handlers, so the SAME limits are enforced client-side (fast
// feedback) and server-side (the presigned-POST policy is the real gate).
//
// IMPORTANT: keep this file free of Node-only imports — it runs in the browser.
import { MediaKind } from "./waypoints";

/** The non-text kinds that carry an uploaded blob. */
export type UploadKind = Exclude<MediaKind, "text">;

export interface MediaLimit {
  /** Accepted MIME types (the whitelist; anything else is rejected). */
  mimes: string[];
  /** Hard byte cap, enforced both client-side and in the S3 POST policy. */
  maxBytes: number;
  /** Human label for the cap, shown in the UI. */
  label: string;
}

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<UploadKind, MediaLimit> = {
  photo: {
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxBytes: 10 * MB,
    label: "10 MB",
  },
  video: {
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytes: 50 * MB,
    label: "50 MB",
  },
  voice: {
    mimes: ["audio/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"],
    maxBytes: 10 * MB,
    label: "10 MB",
  },
};

/** MIME → file extension, used to name the S3 object. */
const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "weba",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

export function extForMime(mime: string): string {
  return EXT_FOR_MIME[mime] ?? "bin";
}

export function isUploadKind(kind: string): kind is UploadKind {
  return kind === "photo" || kind === "video" || kind === "voice";
}

/** Which kind does this MIME belong to? null if not in any whitelist. */
export function mediaKindForMime(mime: string): UploadKind | null {
  for (const k of Object.keys(MEDIA_LIMITS) as UploadKind[]) {
    if (MEDIA_LIMITS[k].mimes.includes(mime)) return k;
  }
  return null;
}

/** The `accept` attribute for a file input, per kind. */
export function acceptFor(kind: UploadKind): string {
  return MEDIA_LIMITS[kind].mimes.join(",");
}

export type MediaCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate a (kind, mime, size) tuple against the whitelist + cap. Shared by the
 * browser (before upload) and the upload route (before signing). `size` may be
 * omitted server-side when only type is being checked.
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
  if (!limit.mimes.includes(mime)) {
    return { ok: false, error: `unsupported ${kind} type: ${mime || "unknown"}` };
  }
  if (mediaKindForMime(mime) !== kind) {
    return { ok: false, error: `${mime} is not a ${kind} file` };
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
