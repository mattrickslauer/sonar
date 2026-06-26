// Deterministic, offline "ask the place" synthesis. Ranks the cell's live
// waypoints by love-velocity and formats a grounded answer from them. This is
// the guaranteed fallback for the Ask bar: whenever the model is unavailable
// (no API key, network/route failure, empty completion) we still answer with
// something real drawn from the live signals. Pure + React-free so it can run
// on the server (route fallback) and the client (fetch-failure fallback).
import { channelMeta } from "@/lib/channels";
import { formatAge } from "@/lib/geo";
import { Waypoint } from "@/lib/waypoints";

/** Top waypoints by love-velocity (love per recency), most prominent first. */
export function rankWaypoints(waypoints: Waypoint[], limit: number): Waypoint[] {
  return [...waypoints]
    .sort((a, b) => b.love / (b.minutesAgo + 5) - a.love / (a.minutesAgo + 5))
    .slice(0, limit);
}

export function synthesizeAnswer(waypoints: Waypoint[]): string {
  const recent = rankWaypoints(waypoints, 4);
  if (!recent.length) return "It's quiet here right now — no signals in the last 24h.";

  const lead = recent[0];
  const ch = channelMeta(lead.channel);
  const bullets = recent
    .map((w) => `• ${channelMeta(w.channel).emoji} ${w.text} (${formatAge(w.minutesAgo)})`)
    .join("\n");
  return `Right now the loudest signal is on ${ch.emoji} ${ch.label}: "${lead.text}". Across the last 24h here:\n${bullets}`;
}
