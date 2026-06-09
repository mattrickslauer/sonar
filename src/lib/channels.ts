export type ChannelId =
  | "events"
  | "food"
  | "music"
  | "social"
  | "safety";

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

export const CHANNEL_MAP: Record<ChannelId, Channel> = CHANNELS.reduce(
  (acc, c) => {
    acc[c.id] = c;
    return acc;
  },
  {} as Record<ChannelId, Channel>
);
