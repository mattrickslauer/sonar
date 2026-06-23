"use client";

import { useState } from "react";
import { Channel, ChannelId } from "@/lib/channels";

interface Props {
  /** The visible channel set (public + private the user belongs to). */
  channels: Channel[];
  active: Set<ChannelId>;
  counts: Record<string, number>;
  onToggle: (id: ChannelId) => void;
  /** Search-or-create a channel. isPrivate routes through Stripe Checkout. */
  onCreateChannel: (name: string, isPrivate: boolean) => void;
}

export default function ChannelDock({
  channels,
  active,
  counts,
  onToggle,
  onCreateChannel,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  function submit() {
    const n = name.trim();
    if (!n) return;
    onCreateChannel(n, isPrivate);
    setName("");
    setIsPrivate(false);
    setCreating(false);
  }

  return (
    <div className="px-4 pb-1">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {channels.map((ch) => {
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
              {ch.private && <span className="text-[10px] opacity-70">🔒</span>}
              <span className="font-mono text-[11px] opacity-60">
                {counts[ch.id] ?? 0}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-white/25 px-3 py-2 text-[13px] font-medium text-white/60 backdrop-blur-md"
        >
          <span className="text-[15px] leading-none">＋</span> New
        </button>
      </div>

      {creating && (
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/12 bg-black/55 p-2 backdrop-blur-md">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            maxLength={24}
            placeholder="channel name"
            className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-white placeholder:text-white/35 focus:outline-none"
          />
          <button
            onClick={() => setIsPrivate((v) => !v)}
            title="Locked channels are private + billed per member/hour"
            className="shrink-0 rounded-full border px-2.5 py-1 text-[12px]"
            style={{
              borderColor: isPrivate ? "var(--sonar)" : "rgba(255,255,255,.12)",
              background: isPrivate ? "rgba(52,227,160,.12)" : "transparent",
              color: isPrivate ? "#fff" : "rgba(255,255,255,.55)",
            }}
          >
            {isPrivate ? "🔒 Locked" : "Public"}
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="shrink-0 rounded-full bg-sonar px-3 py-1 text-[12px] font-semibold text-[#04110c] disabled:opacity-40"
          >
            {isPrivate ? "Lock · $/hr" : "Create"}
          </button>
        </div>
      )}
    </div>
  );
}
