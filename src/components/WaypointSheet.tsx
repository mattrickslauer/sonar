"use client";

import { useState } from "react";
import { CHANNEL_MAP } from "@/lib/channels";
import { formatAge, formatDistance } from "@/lib/geo";
import { MEDIA_ICON, Waypoint, shareUrl } from "@/lib/waypoints";

interface Props {
  wp: Waypoint;
  loved: boolean;
  onLove: (id: string) => void;
  onClose: () => void;
  /** The signed-in user's name, attached to the share link as the referrer
   *  (`?r=<username>`). Undefined when anonymous → no referral param. */
  shareUser?: string;
  /** The signed-in account id, to detect ownership of this waypoint. */
  currentUserId?: string;
  /** Open the permanent-waypoint console (shown for owned permanent pins). */
  onManage?: () => void;
}

export default function WaypointSheet({
  wp,
  loved,
  onLove,
  onClose,
  shareUser,
  currentUserId,
  onManage,
}: Props) {
  const ch = CHANNEL_MAP[wp.channel];
  // wp.love is kept authoritative (optimistically adjusted on love/unlove).
  const loveCount = wp.love;
  // The signed-in user owns this permanent pin → offer the management console.
  const ownsPermanent = wp.sponsored && !!currentUserId && wp.ownerId === currentUserId;

  // "copied" feedback for the clipboard fallback (when navigator.share is absent).
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = shareUrl(wp, shareUser);
    const title = `${ch.label} on Sonar`;
    const text = wp.text || `@${wp.author} dropped a ${wp.kind} on Sonar`;
    // Prefer the native share sheet (mobile). A throw here means the user
    // dismissed it — don't fall back to copy in that case.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        /* dismissed — nothing to do */
      }
      return;
    }
    // No native share (most desktops): copy the link and confirm.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.error("share", e);
    }
  }

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
                {formatDistance(wp.meters)} away ·{" "}
                {wp.sponsored ? "permanent" : `expires in ${expiresIn}`}
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

        {/* sponsored permanent waypoint badge — tappable for the owner */}
        {wp.sponsored && (
          <button
            onClick={ownsPermanent ? onManage : undefined}
            disabled={!ownsPermanent}
            className="mt-4 flex w-full items-center justify-between gap-2 rounded-2xl border border-[#ffd35c]/30 bg-[#ffd35c]/10 px-3 py-2 text-left disabled:cursor-default"
          >
            <span className="flex items-center gap-2">
              <span className="text-[13px] text-[#ffd35c]">◆</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#ffd35c]">
                Sponsored{wp.sponsor ? ` · ${wp.sponsor}` : ""} · permanent
              </span>
            </span>
            {ownsPermanent && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#ffd35c]/80">
                Manage ›
              </span>
            )}
          </button>
        )}

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
          <button
            onClick={share}
            title="Share this waypoint"
            className="rounded-2xl border border-white/12 px-4 py-3 text-[14px] text-white/70 transition-colors"
          >
            {copied ? "Copied ✓" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
