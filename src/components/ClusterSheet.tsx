"use client";

import { CHANNEL_MAP } from "@/lib/channels";
import { formatAge, formatDistance } from "@/lib/geo";
import { MEDIA_ICON, Waypoint } from "@/lib/waypoints";

interface Props {
  waypoints: Waypoint[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

// Shown when a cluster of overlapping pins is tapped: a scroll-through list of
// every waypoint hidden under that combined circle. Picking a row opens the
// normal waypoint sheet for it.
export default function ClusterSheet({ waypoints, onSelect, onClose }: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 px-3 pb-3">
      <div className="animate-sheet rounded-3xl border border-white/12 bg-[#0a0e12]/95 p-4 backdrop-blur-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />

        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
            {waypoints.length} drops here
          </span>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        <div className="-mx-1 max-h-[50vh] overflow-y-auto px-1">
          <ul className="flex flex-col gap-1.5">
            {waypoints.map((wp) => {
              const ch = CHANNEL_MAP[wp.channel];
              return (
                <li key={wp.id}>
                  <button
                    onClick={() => onSelect(wp.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-[#04110c]"
                      style={{ background: ch.color, boxShadow: `0 0 12px ${ch.color}55` }}
                    >
                      {MEDIA_ICON[wp.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span style={{ color: ch.color }}>
                          {ch.emoji} {ch.label}
                        </span>
                        {wp.sponsored && (
                          <span className="text-[11px] text-[#ffd35c]">◆</span>
                        )}
                      </div>
                      <p className="truncate text-[13px] text-white/85">
                        {wp.text || `@${wp.author}`}
                      </p>
                      <p className="font-mono text-[10px] text-white/40">
                        @{wp.author} · {formatAge(wp.minutesAgo)} ·{" "}
                        {formatDistance(wp.meters)} away
                      </p>
                    </div>
                    <span className="shrink-0 text-white/25">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
