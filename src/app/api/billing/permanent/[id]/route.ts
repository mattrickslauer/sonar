import { normalizeChannelSlug } from "@/lib/channels";
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { channelExists } from "@/lib/server/channels";
import { stripeConfigured } from "@/lib/server/stripe";
import {
  editOwnedWaypoint,
  deleteOwnedWaypoint,
  countPermanentWaypoints,
  type EditWaypointPatch,
} from "@/lib/server/waypoints";
import { getSubscriptionByAccount } from "@/lib/server/subscriptions";
import { applyQuantity } from "@/lib/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function configured(): boolean {
  return stripeConfigured() && dsqlConfigured() && sessionConfigured();
}

// PATCH /api/billing/permanent/[id] — edit caption / channel / location of an
// owned permanent waypoint. Channel/location changes re-key the item; billing is
// unaffected (the subscription is account-level, not pin-keyed).
export async function PATCH(request: Request, ctx: Ctx) {
  if (!configured()) return Response.json({ error: "billing not configured" }, { status: 503 });
  const session = await readSession(request);
  if (!session) return Response.json({ error: "sign in" }, { status: 401 });
  const { id } = await ctx.params;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const patch: EditWaypointPatch = {};
  if (typeof b?.text === "string") patch.text = b.text.trim();
  if (typeof b?.channel === "string") {
    // Open channel set: validate against the DSQL registry (cached), not a
    // hardcoded map. Store the normalized slug.
    const slug = normalizeChannelSlug(b.channel);
    if (slug && (await channelExists(slug))) patch.channel = slug;
  }
  const lat = Number(b?.lat);
  const lng = Number(b?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    patch.lat = lat;
    patch.lng = lng;
  }
  if (patch.text === undefined && patch.channel === undefined && patch.lat === undefined) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const waypoint = await editOwnedWaypoint(session.sub, id, patch);
  if (!waypoint) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ waypoint });
}

// DELETE /api/billing/permanent/[id] — remove an owned permanent waypoint and
// decrement the subscription quantity (cancel it entirely when none remain).
export async function DELETE(request: Request, ctx: Ctx) {
  if (!configured()) return Response.json({ error: "billing not configured" }, { status: 503 });
  const session = await readSession(request);
  if (!session) return Response.json({ error: "sign in" }, { status: 401 });
  const { id } = await ctx.params;

  const deleted = await deleteOwnedWaypoint(session.sub, id);
  if (!deleted) return Response.json({ error: "not found" }, { status: 404 });

  const remaining = await countPermanentWaypoints(session.sub);
  const sub = await getSubscriptionByAccount(session.sub);
  if (sub?.stripeSubscriptionId) {
    await applyQuantity(sub, remaining); // decrements, or cancels at 0
  }
  return Response.json({ deleted: true, remaining });
}
