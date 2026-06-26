"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Channel, ChannelId, normalizeChannelSlug } from "@/lib/channels";
import { searchChannels } from "@/lib/channels.client";
import {
  MediaKind,
  MEDIA_ICON,
  LIFESPAN_PRESETS,
  DEFAULT_LIFESPAN_SECONDS,
  lifespanLabel,
  lifespanPreset,
  maxBytesForLifespan,
  stashPendingDrop,
  clearPendingDrop,
  uploadMedia,
} from "@/lib/waypoints";
import { acceptFor, isUploadKind, validateMedia } from "@/lib/media";

interface Props {
  /** The channels the user can drop into (public + private they belong to). */
  channels: Channel[];
  onDrop: (
    channel: ChannelId,
    kind: MediaKind,
    text: string,
    lifespanSeconds: number,
    permanent: boolean,
    mediaKey: string | undefined,
  ) => void;
  /** Search-or-create a channel. Public resolves to the live channel; private
   *  (isPrivate) redirects to Stripe Checkout and resolves to null. */
  onResolveChannel: (name: string, isPrivate?: boolean) => Promise<Channel | null>;
  onClose: () => void;
  /** Whether billing is configured on the server. Hides the option when false. */
  billingConfigured?: boolean;
  /** Whether the user is signed in (permanent waypoints require an account). */
  signedIn?: boolean;
  /** Tapped when a signed-out user chooses "Permanent" — parent opens sign-in. */
  onRequireSignIn?: () => void;
}

// Voice is hidden for now (kept in the type + server plumbing for a clean
// re-enable later).
const KINDS: MediaKind[] = ["text", "photo", "video"];

// Verb reflects that the native picker offers capture or library by default.
const ADD_PROMPT: Record<string, string> = {
  photo: "Take or upload a photo",
  video: "Record or upload a video",
};

const FALLBACK_GENERAL: Channel = {
  id: "general",
  label: "General",
  emoji: "📢",
  color: "#60a5fa",
};

