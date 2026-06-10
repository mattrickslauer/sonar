"use client";

import { useState } from "react";
import { CHANNELS, ChannelId } from "@/lib/channels";
import {
  MediaKind,
  MEDIA_ICON,
  LIFESPAN_PRESETS,
  DEFAULT_LIFESPAN_SECONDS,
  lifespanLabel,
} from "@/lib/waypoints";

interface Props {
  onDrop: (channel: ChannelId, kind: MediaKind, text: string, lifespanSeconds: number) => void;
  onClose: () => void;
}

const KINDS: MediaKind[] = ["text", "photo", "video", "voice"];

export default function DropComposer({ onDrop, onClose }: Props) {
  const [channel, setChannel] = useState<ChannelId>("social");
  const [kind, setKind] = useState<MediaKind>("text");
  const [text, setText] = useState("");
  const [lifespan, setLifespan] = useState(DEFAULT_LIFESPAN_SECONDS);

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm">
      <div className="animate-sheet w-full rounded-t-3xl border-t border-white/12 bg-[#0a0e12] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">Drop a waypoint</h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          channel
        </p>
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setChannel(ch.id)}
              className="shrink-0 rounded-full border px-3 py-1.5 text-[13px]"
              style={{
                borderColor: channel === ch.id ? ch.color : "rgba(255,255,255,.12)",
                background: channel === ch.id ? `${ch.color}22` : "transparent",
                color: channel === ch.id ? "#fff" : "rgba(255,255,255,.6)",
              }}
            >
              {ch.emoji} {ch.label}
            </button>
          ))}
        </div>

        <div className="mb-4 flex gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className="flex-1 rounded-xl border py-2 text-[13px] capitalize"
              style={{
                borderColor: kind === k ? "var(--sonar)" : "rgba(255,255,255,.12)",
                background: kind === k ? "rgba(52,227,160,.12)" : "transparent",
                color: kind === k ? "#fff" : "rgba(255,255,255,.6)",
              }}
            >
              {MEDIA_ICON[k]} {k}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What's happening here, right now?"
          className="mb-4 w-full resize-none rounded-2xl border border-white/12 bg-black/40 p-3.5 text-[14px] text-white placeholder:text-white/35 focus:border-sonar/50 focus:outline-none"
        />

        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          lifespan
        </p>
        <div className="mb-4 flex gap-2">
          {LIFESPAN_PRESETS.map((p) => (
            <button
              key={p.seconds}
              onClick={() => setLifespan(p.seconds)}
              className="flex-1 rounded-xl border py-2 text-[13px]"
              style={{
                borderColor: lifespan === p.seconds ? "var(--sonar)" : "rgba(255,255,255,.12)",
                background: lifespan === p.seconds ? "rgba(52,227,160,.12)" : "transparent",
                color: lifespan === p.seconds ? "#fff" : "rgba(255,255,255,.6)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => text.trim() && onDrop(channel, kind, text.trim(), lifespan)}
          disabled={!text.trim()}
          className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
        >
          Drop · expires in {lifespanLabel(lifespan)}
        </button>
      </div>
    </div>
  );
}
