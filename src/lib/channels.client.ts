// Client-side helpers for the channel registry API. The server returns channel
// objects shaped like the Channel interface ({ id, label, emoji, color, private }).
import { Channel } from "@/lib/channels";

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
