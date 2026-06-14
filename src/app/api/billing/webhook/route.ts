import type Stripe from "stripe";
import { stripe, stripeConfigured, STRIPE_WEBHOOK_SECRET } from "@/lib/server/stripe";
import { dsqlConfigured } from "@/lib/server/dsql";
import {
  upsertSubscription,
  updateSubscriptionStatusByCustomer,
} from "@/lib/server/subscriptions";
import {
  promoteWaypointToPermanent,
  expireOwnedPermanent,
} from "@/lib/server/waypoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhook — LOCAL DEV webhook (forwarded by `stripe listen`).
// Prod uses the Lambda Function URL (infra/lambda/stripe-webhook). Both keep the
// same behavior: verify signature against the RAW body, then (a) mirror the
// subscription incl. quantity into DSQL, (b) flip the pending pin to permanent on
// payment, (c) cascade-expire the account's permanent pins when the sub ends.
// Idempotent — Stripe retries safely.
export async function POST(request: Request) {
  if (!stripeConfigured() || !dsqlConfigured() || !STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return Response.json({ error: "missing signature" }, { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe webhook signature verification failed", err);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const cs = event.data.object as Stripe.Checkout.Session;
        if (cs.mode !== "subscription") break;
        const subscriptionId = asId(cs.subscription);
        if (!subscriptionId) break;
        // Retrieve the subscription for authoritative status/quantity/metadata.
        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        await syncSubscription(sub);
        await promoteFromMetadata(sub);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub);
        await promoteFromMetadata(sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = asId(sub.customer);
        const accountId = sub.metadata?.account_id ?? null;
        if (accountId) {
          await upsertSubscription({
            accountId,
            stripeCustomerId: customerId ?? "",
            stripeSubscriptionId: sub.id,
            status: sub.status,
            priceId: sub.items.data[0]?.price?.id ?? null,
            quantity: 0,
            currentPeriodEnd: periodEnd(sub),
          });
          // Subscription ended → the account's permanent pins lose permanence.
          await expireOwnedPermanent(accountId);
        } else if (customerId) {
          await updateSubscriptionStatusByCustomer(customerId, sub.status, sub.id, periodEnd(sub), 0);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`stripe webhook handler failed for ${event.type}`, err);
    return Response.json({ error: "handler error" }, { status: 500 });
  }

  return Response.json({ received: true });
}

/** Upsert the DSQL subscriptions row from a Stripe subscription object. */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = asId(sub.customer);
  const accountId = sub.metadata?.account_id ?? null;
  const quantity = sub.items.data[0]?.quantity ?? 0;
  if (accountId) {
    await upsertSubscription({
      accountId,
      stripeCustomerId: customerId ?? "",
      stripeSubscriptionId: sub.id,
      status: sub.status,
      priceId: sub.items.data[0]?.price?.id ?? null,
      quantity,
      currentPeriodEnd: periodEnd(sub),
    });
  } else if (customerId) {
    await updateSubscriptionStatusByCustomer(customerId, sub.status, sub.id, periodEnd(sub), quantity);
  }
}

/** If the subscription carries the first pin's PK/SK (set at checkout), flip that
 *  pending DynamoDB item to permanent. */
async function promoteFromMetadata(sub: Stripe.Subscription): Promise<void> {
  const pk = sub.metadata?.wp_pk;
  const sk = sub.metadata?.wp_sk;
  if (pk && sk) await promoteWaypointToPermanent(pk, sk);
}

/** A Stripe field that's either an id string or an expanded object → the id. */
function asId(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

/** current_period_end (epoch s). Lives on the subscription in older API
 *  versions and on the subscription item in newer ones — read whichever has it. */
function periodEnd(sub: Stripe.Subscription): number | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  if (typeof top === "number") return top;
  const item = sub.items.data[0] as unknown as { current_period_end?: number };
  return typeof item?.current_period_end === "number" ? item.current_period_end : null;
}
