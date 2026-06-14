import { ChannelId } from "@/lib/channels";
import { isUploadKind } from "@/lib/media";
import { isValidMediaKey } from "@/lib/server/media";
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { getAccountById } from "@/lib/server/accounts";
import { stripe, stripeConfigured, STRIPE_PRICE_ID, appBaseUrl } from "@/lib/server/stripe";
import { encodeGeohash } from "@/lib/geohash";
import {
  putWaypoint,
  queryMyWaypoints,
  countPermanentWaypoints,
} from "@/lib/server/waypoints";
import {
  getSubscriptionByAccount,
  isActiveStatus,
} from "@/lib/server/subscriptions";
import { ensureCustomer, applyQuantity } from "@/lib/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Permanent waypoints are billed $5/mo each: one Stripe subscription per account
// whose quantity = number of permanent pins. The FIRST pin goes through hosted
// Checkout (saves the card, creates the subscription); SUBSEQUENT pins increment
// the quantity server-side with no redirect.

// A pending pin lives this long (seconds) before checkout confirms it. If the
// user abandons Checkout, it simply expires like any short-lived drop.
const PENDING_SECONDS = 60 * 60;

interface Draft {
  channel: ChannelId;
  kind: string;
  text: string;
  lat: number;
  lng: number;
  mediaKey?: string;
}

function parseDraft(body: unknown): Draft | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const kind = typeof b.kind === "string" ? b.kind : "text";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const mediaKey = b.mediaKey;
  if (!b.channel || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "channel, lat, lng are required" };
  }
  if (!text && !mediaKey) return { error: "text or mediaKey is required" };
  if (mediaKey !== undefined) {
    if (typeof mediaKey !== "string" || !isValidMediaKey(mediaKey)) {
      return { error: "invalid mediaKey" };
    }
  } else if (isUploadKind(kind)) {
    return { error: `${kind} drops require an uploaded file` };
  }
  return {
    channel: b.channel as ChannelId,
    kind,
    text,
    lat,
    lng,
    mediaKey: typeof mediaKey === "string" ? mediaKey : undefined,
  };
}

// GET /api/billing/permanent — the management console payload: the account's
// permanent waypoints + its subscription summary.
export async function GET(request: Request) {
  const empty = { waypoints: [], subscription: null, configured: stripeConfigured() };
  if (!stripeConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json(empty);
  }
  const session = await readSession(request);
  if (!session) return Response.json(empty);

  const [waypoints, sub] = await Promise.all([
    queryMyWaypoints(session.sub, true),
    getSubscriptionByAccount(session.sub),
  ]);
  return Response.json({
    waypoints,
    subscription: sub
      ? {
          status: sub.status,
          active: isActiveStatus(sub.status),
          quantity: waypoints.length, // truth = actual permanent pins
          unitAmount: 500, // cents, $5
          currentPeriodEnd: sub.currentPeriodEnd,
        }
      : null,
    configured: true,
  });
}

// POST /api/billing/permanent — create a permanent waypoint.
// Returns { url } when the user must complete first-time Checkout, or
// { waypoint } when it was added one-click against an existing subscription.
export async function POST(request: Request) {
  if (!stripeConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "sign in to create a permanent waypoint" }, { status: 401 });
  }
  const account = await getAccountById(session.sub);
  if (!account) return Response.json({ error: "account not found" }, { status: 404 });

  const draft = parseDraft(await request.json().catch(() => null));
  if ("error" in draft) return Response.json({ error: draft.error }, { status: 400 });

  const sub = await getSubscriptionByAccount(account.id);

  // One-click add against a live subscription.
  if (sub && isActiveStatus(sub.status) && sub.stripeSubscriptionId) {
    const newQty = (await countPermanentWaypoints(account.id)) + 1;
    await applyQuantity(sub, newQty); // bill first, then materialize the pin
    const waypoint = await putWaypoint({
      channel: draft.channel,
      kind: draft.kind as never,
      text: draft.text,
      lat: draft.lat,
      lng: draft.lng,
      ownerId: account.id,
      author: account.displayName,
      sponsored: true,
      sponsor: account.displayName,
      mediaKey: draft.mediaKey,
    });
    return Response.json({ waypoint }, { status: 201 });
  }

  // First-time: write a short-lived pending pin, then hand off to Checkout. The
  // webhook flips this exact item to permanent on payment (via wp_pk/wp_sk meta).
  const pending = await putWaypoint({
    channel: draft.channel,
    kind: draft.kind as never,
    text: draft.text,
    lat: draft.lat,
    lng: draft.lng,
    ownerId: account.id,
    author: account.displayName,
    lifespanSeconds: PENDING_SECONDS,
    mediaKey: draft.mediaKey,
  });
  const pk = `CH#${draft.channel}#GEO#${encodeGeohash(draft.lat, draft.lng, 6)}`;
  const sk = `WP#${pending.id}`;
  const customerId = await ensureCustomer(account);
  const base = appBaseUrl(request);
  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: account.id,
    subscription_data: {
      metadata: { account_id: account.id, wp_pk: pk, wp_sk: sk, wp_id: pending.id },
    },
    success_url: `${base}/?billing=success`,
    cancel_url: `${base}/?billing=cancelled`,
    allow_promotion_codes: true,
  });
  if (!checkout.url) {
    return Response.json({ error: "could not start checkout" }, { status: 502 });
  }
  return Response.json({ url: checkout.url });
}
