// Client-side helpers for the channel registry API. The server returns channel
// objects shaped like the Channel interface ({ id, label, emoji, color, private }).
import { Channel } from "@/lib/channels";

const VISIBLE_KEY = "sonar_channels";

/** The always-on channel: `general` is constantly present, so it is toggled on
 *  by default and can't be the reason the bar is empty. Other channels surface
 *  as off-by-default suggestions the user opts in to. */
const ALWAYS_ON = "general";

/**
 * The channels the user has toggled on, persisted across sessions. Beyond the
 * always-on `general` channel there is no default set — Sonar starts with just
 * `general` and the dock surfaces channels with live activity in the area as
 * off-by-default suggestions the user opts in to. The result is `general` plus
 * the user's saved selection.
 */
export function loadVisibleChannels(): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) saved = ids.filter((x): x is string => typeof x === "string");
    }
  } catch {
    saved = [];
  }
  // Always include `general`, de-duped, with `general` first.
  return [ALWAYS_ON, ...saved.filter((id) => id !== ALWAYS_ON)];
}

/** Persist the user's toggled-on channels. Best-effort; no-ops if storage fails. */
export function saveVisibleChannels(ids: string[]): void {
  try {
    localStorage.setItem(VISIBLE_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — channel prefs are best-effort */
  }
}

/** The caller's visible channels (public + private they belong to). Pass anonId
 *  so the server can include private channels an anonymous account is in. */
export async function fetchChannels(anonId?: string): Promise<Channel[]> {
  const params = new URLSearchParams();
  if (anonId) params.set("anonId", anonId);
  const res = await fetch(`/api/channels?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchChannels failed: ${res.status}`);
  const data = await res.json();
  return data.channels as Channel[];
}

/** Type-ahead search over public channels (to join an existing one). */
export async function searchChannels(q: string): Promise<Channel[]> {
  const res = await fetch(`/api/channels?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`searchChannels failed: ${res.status}`);
  const data = await res.json();
  return data.channels as Channel[];
}

export interface CreateChannelResult {
  channel: Channel;
  /** Present for public channels: true if newly created, false if it existed. */
  created?: boolean;
  /** Present for private (locked) channels: the Stripe Checkout URL to complete. */
  url?: string;
}

/**
 * Search-or-create a channel. For a public channel this is idempotent (joins the
 * existing slug or creates it). For a private channel (isPrivate) it returns a
 * Checkout `url` the caller must redirect to; the channel is usable only after
 * payment confirms.
 */
export async function createOrJoinChannel(input: {
  name: string;
  emoji?: string;
  color?: string;
  isPrivate?: boolean;
  anonId?: string;
}): Promise<CreateChannelResult> {
  const res = await fetch("/api/channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `createOrJoinChannel failed: ${res.status}`);
  return data as CreateChannelResult;
}

/** Owner: invite a member to a locked channel by email (or account id). */
export async function inviteMember(
  channelId: string,
  target: { email?: string; accountId?: string },
): Promise<void> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `inviteMember failed: ${res.status}`);
  }
}

/** Owner: cancel (unlock) a locked channel. */
export async function cancelChannel(channelId: string): Promise<void> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `cancelChannel failed: ${res.status}`);
  }
}

// --- "My Channels" management + join links ---------------------------------

/** A channel the caller owns or belongs to, with their role (the manage sheet). */
export interface MyChannel extends Channel {
  status: string;
  role: "owner" | "member";
  isOwner: boolean;
}

/** A member of a channel, for the owner's manage list. */
export interface ChannelMember {
  accountId: string;
  role: "owner" | "member";
  displayName: string | null;
  handle: string | null;
}

async function jsonOrThrow<T>(res: Response, what: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${what} failed: ${res.status}`);
  return data as T;
}

/** The caller's channels (owned + joined) with role. Pass anonId for anon members. */
export async function fetchMyChannels(anonId?: string): Promise<MyChannel[]> {
  const params = new URLSearchParams();
  if (anonId) params.set("anonId", anonId);
  const res = await fetch(`/api/me/channels?${params}`, { cache: "no-store" });
  const data = await jsonOrThrow<{ channels: MyChannel[] }>(res, "fetchMyChannels");
  return data.channels;
}

/** Owner: list a channel's members (with display names). */
export async function listChannelMembers(channelId: string): Promise<ChannelMember[]> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/members`, {
    cache: "no-store",
  });
  const data = await jsonOrThrow<{ members: ChannelMember[] }>(res, "listChannelMembers");
  return data.members;
}

/** Owner: revoke a member. */
export async function removeChannelMember(channelId: string, accountId: string): Promise<void> {
  const res = await fetch(
    `/api/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(accountId)}`,
    { method: "DELETE" },
  );
  await jsonOrThrow(res, "removeChannelMember");
}

/** Build the absolute join URL for a token (browser-only). */
export function joinUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/j/${token}`;
}

/** Owner: fetch the channel's join link (minted on first call). */
export async function getJoinLink(channelId: string): Promise<string> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/join-token`, {
    cache: "no-store",
  });
  const data = await jsonOrThrow<{ token: string }>(res, "getJoinLink");
  return joinUrl(data.token);
}

/** Owner: rotate the join link (revokes outstanding links). Returns the new URL. */
export async function rotateJoinLink(channelId: string): Promise<string> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/join-token`, {
    method: "POST",
  });
  const data = await jsonOrThrow<{ token: string }>(res, "rotateJoinLink");
  return joinUrl(data.token);
}

/** Member: leave a channel (the owner must cancel instead). */
export async function leaveChannel(channelId: string, anonId?: string): Promise<void> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/leave`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ anonId }),
  });
  await jsonOrThrow(res, "leaveChannel");
}

export interface JoinPreview {
  channel: { label: string; emoji: string; color: string };
  alreadyMember: boolean;
}

/** Public: preview a join link (the landing page). Throws on an invalid link. */
export async function fetchJoinPreview(token: string, anonId?: string): Promise<JoinPreview> {
  const params = new URLSearchParams();
  if (anonId) params.set("anonId", anonId);
  const res = await fetch(`/api/join/${encodeURIComponent(token)}?${params}`, {
    cache: "no-store",
  });
  return jsonOrThrow<JoinPreview>(res, "fetchJoinPreview");
}

/** Public: join via link. Returns the channel id to toggle on after redirect. */
export async function joinViaToken(
  token: string,
  opts: { anonId?: string; displayName?: string },
): Promise<string> {
  const res = await fetch(`/api/join/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await jsonOrThrow<{ channelId: string }>(res, "joinViaToken");
  return data.channelId;
}
