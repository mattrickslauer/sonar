"use client";

import { useEffect, useRef, useState } from "react";
import { CHANNELS, ChannelId } from "@/lib/channels";
import {
  MediaKind,
  MEDIA_ICON,
  LIFESPAN_PRESETS,
  DEFAULT_LIFESPAN_SECONDS,
  lifespanLabel,
  uploadMedia,
} from "@/lib/waypoints";
import {
  MEDIA_LIMITS,
  acceptFor,
  isUploadKind,
  validateMedia,
} from "@/lib/media";

interface Props {
  onDrop: (
    channel: ChannelId,
    kind: MediaKind,
    text: string,
    lifespanSeconds: number,
    permanent: boolean,
    mediaKey?: string,
  ) => void;
  onClose: () => void;
  /** Whether billing is configured on the server. Hides the option when false. */
  billingConfigured?: boolean;
  /** Whether the user is signed in (permanent waypoints require an account). */
  signedIn?: boolean;
  /** Tapped when a signed-out user chooses "Permanent" — parent opens sign-in. */
  onRequireSignIn?: () => void;
}

const KINDS: MediaKind[] = ["text", "photo", "video", "voice"];

// Verb reflects that the native picker offers capture or library by default.
const ADD_PROMPT: Record<string, string> = {
  photo: "Take or upload a photo",
  video: "Record or upload a video",
  voice: "Record or upload audio",
};

export default function DropComposer({
  onDrop,
  onClose,
  billingConfigured = false,
  signedIn = false,
  onRequireSignIn,
}: Props) {
  const [channel, setChannel] = useState<ChannelId>("social");
  const [kind, setKind] = useState<MediaKind>("text");
  const [text, setText] = useState("");
  const [lifespan, setLifespan] = useState(DEFAULT_LIFESPAN_SECONDS);
  // A permanent (never-expiring) drop, mutually exclusive with a preset lifespan.
  // $5/mo each — billed when the drop is submitted (Checkout or one-click).
  const [permanent, setPermanent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Hold the live object URL so the unmount cleanup can revoke whatever's
  // current without re-subscribing the effect on every pick.
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  // Set/replace the picked file and its preview URL, revoking the prior one.
  function setPicked(f: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = f ? URL.createObjectURL(f) : null;
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(f);
  }

  // Switching kind clears any picked file (its type may no longer be valid).
  function pickKind(k: MediaKind) {
    setKind(k);
    setPicked(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setPicked(null);
      return;
    }
    const check = validateMedia(kind, f.type, f.size);
    if (!check.ok) {
      setError(check.error);
      setPicked(null);
      e.target.value = "";
      return;
    }
    setPicked(f);
  }

  const needsFile = isUploadKind(kind);
  const canDrop = needsFile ? !!file : text.trim().length > 0;

  async function submit() {
    if (!canDrop || uploading) return;
    setError(null);
    try {
      let mediaKey: string | undefined;
      if (needsFile && file) {
        setUploading(true);
        mediaKey = await uploadMedia(file, channel, kind);
      }
      onDrop(channel, kind, text.trim(), lifespan, permanent, mediaKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
      setUploading(false);
    }
  }

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
              onClick={() => pickKind(k)}
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

        {needsFile && (
          <div className="mb-4">
            <input
              ref={fileInput}
              type="file"
              accept={acceptFor(kind)}
              onChange={pickFile}
              className="hidden"
            />
            {!file ? (
              <button
                onClick={() => fileInput.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/20 bg-black/30 py-6 text-white/60 transition-colors hover:border-white/35"
              >
                <span className="text-[22px]">{MEDIA_ICON[kind]}</span>
                <span className="text-[13px]">{ADD_PROMPT[kind]}</span>
                <span className="font-mono text-[10px] text-white/35">
                  uses your camera or library · max {MEDIA_LIMITS[kind].label}
                </span>
              </button>
            ) : (
              <div className="rounded-2xl border border-white/12 bg-black/30 p-3">
                {kind === "photo" && previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="preview"
                    className="mb-3 max-h-48 w-full rounded-xl object-cover"
                  />
                )}
                {kind === "video" && previewUrl && (
                  <video
                    src={previewUrl}
                    controls
                    className="mb-3 max-h-48 w-full rounded-xl"
                  />
                )}
                {kind === "voice" && previewUrl && (
                  <audio src={previewUrl} controls className="mb-3 w-full" />
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-white/55">
                    {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <button
                    onClick={() => {
                      setPicked(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                    className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] text-white/60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={
            needsFile
              ? "Add a caption (optional)…"
              : "What's happening here, right now?"
          }
          className="mb-4 w-full resize-none rounded-2xl border border-white/12 bg-black/40 p-3.5 text-[14px] text-white placeholder:text-white/35 focus:border-sonar/50 focus:outline-none"
        />

        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          lifespan
        </p>
        <div className="mb-3 flex gap-2">
          {LIFESPAN_PRESETS.map((p) => {
            const active = !permanent && lifespan === p.seconds;
            return (
              <button
                key={p.seconds}
                onClick={() => {
                  setLifespan(p.seconds);
                  setPermanent(false);
                }}
                className="flex-1 rounded-xl border py-2 text-[13px]"
                style={{
                  borderColor: active ? "var(--sonar)" : "rgba(255,255,255,.12)",
                  background: active ? "rgba(52,227,160,.12)" : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,.6)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Permanent (paid) option — $5/mo per pin. Hidden when billing isn't
            configured. A signed-out user tapping it is sent to sign-in first. */}
        {billingConfigured && (
          <button
            onClick={() => {
              if (!signedIn) onRequireSignIn?.();
              else setPermanent((v) => !v);
            }}
            className="mb-4 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-[13px]"
            style={{
              borderColor: permanent ? "var(--sonar)" : "rgba(255,255,255,.12)",
              background: permanent ? "rgba(52,227,160,.12)" : "transparent",
              color: permanent ? "#fff" : "rgba(255,255,255,.6)",
            }}
          >
            <span className="flex items-center gap-2">
              <span className="text-[15px]">∞</span> Permanent
            </span>
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
              style={{
                background: permanent ? "rgba(52,227,160,.18)" : "rgba(255,255,255,.06)",
                color: permanent ? "var(--sonar)" : "rgba(255,255,255,.45)",
              }}
            >
              {!signedIn ? "sign in" : permanent ? "selected · $5/mo" : "$5/mo"}
            </span>
          </button>
        )}

        {error && (
          <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={!canDrop || uploading}
          className="w-full rounded-2xl bg-sonar py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
        >
          {uploading
            ? "Uploading…"
            : permanent
              ? "Drop · permanent · $5/mo"
              : `Drop · expires in ${lifespanLabel(lifespan)}`}
        </button>
      </div>
    </div>
  );
}