export default function DropComposer({
  channels,
  onDrop,
  onResolveChannel,
  onClose,
  billingConfigured = false,
  signedIn = false,
  onRequireSignIn,
}: Props) {
  // The drop's target channel, as a full object so we can render its pill even
  // for a freshly-created channel not yet in the parent's list. Defaults to the
  // always-present `general`.
  const [channel, setChannel] = useState<Channel>(
    () => channels.find((c) => c.id === "general") ?? channels[0] ?? FALLBACK_GENERAL,
  );
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Channel[]>([]);
  const [resolving, setResolving] = useState(false);
  // Private (locked) channel toggle. Defaults to public; toggling it on turns the
  // typed name into a new locked channel that bills the owner per member-hour and
  // is set up via Stripe Checkout on submit (like the permanent option).
  const [isPrivate, setIsPrivate] = useState(false);

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

  // Live type-ahead over public channels (debounced) so the user joins an
  // existing channel in their area instead of spawning a duplicate.
  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      // No public type-ahead while configuring a private channel — a locked
      // channel is always newly created, never joined from the public registry.
      if (isPrivate || q.length < 2) {
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
  }, [query, isPrivate]);

  // The lifespan governs the byte budget (longer life ⇒ smaller payload) and the
  // heat color of the composer. Derived live so switching lifespan re-checks the
  // already-picked file.
  const preset = lifespanPreset(lifespan) ?? LIFESPAN_PRESETS[0];
  const cap = maxBytesForLifespan(lifespan);
  const needsFile = isUploadKind(kind);
  const fileTooBig = !!file && file.size > cap;

  const slug = normalizeChannelSlug(query);
  // Existing channels matching the query — local list first (instant), then the
  // remote search, deduped, minus the one already selected.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = q
      ? channels.filter(
          (c) => c.label.toLowerCase().includes(q) || c.id.includes(slug),
        )
      : [];
    const seen = new Set<string>();
    const merged: Channel[] = [];
    for (const c of [...local, ...matches]) {
      if (c.id === channel.id || seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
    }
    return merged.slice(0, 5);
  }, [channels, matches, query, slug, channel.id]);

  const exact = useMemo(
    () => [...channels, ...matches].find((c) => c.id === slug) ?? null,
    [channels, matches, slug],
  );
  // Public "create" affordance only when not private (the private toggle owns
  // the create flow in that mode).
  const showCreate = !isPrivate && slug.length >= 2 && !exact;
  // A valid, named private channel the submit will set up via Stripe.
  const creatingPrivate = isPrivate && slug.length >= 2;
  // The pill always previews what Drop will target, so the action is never a
  // surprise: a pending locked channel, a new public channel you're about to
  // create, an existing channel you typed, or the current selection.
  const pill = creatingPrivate
    ? { emoji: "🔒", label: slug, color: "#a78bfa" }
    : showCreate
      ? { emoji: "＋", label: slug, color: "#34e3a0" }
      : exact
        ? { emoji: exact.emoji, label: exact.label, color: exact.color }
        : { emoji: channel.emoji, label: channel.label, color: channel.color };

  function pickExisting(ch: Channel) {
    setChannel(ch);
    setQuery("");
    setMatches([]);
  }

  async function createNew() {
    const n = query.trim();
    if (!n || resolving) return;
    setResolving(true);
    try {
      const ch = await onResolveChannel(n);
      if (ch) pickExisting(ch);
    } finally {
      setResolving(false);
    }
  }

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
    // Family (MIME) check here; the size cap is enforced reactively against the
    // chosen lifespan (see fileTooBig) so it updates as the lifespan changes.
    const check = validateMedia(kind, f.type);
    if (!check.ok) {
      setError(check.error);
      setPicked(null);
      e.target.value = "";
      return;
    }
    setPicked(f);
  }

  const canDrop = needsFile ? !!file && !fileTooBig : text.trim().length > 0;

  async function submit() {
    if (uploading || resolving) return;

    // Configuring a new private channel: set up the subscription via Stripe
    // Checkout (like the permanent option). Requires an account. Since the drop
    // can't be posted until the channel is paid + active, we upload any media
    // now and stash the draft — the app posts it on return (see page.tsx).
    if (creatingPrivate) {
      if (!signedIn) {
        onRequireSignIn?.();
        return;
      }
      setError(null);
      try {
        if (canDrop) {
          let mediaKey: string | undefined;
          if (needsFile && file) {
            setUploading(true);
            mediaKey = await uploadMedia(file, slug, kind, lifespan);
            setUploading(false);
          }
          stashPendingDrop({
            channel: slug,
            kind,
            text: text.trim(),
            lifespanSeconds: lifespan,
            mediaKey,
          });
        }
        setResolving(true);
        await onResolveChannel(query.trim(), true); // redirects to Stripe on success
      } catch (err) {
        // Failed before the redirect (e.g. the name is taken) — don't leave the
        // stashed draft behind to fire on some later checkout.
        clearPendingDrop();
        setError(err instanceof Error ? err.message : "could not start checkout");
        setUploading(false);
        setResolving(false);
      }
      return;
    }

    if (!canDrop) return;
    setError(null);
    try {
      // Resolve the public target from the input: create the typed new channel,
      // pick the existing one you typed, or fall back to the current selection —
      // so creating a channel here drops into it in one action.
      let target = channel;
      if (showCreate) {
        setResolving(true);
        const ch = await onResolveChannel(query.trim());
        setResolving(false);
        if (!ch) return;
        target = ch;
      } else if (exact) {
        target = exact;
      }
      let mediaKey: string | undefined;
      if (needsFile && file) {
        setUploading(true);
        mediaKey = await uploadMedia(file, target.id, kind, lifespan);
      }
      onDrop(target.id, kind, text.trim(), lifespan, permanent, mediaKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
      setUploading(false);
      setResolving(false);
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
        <div className="mb-4">
          <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-black/40 px-3 py-2">
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px]"
              style={{ background: `${pill.color}22`, color: "#fff" }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: pill.color }}
              />
              {pill.emoji} {pill.label}
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isPrivate) {
                  if (exact) pickExisting(exact);
                  else if (showCreate) void createNew();
                } else if (e.key === "Escape") {
                  setQuery("");
                  setMatches([]);
                }
              }}
              maxLength={24}
              placeholder={isPrivate ? "name your private channel" : "search or create a channel"}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
            />
            {/* Public ⇄ Private toggle. Defaults to public; untoggling routes the
                new channel through Stripe on submit (per member-hour billing). */}
            <button
              onClick={() => {
                const next = !isPrivate;
                // Carry the name you're already working with into private mode so
                // you don't have to retype it: the text in the box, or — if that's
                // empty — the selected channel pill (unless it's the default
                // `general`, which is a placeholder, not a real claim).
                if (next && !query.trim() && channel.id !== "general") {
                  setQuery(channel.label);
                }
                setIsPrivate(next);
                setMatches([]);
              }}
              title="Locked channels are private + billed per member, per hour"
              className="shrink-0 rounded-full border px-2.5 py-1 text-[12px]"
              style={{
                borderColor: isPrivate ? "#a78bfa" : "rgba(255,255,255,.12)",
                background: isPrivate ? "rgba(167,139,250,.14)" : "transparent",
                color: isPrivate ? "#fff" : "rgba(255,255,255,.55)",
              }}
            >
              {isPrivate ? "🔒 Private" : "Public"}
            </button>
          </div>

          {/* Per member-hour billing note — shown only while configuring private. */}
          {isPrivate && (
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-white/45">
              Private &amp; locked. You own it and pay a metered subscription —
              billed per member, per hour the channel stays active. Setting it up
              opens Stripe Checkout.
            </p>
          )}

          {!isPrivate && (suggestions.length > 0 || showCreate) && (
            <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/12 bg-black/55 p-1">
              {suggestions.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => pickExisting(ch)}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] text-white/80 hover:bg-white/5"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: ch.color }}
                  />
                  <span>{ch.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">{ch.label}</span>
                  {ch.private && <span className="text-[10px] opacity-70">🔒</span>}
                </button>
              ))}
              {showCreate && (
                <button
                  onClick={() => void createNew()}
                  disabled={resolving}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] text-sonar hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="text-[15px] leading-none">＋</span>
                  <span className="min-w-0 flex-1 truncate">
                    {resolving ? "Creating…" : `Create #${slug}`}
                  </span>
                </button>
              )}
            </div>
          )}
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
                <span className="font-mono text-[10px]" style={{ color: preset.color }}>
                  max {preset.sizeLabel} at {lifespanLabel(lifespan)} life
                </span>
              </button>
            ) : (
              <div
                className="rounded-2xl border bg-black/30 p-3"
                style={{ borderColor: fileTooBig ? "rgba(248,113,113,.5)" : "rgba(255,255,255,.12)" }}
              >
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
                {fileTooBig && (
                  <p className="mt-2 font-mono text-[11px] text-red-300">
                    too big for {lifespanLabel(lifespan)} · max {preset.sizeLabel} — shorten the
                    life or trim the file
                  </p>
                )}
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
          lifespan · longer life, smaller drop
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
                className="flex-1 rounded-xl border py-2 text-[13px] font-medium transition-shadow"
                style={{
                  borderColor: active ? p.color : `${p.color}40`,
                  background: active ? `${p.color}26` : `${p.color}0d`,
                  color: active ? "#fff" : p.color,
                  boxShadow: active ? `0 0 16px ${p.color}66` : "none",
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
          disabled={
            isPrivate ? slug.length < 2 || resolving : !canDrop || uploading
          }
          className="w-full rounded-2xl py-3.5 text-[15px] font-semibold text-[#04110c] disabled:opacity-40"
          style={{
            background: isPrivate ? "#a78bfa" : permanent ? "var(--sonar)" : preset.color,
          }}
        >
          {isPrivate
            ? slug.length < 2
              ? "Name your private channel"
              : resolving
                ? "Starting checkout…"
                : !signedIn
                  ? `Sign in to lock #${slug}`
                  : canDrop
                    ? `Set up #${slug} & drop`
                    : `Set up #${slug}`
            : uploading
              ? "Uploading…"
              : permanent
                ? "Drop · permanent · $5/mo"
                : fileTooBig
                  ? `Too big for ${lifespanLabel(lifespan)} · max ${preset.sizeLabel}`
                  : `Drop · expires in ${lifespanLabel(lifespan)}`}
        </button>
      </div>
    </div>
  );
}
