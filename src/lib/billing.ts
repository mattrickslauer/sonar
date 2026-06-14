// Client-side billing helpers for per-waypoint subscriptions ($5/mo each).
// Hosted Checkout for the first pin (saves the card), one-click for the rest;
// the client never touches card data or a Stripe SDK.
import type { ChannelId } from "./channels";
import type { MediaKind, Waypoint } from "./waypoints";

export interface PermanentSubscription {
  status: string;
  active: boolean;
  /** Number of permanent waypoints billed. */
  quantity: number;
  /** Per-waypoint price in cents (500 = $5). */
  unitAmount: number;
  currentPeriodEnd: string | null;
}

export interface PermanentConsole {
  waypoints: Waypoint[];
  subscription: PermanentSubscription | null;
  /** Whether Stripe billing is configured on the server. */
  configured: boolean;
}

export interface PermanentDraft {
  channel: ChannelId;
  kind: MediaKind;
  text: string;
  lat: number;
  lng: number;
  mediaKey?: string;
}

/** The management-console payload: the user's permanent waypoints + subscription
 *  summary. Anonymous / unconfigured → empty with `configured` reflecting Stripe. */
export async function fetchPermanentConsole(): Promise<PermanentConsole> {
  try {
    const res = await fetch("/api/billing/permanent", { cache: "no-store" });
    if (!res.ok) return { waypoints: [], subscription: null, configured: false };
    return (await res.json()) as PermanentConsole;
  } catch {
    return { waypoints: [], subscription: null, configured: false };
  }
}

/**
 * Create a permanent waypoint. Returns `{ url }` when first-time Checkout is
 * required (caller redirects), or `{ waypoint }` when it was added one-click
 * against an existing subscription. Throws with the server message on error
 * (e.g. 401 "sign in").
 */
export async function createPermanentWaypoint(
  draft: PermanentDraft,
): Promise<{ url?: string; waypoint?: Waypoint }> {
  const res = await fetch("/api/billing/permanent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `error ${res.status}`);
  return data as { url?: string; waypoint?: Waypoint };
}

export interface PermanentPatch {
  text?: string;
  channel?: ChannelId;
  lat?: number;
  lng?: number;
}

/** Edit an owned permanent waypoint (caption / channel / location). */
export async function updatePermanentWaypoint(
  id: string,
  patch: PermanentPatch,
): Promise<Waypoint> {
  const res = await fetch(`/api/billing/permanent/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `error ${res.status}`);
  return data.waypoint as Waypoint;
}

/** Delete an owned permanent waypoint (decrements / cancels the subscription). */
export async function deletePermanentWaypoint(
  id: string,
): Promise<{ remaining: number }> {
  const res = await fetch(`/api/billing/permanent/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `error ${res.status}`);
  return data as { remaining: number };
}

/** Open the Stripe Billing Portal (manage card / invoices / cancel). */
export async function openBillingPortal(): Promise<void> {
  const res = await fetch("/api/billing/portal", { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(data?.error ?? `error ${res.status}`);
  window.location.assign(data.url as string);
}
