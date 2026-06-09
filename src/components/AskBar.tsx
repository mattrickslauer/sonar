"use client";

import { useState } from "react";
import { CHANNEL_MAP } from "@/lib/channels";
import { formatAge } from "@/lib/geo";
import { Waypoint } from "@/lib/waypoints";

interface Props {
  waypoints: Waypoint[];
  place: string;
}

/**
 * "Ask the place" — in the real product this calls Bedrock (Claude) over the
 * cell's last 24h. Here we synthesise a grounded answer locally from the live
 * waypoints so the interaction is demoable end-to-end.
 */
function synthesize(q: string, waypoints: Waypoint[]): string {
  const recent = [...waypoints]
    .sort((a, b) => b.love / (b.minutesAgo + 5) - a.love / (a.minutesAgo + 5))
    .slice(0, 4);
  if (!recent.length) return "It's quiet here right now — no signals in the last 24h.";

  const lead = recent[0];
  const ch = CHANNEL_MAP[lead.channel];
  const bullets = recent
    .map((w) => `• ${CHANNEL_MAP[w.channel].emoji} ${w.text} (${formatAge(w.minutesAgo)})`)
    .join("\n");
  return `Right now the loudest signal is on ${ch.emoji} ${ch.label}: "${lead.text}". Across the last 24h here:\n${bullets}`;
}

export default function AskBar({ waypoints, place }: Props) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  function ask(text: string) {
    const query = text.trim();
    if (!query) return;
    setQ(query);
    setThinking(true);
    setAnswer(null);
    // simulate the model round-trip
    window.setTimeout(() => {
      setAnswer(synthesize(query, waypoints));
      setThinking(false);
    }, 750);
  }

  const suggestions = ["What's the vibe?", "Where's the food?", "Shortest line?"];

  return (
    <div className="px-4">
      {(thinking || answer) && (
        <div className="mb-2 rounded-2xl border border-sonar/25 bg-black/55 p-3.5 backdrop-blur-md">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[13px]">🤖</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-sonar/80">
              ask {place}
            </span>
          </div>
          {thinking ? (
            <p className="animate-pulse text-[13px] text-white/55">
              scanning the last 24h…
            </p>
          ) : (
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/85">
              {answer}
            </p>
          )}
        </div>
      )}

      {!answer && !thinking && (
        <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="shrink-0 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[12px] text-white/65 backdrop-blur-md"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-2 rounded-2xl border border-white/12 bg-black/55 px-3.5 py-2.5 backdrop-blur-md focus-within:border-sonar/50"
      >
        <span className="text-sonar/70">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask ${place} anything…`}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-white placeholder:text-white/35 focus:outline-none"
        />
        {answer && (
          <button
            type="button"
            onClick={() => {
              setAnswer(null);
              setQ("");
            }}
            className="text-[12px] text-white/40"
          >
            clear
          </button>
        )}
        <button
          type="submit"
          className="rounded-xl bg-sonar px-3 py-1.5 text-[13px] font-semibold text-[#04110c]"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
