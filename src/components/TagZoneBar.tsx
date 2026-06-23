"use client";

import { useMemo } from "react";
import { TagZone } from "@/lib/waypoints";

interface Props {
  zones: TagZone[];
  /** Tags currently filtering the radar. */
  active: Set<string>;
  onToggle: (tag: string) => void;
}

/**
 * "Trending near you": live tag zones (DynamoDB TTL items) surfaced as tappable
 * chips, brightest = hottest. Tapping a tag filters the radar to drops carrying
 * it. Zones fade on their own as their TTL lapses, so this bar is a live,
 * self-expiring read of what's being tagged around the user right now.
 */
export default function TagZoneBar({ zones, active, onToggle }: Props) {
  const top = useMemo(() => {
    // Collapse across channels for the display (sum counts per tag).
    const byTag = new Map<string, number>();
    for (const z of zones) byTag.set(z.tag, (byTag.get(z.tag) ?? 0) + z.count);
    return [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [zones]);

  if (top.length === 0) return null;

  return (
    <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
        trending
      </span>
      {top.map(([tag, count]) => {
        const on = active.has(tag);
        return (
          <button
            key={tag}
            onClick={() => onToggle(tag)}
            className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] backdrop-blur-md transition-colors"
            style={{
              borderColor: on ? "var(--sonar)" : "rgba(255,255,255,.12)",
              background: on ? "rgba(52,227,160,.15)" : "rgba(0,0,0,.45)",
              color: on ? "#fff" : "rgba(255,255,255,.6)",
            }}
          >
            #{tag} <span className="font-mono opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
