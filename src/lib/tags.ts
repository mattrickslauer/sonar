// Tags are short, ephemeral, location-scoped labels carried on a drop. Each tag
// also drives a first-class "tag zone" in DynamoDB (see bumpTagZones in
// src/lib/server/waypoints.ts): a TAGZONE#<channel>#GEO#<gh6> item whose TTL is
// refreshed every time the tag is reused nearby, so a zone glows on the radar
// while tagging is happening and fades on its own when it stops. This module
// holds the shared normalization + caps used by both client and server.

/** Max tags carried per drop. */
export const MAX_TAGS = 5;
/** Max characters per normalized tag. */
export const MAX_TAG_LEN = 24;

/**
 * Normalize a list of raw tag inputs into clean, deduped tags:
 * lowercase, strip a leading '#', keep only [a-z0-9], cap each at MAX_TAG_LEN,
 * drop empties, dedupe (insertion order), and cap the list at MAX_TAGS. Same
 * alphanumeric discipline as channel slugs so the TAG#<tag> sort key stays
 * clean. Emoji-only / punctuation-only inputs normalize to "" and are dropped.
 */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, MAX_TAG_LEN);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}
