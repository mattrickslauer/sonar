"use client";

import { CHANNELS, ChannelId } from "@/lib/channels";

interface Props {
  active: Set<ChannelId>;
  counts: Record<ChannelId, number>;
  onToggle: (id: ChannelId) => void;
}

export default function ChannelDock({ active, counts, onToggle }: Props) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1">
      {CHANNELS.map((ch) => {
        const on = active.has(ch.id);
        return (
          <button
            key={ch.id}
            onClick={() => onToggle(ch.id)}
            className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[13px] font-medium backdrop-blur-md transition-colors"
            style={{
              borderColor: on ? ch.color : "rgba(255,255,255,.12)",
              background: on ? `${ch.color}22` : "rgba(0,0,0,.45)",
              color: on ? "#fff" : "rgba(255,255,255,.55)",
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: ch.color,
                boxShadow: on ? `0 0 8px ${ch.color}` : "none",
                opacity: on ? 1 : 0.5,
              }}
            />
            <span>{ch.emoji}</span>
            <span>{ch.label}</span>
            {ch.private && (
              <span className="text-[10px] opacity-70">🔒</span>
            )}
            <span className="font-mono text-[11px] opacity-60">
              {counts[ch.id] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
