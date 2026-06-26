"use client";

// "My Channels" — the management console for private channels the user owns or
// belongs to. List view → per-channel detail. Owners get the shareable join link
// (copy / regenerate), invite-by-email, a member list with remove, and cancel.
// Members get a Leave action. All APIs already exist; this is the UI over them.
import { useCallback, useEffect, useState } from "react";
import {
  fetchMyChannels,
  listChannelMembers,
  removeChannelMember,
  getJoinLink,
  rotateJoinLink,
  leaveChannel,
  inviteMember,
  cancelChannel,
  type MyChannel,
  type ChannelMember,
} from "@/lib/channels.client";

interface Props {
  /** The anonymous account id, for resolving identity on member-side actions. */
  anonId: string;
  onClose: () => void;
  /** Called after a change that affects the dock's channel set (join/leave/cancel). */
  onChanged?: () => void;
}

export default function MyChannelsSheet({ anonId, onClose, onChanged }: Props) {
  const [channels, setChannels] = useState<MyChannel[] | null>(null);
  const [selected, setSelected] = useState<MyChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(() => {
    fetchMyChannels(anonId)
      .then(setChannels)
      .catch((e) => setError(e instanceof Error ? e.message : "could not load channels"));
  }, [anonId]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm">
      <div className="animate-sheet flex max-h-[88%] w-full flex-col rounded-t-3xl border-t border-white/12 bg-[#0a0e12] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            {selected ? (
              <button
                onClick={() => setSelected(null)}
                className="text-white/50 hover:text-white/80"
                aria-label="Back"
              >
                ‹
              </button>
            ) : null}
            {selected ? (
              <span className="flex items-center gap-1.5">
                <span>{selected.emoji}</span>
                <span className="truncate">{selected.label}</span>
              </span>
            ) : (
              "My channels"
            )}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-white/50"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <ChannelDetail
              channel={selected}
              anonId={anonId}
              onError={setError}
              onLeftOrCancelled={() => {
                setSelected(null);
                loadChannels();
                onChanged?.();
              }}
            />
          ) : (
            <ChannelList channels={channels} onSelect={setSelected} />
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelList({
  channels,
  onSelect,
}: {
  channels: MyChannel[] | null;
  onSelect: (c: MyChannel) => void;
}) {
  if (channels === null) {
    return (
      <p className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-white/35">
        loading…
      </p>
    );
  }
  if (channels.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] leading-relaxed text-white/50">
        You don&apos;t own or belong to any private channels yet. Create one from the
        channel bar (the lock toggle) to get a shareable join link.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {channels.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c)}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-left"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[18px]"
            style={{ backgroundColor: `${c.color}1f`, border: `1px solid ${c.color}55` }}
          >
            {c.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-white">{c.label}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
              {c.isOwner ? "owner" : "member"}
            </span>
          </span>
          <span className="text-white/30">›</span>
        </button>
      ))}
    </div>
  );
}

function ChannelDetail({
  channel,
  anonId,
  onError,
  onLeftOrCancelled,
}: {
  channel: MyChannel;
  anonId: string;
  onError: (msg: string | null) => void;
  onLeftOrCancelled: () => void;
}) {
  if (channel.isOwner) {
    return (
      <OwnerDetail channel={channel} onError={onError} onCancelled={onLeftOrCancelled} />
    );
  }
  return <MemberDetail channel={channel} anonId={anonId} onError={onError} onLeft={onLeftOrCancelled} />;
}

