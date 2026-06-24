// Channels are an OPEN set: a channel id is any normalized slug, and the
// system-of-record is the DSQL `channels` table (see src/lib/server/channels.ts),
// not this file. `ChannelId` is therefore a plain string. The CHANNELS array
// below is retained for two narrow jobs: (1) the migration seed manifest
// (infra/sql/006_seed_channels.sql mirrors it), and (2) an offline FALLBACK so
// the five core channels still render/validate when DSQL is unreachable. UI code
// must tolerate ids that aren't in here (user-created channels) — use
// channelMeta() rather than indexing CHANNEL_MAP directly.

/** A channel id: a normalized slug (lowercase [a-z0-9], <=16 chars) or, for a
 *  locked private channel, a random 16-char token. Validated against the DSQL
 *  registry at creation; any string is structurally a ChannelId. */
export type ChannelId = string;

export interface Channel {
  id: ChannelId;
  label: string;
  emoji: string;
  color: string; // hex, used for markers + glow
  private?: boolean;
}

export const CHANNELS: Channel[] = [
  { id: "events", label: "Events", emoji: "🎪", color: "#f5a524" },
  { id: "food", label: "Food", emoji: "🍔", color: "#fb7185" },
  { id: "music", label: "Music", emoji: "🎶", color: "#a855f7" },
  { id: "social", label: "Social", emoji: "💬", color: "#22d3ee" },
  { id: "safety", label: "Safety", emoji: "🛟", color: "#ef4444", private: true },
];

export const CHANNEL_MAP: Record<string, Channel> = CHANNELS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<string, Channel>
);

/** The seeded, always-public core channel ids. Used as the offline-fallback set
 *  and to recognize system channels without a DSQL round-trip. */
export const CORE_CHANNEL_IDS: ChannelId[] = CHANNELS.map((c) => c.id);

/** Default presentation for a channel the client has no metadata for yet
 *  (freshly created, or not in the fetched list). Keeps the radar from crashing
 *  on an unknown id. */
export const FALLBACK_CHANNEL: Omit<Channel, "id"> = {
  label: "Channel",
  emoji: "📍",
  color: "#22d3ee",
};

/**
 * Normalize any user-entered channel name into the canonical id: lowercase,
 * strip everything but [a-z0-9] (so no spaces/punctuation/emoji), cap at 16
 * chars. This normalized string is the unique key in the `channels` table, so
 * "Tacos & Trucks!" and "tacos trucks" both collapse to "tacostrucks" and
 * reconcile to one channel. Returns "" when nothing usable survives — callers
 * reject that with a 400.
 */
export function normalizeChannelSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
}

/** Whether a string is a structurally valid channel id (1–16 [a-z0-9]). Used by
 *  the WS layer to reject garbage without a DSQL lookup. */
export function isValidChannelId(id: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(id);
}

/**
 * Presentation metadata for a channel id, given an optional map of known
 * channels (e.g. the list fetched from /api/channels). Falls back to the static
 * core map, then to a generic placeholder — never throws on an unknown id.
 */
export function channelMeta(
  id: ChannelId,
  known?: Map<string, Channel> | Record<string, Channel>,
): Channel {
  const fromKnown =
    known instanceof Map ? known.get(id) : known?.[id];
  return fromKnown ?? CHANNEL_MAP[id] ?? { id, ...FALLBACK_CHANNEL };
}
