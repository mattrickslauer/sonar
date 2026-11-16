// Sonar Platform — photo moderation before a post exists. Amazon Rekognition
// reads the uploaded object straight from the media bucket. Off unless
// SONAR_MODERATION=rekognition (needs rekognition:DetectModerationLabels and
// s3:GetObject on tenants/* for the web Lambda's role — see infra/lib/web-stack.ts).
import { DetectModerationLabelsCommand, RekognitionClient } from "@aws-sdk/client-rekognition";
import { mediaBucket } from "@/lib/server/media";

const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const accessKeyId = process.env.SONAR_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.SONAR_AWS_SECRET_ACCESS_KEY;

let client: RekognitionClient | null = null;
const rekognition = () =>
  (client ??= new RekognitionClient({
    region: REGION,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  }));

/** Top-level Rekognition categories that block a public post. */
export const BLOCKED_CATEGORIES = [
  "Explicit",
  "Explicit Nudity",
  "Non-Explicit Nudity of Intimate parts and Kissing",
  "Violence",
  "Visually Disturbing",
  "Hate Symbols",
];

export type ModerationResult =
  | { status: "off" }
  | { status: "passed" }
  | { status: "rejected"; labels: string[] };

export function moderationEnabled(): boolean {
  return process.env.SONAR_MODERATION === "rekognition";
}

/** Labels (name or parent) that hit the blocked list. Pure, for tests. */
export function blockedLabels(labels: { Name?: string; ParentName?: string }[]): string[] {
  const hits = new Set<string>();
  for (const l of labels) {
    for (const n of [l.Name, l.ParentName]) if (n && BLOCKED_CATEGORIES.includes(n)) hits.add(n);
  }
  return [...hits];
}

export async function moderatePhoto(key: string): Promise<ModerationResult> {
  if (!moderationEnabled()) return { status: "off" };
  const res = await rekognition().send(new DetectModerationLabelsCommand({
    Image: { S3Object: { Bucket: mediaBucket(), Name: key } },
    MinConfidence: 80,
  }));
  const hits = blockedLabels(res.ModerationLabels ?? []);
  return hits.length ? { status: "rejected", labels: hits } : { status: "passed" };
}
