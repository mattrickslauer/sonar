"use client";

import { useEffect, useMemo, useState } from "react";
import { Channel, ChannelId, normalizeChannelSlug } from "@/lib/channels";
import { searchChannels } from "@/lib/channels.client";

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
  const [matches, setMatches] = useState<Channel[]>([]);

  function reset() {
    setName("");
    setIsPrivate(false);
    setCreating(false);
    setMatches([]);
  }

  function create() {
    const n = name.trim();
    if (!n) return;
    onCreateChannel(n, isPrivate);
    reset();
  }

  // Joining an existing channel is the same search-or-create call — passing its
  // label reconciles to the same slug server-side, so we reuse one code path.
  function join(ch: Channel) {
    onCreateChannel(ch.label, false);
    reset();
  }

  // Live type-ahead over public channels so the user joins an existing one in
  // their area instead of spawning a duplicate. Debounced; the reaper guarantees
  // every result is a live channel, so a match means "this already exists here".
  useEffect(() => {
    const q = name.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (!creating || isPrivate || q.length < 2) {
        if (!cancelled) setMatches([]);
        return;
      }
      searchChannels(q)
        .then((res) => !cancelled && setMatches(res))
        .catch(() => !cancelled && setMatches([]));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, creating, isPrivate]);

  // "general" is sticky-first next to the New button; everything else is ranked
  // by nearby activity (count desc), tie-broken by the underlying order so the
  // carousel reads as "the general, then the busiest channels around you".
  const ordered = useMemo(() => {
    return channels
      .map((ch, i) => ({ ch, i }))
      .sort((a, b) => {
        if (a.ch.id === "general") return -1;
        if (b.ch.id === "general") return 1;
        const na = counts[a.ch.id] ?? 0;
        const nb = counts[b.ch.id] ?? 0;
        return nb - na || a.i - b.i;
      })
      .map((x) => x.ch);
  }, [channels, counts]);

  const slug = normalizeChannelSlug(name);
  // An exact-slug hit means the channel already exists — the primary action
  // becomes "Join" rather than "Create", and we lift it out of the list.
  const exact = useMemo(
    () => matches.find((m) => m.id === slug) ?? null,
    [matches, slug],
  );

  // Rank suggestions for "existing channels in this area": nearby activity first
  // (count > 0 in the loaded radius), then livelier, then alphabetical. The
  // exact match is surfaced separately, so drop it here.
  const ranked = useMemo(() => {
    return matches
      .filter((m) => m.id !== slug)
      .sort((a, b) => {
        const na = counts[a.id] ?? 0;
        const nb = counts[b.id] ?? 0;
        const nearby = (nb > 0 ? 1 : 0) - (na > 0 ? 1 : 0);
        if (nearby) return nearby;
        if (nb !== na) return nb - na;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 6);
  }, [matches, counts, slug]);

  return (
    <div className="px-4 pb-1">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-white/25 px-3 py-2 text-[13px] font-medium text-white/60 backdrop-blur-md"
        >
          <span className="text-[15px] leading-none">＋</span> New
        </button>
        {ordered.map((ch) => {
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
      </div>

      {creating && (
        <div className="mt-2 rounded-2xl border border-white/12 bg-black/55 backdrop-blur-md">
          {/* Suggestions: existing channels (area-ranked) the user can join. */}
          {!isPrivate && (exact || ranked.length > 0) && (
            <div className="border-b border-white/10 p-1">
              {exact && (
                <Suggestion
                  ch={exact}
                  count={counts[exact.id] ?? 0}
                  badge="exists"
                  onPick={() => join(exact)}
                />
              )}
              {ranked.map((ch) => (
                <Suggestion
                  key={ch.id}
                  ch={ch}
                  count={counts[ch.id] ?? 0}
                  badge={(counts[ch.id] ?? 0) > 0 ? "near you" : undefined}
                  onPick={() => join(ch)}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 p-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (exact && !isPrivate) join(exact);
                  else create();
                } else if (e.key === "Escape") {
                  reset();
                }
              }}
              maxLength={24}
              placeholder="search or create a channel"
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
              onClick={() => (exact && !isPrivate ? join(exact) : create())}
              disabled={!name.trim()}
              className="shrink-0 rounded-full bg-sonar px-3 py-1 text-[12px] font-semibold text-[#04110c] disabled:opacity-40"
            >
              {isPrivate ? "Lock · $/hr" : exact ? "Join" : "Create"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Suggestion({
  ch,
  count,
  badge,
  onPick,
}: {
  ch: Channel;
  count: number;
  badge?: string;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/5"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: ch.color }}
      />
      <span>{ch.emoji}</span>
      <span className="min-w-0 flex-1 truncate">{ch.label}</span>
      {badge && (
        <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
          {badge}
        </span>
      )}
      <span className="shrink-0 font-mono text-[11px] opacity-50">{count}</span>
    </button>
  );
}
