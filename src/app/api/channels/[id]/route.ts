// Owner-initiated cancel of a locked channel. Tells Stripe to cancel the
// subscription; the webhook's subscription.deleted handler runs the unlock
// cascade (expire the channel, drop all members + their cache rows). Doing the
// cascade in the webhook keeps it idempotent and identical to a portal cancel.
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { channelBillingConfigured } from "@/lib/server/stripe";
import { getChannel } from "@/lib/server/channels";
import { cancelChannelSubscription } from "@/lib/server/channel-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/channels/[id] — owner cancels (unlocks) a locked channel.
export async function DELETE(request: Request, ctx: Ctx) {
  if (!channelBillingConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "locked channels not configured" }, { status: 503 });
  }
  const session = await readSession(request);
  if (!session) return Response.json({ error: "sign in" }, { status: 401 });
  const { id } = await ctx.params;

  const channel = await getChannel(id);
  if (!channel) return Response.json({ error: "not found" }, { status: 404 });
  if (channel.ownerAccountId !== session.sub) {
    return Response.json({ error: "only the owner can cancel" }, { status: 403 });
  }

  await cancelChannelSubscription(id);
  return Response.json({ ok: true });
}
