// Server-only: Stripe orchestration for LOCKED private channels. A locked
// channel is a DISTINCT metered subscription (separate from the per-account
// permanent-waypoint subscription), billed per member-hour. The owner pays via
// hosted Checkout; the Stripe webhook activates the channel + seeds owner
// membership; the hourly tick (infra/lambda/channel-meter-tick) reports usage.
// See src/lib/server/channels.ts (channel_billing) + 008_channel_billing.sql.
import { stripe, STRIPE_CHANNEL_PRICE_ID, appBaseUrl } from "@/lib/server/stripe";
import type { Account } from "@/lib/server/accounts";
import { getChannelBilling } from "@/lib/server/channels";

/**
 * A DEDICATED Stripe customer per locked channel. Stripe's flexible billing
 * meters attribute usage by CUSTOMER (meter events carry a stripe_customer_id),
 * so a 1:1 channel↔customer mapping is required to bill each channel separately
 * when one account owns several. Always created fresh in the current Stripe mode
 * (which also sidesteps any cross-mode customer reuse on the shared DSQL
 * cluster). The customer is persisted in channel_billing by the webhook; the
 * hourly tick reports member-hours against it.
 */
async function createChannelCustomer(account: Account, channelId: string): Promise<string> {
  const customer = await stripe().customers.create({
    email: account.email ?? undefined,
    name: `${account.displayName} · channel ${channelId}`,
    metadata: { account_id: account.id, channel_id: channelId },
  });
  return customer.id;
}

/**
 * Start hosted Checkout for a locked channel: a `subscription`-mode session on
 * the metered channel price. Metered prices reject `quantity`, so the line item
 * carries only the price; usage is reported later by the tick. The subscription
 * metadata carries `kind:'channel'` (the webhook discriminator that keeps these
 * events away from the permanent-waypoint subscription path) and the channel id.
 */
export async function createChannelCheckout(
  account: Account,
  channelId: string,
  request: Request,
): Promise<string | null> {
  const customerId = await createChannelCustomer(account, channelId);
  const base = appBaseUrl(request);
  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_CHANNEL_PRICE_ID }], // metered: no quantity
    client_reference_id: account.id,
    subscription_data: {
      metadata: { account_id: account.id, channel_id: channelId, kind: "channel" },
    },
    success_url: `${base}/?channel=${channelId}&locked=success`,
    cancel_url: `${base}/?channel=${channelId}&locked=cancelled`,
    allow_promotion_codes: true,
  });
  return checkout.url ?? null;
}

/**
 * Cancel a locked channel's subscription. The webhook's subscription.deleted
 * handler runs the unlock cascade (expire channel, drop members + sockets), so
 * this only needs to tell Stripe to cancel — idempotent if already gone.
 */
export async function cancelChannelSubscription(channelId: string): Promise<void> {
  const billing = await getChannelBilling(channelId);
  if (!billing?.stripeSubscriptionId) return;
  try {
    await stripe().subscriptions.cancel(billing.stripeSubscriptionId);
  } catch (err) {
    // Already canceled / not found → the cascade will (or did) run from the
    // webhook; don't fail the request.
    if ((err as { code?: string })?.code === "resource_missing") return;
    throw err;
  }
}
