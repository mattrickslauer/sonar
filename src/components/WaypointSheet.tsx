"use client";

import { CHANNEL_MAP } from "@/lib/channels";
import { formatAge, formatDistance } from "@/lib/geo";
import { MEDIA_ICON, Waypoint } from "@/lib/waypoints";

interface Props {
  wp: Waypoint;
  loved: boolean;
  onLove: (id: string) => void;
  onClose: () => void;
}

const PROMOTE_THRESHOLD = 40;

export default function WaypointSheet({ wp, loved, onLove, onClose }: Props) {
  const ch = CHANNEL_MAP[wp.channel];
  // wp.love is kept authoritative (optimistically adjusted on love/unlove).
  const loveCount = wp.love;
  const pct = Math.min(100, (loveCount / PROMOTE_THRESHOLD) * 100);
  const promoted = loveCount >= PROMOTE_THRESHOLD;

  const minsLeft = Math.max(0, (wp.expiresAt - Date.now()) / 60000);
  const expiresIn =
    minsLeft < 60
      ? `${Math.round(minsLeft)}m`
      : minsLeft < 1440
        ? `${Math.floor(minsLeft / 60)}h`
        : `${Math.floor(minsLeft / 1440)}d`;

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 px-3 pb-3">
      <div className="animate-sheet rounded-3xl border border-white/12 bg-[#0a0e12]/95 p-5 backdrop-blur-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold text-[#04110c]"
              style={{ background: ch.color, boxShadow: `0 0 16px ${ch.color}66` }}
            >
              {MEDIA_ICON[wp.kind]}
            </span>
            <div>
              <div className="flex items-center gap-1.5 text-[13px]">
                <span style={{ color: ch.color }}>
                  {ch.emoji} {ch.label}
                </span>
                {ch.private && <span className="text-[11px] opacity-60">🔒</span>}
              </div>
              <p className="font-mono text-[11px] text-white/45">
                @{wp.author} · {formatAge(wp.minutesAgo)} ·{" "}
                {formatDistance(wp.meters)} away · expires in {expiresIn}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        {wp.mediaUrl && wp.kind === "photo" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={wp.mediaUrl}
            alt={wp.text || "photo"}
            className="mt-3.5 max-h-72 w-full rounded-2xl object-cover"
          />
        )}
        {wp.mediaUrl && wp.kind === "video" && (
          <video
            src={wp.mediaUrl}
            controls
            playsInline
            className="mt-3.5 max-h-72 w-full rounded-2xl bg-black"
          />
        )}
        {wp.mediaUrl && wp.kind === "voice" && (
          <audio src={wp.mediaUrl} controls className="mt-3.5 w-full" />
        )}

        {wp.text && (
          <p className="mt-3.5 text-[15px] leading-relaxed text-white/90">{wp.text}</p>
        )}

        {/* earned-permanence meter */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
            <span className="text-white/40">
              {promoted ? "★ archived — greatest hits" : "toward permanence"}
            </span>
            <span className="text-white/55">
              {loveCount}/{PROMOTE_THRESHOLD}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: promoted
                  ? "#ffd35c"
                  : `linear-gradient(90deg, ${ch.color}, var(--sonar))`,
                boxShadow: promoted ? "0 0 10px #ffb300" : `0 0 8px ${ch.color}`,
              }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <button
            onClick={() => onLove(wp.id)}
            title={loved ? "Tap to unlove" : "Love it"}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border py-3 text-[14px] font-semibold transition-colors"
            style={{
              borderColor: loved ? ch.color : "rgba(255,255,255,.12)",
              background: loved ? `${ch.color}22` : "transparent",
              color: loved ? "#fff" : "rgba(255,255,255,.8)",
            }}
          >
            <span>{loved ? "♥" : "♡"}</span>
            <span>{loved ? "Loved" : "Love it"}</span>
            <span className="font-mono text-[12px] opacity-60">{loveCount}</span>
          </button>
          <button className="rounded-2xl border border-white/12 px-4 py-3 text-[14px] text-white/70">
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
