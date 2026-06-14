// Server-only: Stripe ⇄ DSQL orchestration for per-waypoint subscriptions.
// One Stripe subscription per account whose quantity = the account's number of
// permanent waypoints ($5/mo each). Shared by the /api/billing/permanent routes.
import { stripe } from "@/lib/server/stripe";
import type { Account } from "@/lib/server/accounts";
import {
  type Subscription,
  getSubscriptionByAccount,
  upsertSubscription,
  setQuantity,
} from "@/lib/server/subscriptions";

/**
 * The account's Stripe customer id, creating (and persisting) one on first use.
 * Reuses the customer across checkout/cancel/re-subscribe so an account is always
 * a single Stripe customer with one saved card.
 */
export async function ensureCustomer(account: Account): Promise<string> {
  const sub = await getSubscriptionByAccount(account.id);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: account.email ?? undefined,
    name: account.displayName,
    metadata: { account_id: account.id },
  });
  // Persist immediately (status incomplete, qty 0) so the webhook can resolve
  // events by customer id even before checkout completes.
  await upsertSubscription({
    accountId: account.id,
    stripeCustomerId: customer.id,
    status: "incomplete",
    quantity: 0,
  });
  return customer.id;
}

/**
 * Push a new permanent-waypoint count to Stripe and mirror it to DSQL:
 *  - newQty >= 1 → update the subscription item quantity (default proration:
 *    the monthly total moves by $5×Δ, the partial-period amount rolls onto the
 *    next invoice — no off-session charge to fail).
 *  - newQty <= 0 → cancel the subscription (no permanent waypoints left).
 * No-op if the account has no live Stripe subscription id.
 */
export async function applyQuantity(
  sub: Subscription,
  newQty: number,
): Promise<void> {
  if (!sub.stripeSubscriptionId) return;
  if (newQty <= 0) {
    await stripe().subscriptions.cancel(sub.stripeSubscriptionId);
    await upsertSubscription({
      accountId: sub.accountId,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      status: "canceled",
      quantity: 0,
    });
    return;
  }
  const s = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
  const itemId = s.items.data[0]?.id;
  if (itemId) {
    await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, quantity: newQty }],
      proration_behavior: "create_prorations",
    });
  }
  await setQuantity(sub.accountId, newQty);
}