function OwnerDetail({
  channel,
  onError,
  onCancelled,
}: {
  channel: MyChannel;
  onError: (msg: string | null) => void;
  onCancelled: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadMembers = useCallback(() => {
    listChannelMembers(channel.id)
      .then(setMembers)
      .catch((e) => onError(e instanceof Error ? e.message : "could not load members"));
  }, [channel.id, onError]);

  useEffect(() => {
    onError(null);
    getJoinLink(channel.id)
      .then(setLink)
      .catch((e) => onError(e instanceof Error ? e.message : "could not load link"));
    loadMembers();
  }, [channel.id, loadMembers, onError]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("could not copy — select the link and copy manually");
    }
  }

  async function regenerate() {
    setBusy(true);
    onError(null);
    try {
      setLink(await rotateJoinLink(channel.id));
      setCopied(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not regenerate link");
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const clean = email.trim();
    if (!clean || inviting) return;
    setInviting(true);
    onError(null);
    try {
      await inviteMember(channel.id, { email: clean });
      setEmail("");
      setInvited(true);
      setTimeout(() => setInvited(false), 1500);
      loadMembers();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not invite");
    } finally {
      setInviting(false);
    }
  }

  async function remove(accountId: string) {
    onError(null);
    try {
      await removeChannelMember(channel.id, accountId);
      loadMembers();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not remove member");
    }
  }

  async function doCancel() {
    setBusy(true);
    onError(null);
    try {
      await cancelChannel(channel.id);
      onCancelled();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not cancel channel");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-1">
      {/* Join link */}
      <section>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          join link
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={link ?? "…"}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-2xl border border-white/12 bg-black/40 px-3 py-2.5 font-mono text-[12px] text-white/80 focus:border-sonar/50 focus:outline-none"
          />
          <button
            onClick={copy}
            disabled={!link}
            className="shrink-0 rounded-2xl bg-sonar px-4 py-2.5 text-[13px] font-semibold text-[#04110c] disabled:opacity-40"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          onClick={regenerate}
          disabled={busy}
          className="mt-2 text-[12px] text-white/45 hover:text-white/70 disabled:opacity-40"
        >
          ↻ Regenerate link (revokes the old one)
        </button>
      </section>

      {/* Invite by email */}
      <section>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          invite by email
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
            placeholder="they@example.com"
            className="min-w-0 flex-1 rounded-2xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white placeholder:text-white/35 focus:border-sonar/50 focus:outline-none"
          />
          <button
            onClick={invite}
            disabled={!email.trim() || inviting}
            className="shrink-0 rounded-2xl border border-white/15 bg-black/55 px-4 py-2.5 text-[13px] font-semibold text-white/85 disabled:opacity-40"
          >
            {inviting ? "…" : invited ? "Sent" : "Invite"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-white/35">
          Works only for people who already have a Sonar account. Otherwise share the
          join link above.
        </p>
      </section>

      {/* Members */}
      <section>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          members{members ? ` · ${members.length}` : ""}
        </p>
        <div className="flex flex-col gap-1.5">
          {members?.map((m) => (
            <div
              key={m.accountId}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/30 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">
                {memberName(m)}
                {m.role === "owner" && (
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.14em] text-sonar/80">
                    owner
                  </span>
                )}
              </span>
              {m.role !== "owner" && (
                <button
                  onClick={() => remove(m.accountId)}
                  className="shrink-0 rounded-lg border border-white/12 px-2 py-1 text-[11px] text-white/55 hover:border-red-400/40 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Cancel */}
      <section className="border-t border-white/8 pt-4">
        {confirmCancel ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] leading-relaxed text-white/60">
              Cancel this channel? Billing stops, all members are removed, and the
              channel becomes unavailable.
            </p>
            <div className="flex gap-2">
              <button
                onClick={doCancel}
                disabled={busy}
                className="flex-1 rounded-2xl bg-red-500/90 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={busy}
                className="flex-1 rounded-2xl border border-white/12 bg-black/55 py-3 text-[14px] font-semibold text-white/85"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmCancel(true)}
            className="w-full rounded-2xl border border-red-400/25 bg-red-500/5 py-3 text-[14px] font-semibold text-red-300/90"
          >
            Cancel channel
          </button>
        )}
      </section>
    </div>
  );
}

function MemberDetail({
  channel,
  anonId,
  onError,
  onLeft,
}: {
  channel: MyChannel;
  anonId: string;
  onError: (msg: string | null) => void;
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    onError(null);
    try {
      await leaveChannel(channel.id, anonId);
      onLeft();
    } catch (e) {
      onError(e instanceof Error ? e.message : "could not leave");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-white/55">
        You&apos;re a member of this private channel. Leaving removes your access; you
        can rejoin later with a join link from the owner.
      </p>
      <button
        onClick={leave}
        disabled={busy}
        className="w-full rounded-2xl border border-red-400/25 bg-red-500/5 py-3 text-[14px] font-semibold text-red-300/90 disabled:opacity-40"
      >
        {busy ? "Leaving…" : "Leave channel"}
      </button>
    </div>
  );
}

/** A readable label for a member: their display name, else a short id. */
function memberName(m: ChannelMember): string {
  const name = m.displayName?.trim();
  if (name && name !== "you") return name;
  if (name === "you") return "Anonymous";
  return `${m.accountId.slice(0, 8)}…`;
}
