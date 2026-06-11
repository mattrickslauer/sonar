// Server-only: presigned S3 access for media uploads/reads.
//
// Uploads use a presigned POST (not a presigned PUT): the POST policy lets us
// pin BOTH the content-type and a content-length-range, so S3 itself rejects
// oversized or wrong-type blobs — the browser never gets to push past the cap.
// Reads use a short-lived presigned GET behind /api/media/view (the bucket
// blocks all public access).
//
// Credentials follow the same SONAR_-prefixed convention as the DynamoDB client
// (see src/lib/server/waypoints.ts): explicit creds in hosted envs, default
// chain locally. The bucket name is passed via SONAR_MEDIA_BUCKET.
import { randomBytes } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost, PresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ChannelId } from "@/lib/channels";
import { UploadKind, MEDIA_LIMITS, extForMime } from "@/lib/media";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const BUCKET = process.env.SONAR_MEDIA_BUCKET ?? "";

const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;

const s3 = new S3Client({
  region: REGION,
  ...(accessKeyId && secretAccessKey
    ? { credentials: { accessKeyId, secretAccessKey } }
    : {}),
});

/** Media is optional infra — the route handlers 503 when the bucket is unset. */
export function mediaConfigured(): boolean {
  return BUCKET.length > 0;
}

// Object keys are `media/<channel>/<random>.<ext>`. The channel segment is a
// lowercase id; the random segment is 16 hex bytes. Validate on read so the
// view route can't be coerced into signing arbitrary keys.
const UPLOAD_KEY_RE = /^media\/[a-z]+\/[0-9a-f]{32}\.[a-z0-9]+$/;
// Persistent bot seed media (not lifecycle-expired): seed/<kind>/<slug>.<ext>.
const SEED_KEY_RE = /^seed\/(photo|video|voice)\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

export function isValidMediaKey(key: string): boolean {
  return UPLOAD_KEY_RE.test(key) || SEED_KEY_RE.test(key);
}

const UPLOAD_EXPIRY_SECONDS = 5 * 60; // browser must finish the POST within 5m
const VIEW_EXPIRY_SECONDS = 10 * 60; // presigned GET lifetime

export interface UploadTicket extends PresignedPost {
  /** The object key the caller persists as the waypoint's mediaKey. */
  key: string;
}

/**
 * Mint a presigned POST for a new upload. The returned `fields` must be sent as
 * multipart/form-data form fields ahead of the file. The policy caps size to the
 * kind's limit and pins the content-type, so S3 rejects anything out of bounds.
 */
export async function createUpload(
  kind: UploadKind,
  channel: ChannelId,
  contentType: string,
): Promise<UploadTicket> {
  const limit = MEDIA_LIMITS[kind];
  const key = `media/${channel}/${randomBytes(16).toString("hex")}.${extForMime(contentType)}`;
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: key,
    Conditions: [
      ["content-length-range", 1, limit.maxBytes],
      ["eq", "$Content-Type", contentType],
    ],
    Fields: { "Content-Type": contentType },
    Expires: UPLOAD_EXPIRY_SECONDS,
  });
  return { key, url, fields };
}

/** A short-lived presigned GET URL for reading a media object. */
export async function viewUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: VIEW_EXPIRY_SECONDS },
  );
}
