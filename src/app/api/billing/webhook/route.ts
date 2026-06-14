import type Stripe from "stripe";
import { stripe, stripeConfigured, STRIPE_WEBHOOK_SECRET } from "@/lib/server/stripe";
import { dsqlConfigured } from "@/lib/server/dsql";
import {
  upsertSubscription,
  updateSubscriptionStatusByCustomer,
} from "@/lib/server/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhook
// Stripe → us. The single source that mutates subscription state in DSQL.
// Signature is verified against the RAW body (request.text(), never .json()) so
// a forged event can't grant access. Idempotent: Stripe retries, and our upsert
// converges, so duplicate/out-of-order deliveries are safe.
export async function POST(request: Request) {
  if (!stripeConfigured() || !dsqlConfigured() || !STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) return Response.json({ error: "missing signature" }, { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      raw,
      sig,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    // Bad signature or malformed payload → reject. Don't leak details.
    console.error("stripe webhook signature verification failed", err);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const cs = event.data.object as Stripe.Checkout.Session;
        // Only subscription checkouts concern us.
        if (cs.mode !== "subscription") break;
        const accountId =
          cs.client_reference_id ?? cs.metadata?.account_id ?? null;
        const customerId = asId(cs.customer);
        const subscriptionId = asId(cs.subscription);
        if (!accountId || !customerId || !subscriptionId) break;

        // Retrieve the subscription for authoritative status/price/period.
        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        await upsertSubscription({
          accountId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          priceId: sub.items.data[0]?.price?.id ?? null,
          currentPeriodEnd: periodEnd(sub),
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = asId(sub.customer);
        if (!customerId) break;
        // Prefer the account_id stamped at checkout so we can upsert even if the
        // pre-checkout row is missing; otherwise update the existing customer row.
        const accountId = sub.metadata?.account_id ?? null;
        if (accountId) {
          await upsertSubscription({
            accountId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status,
            priceId: sub.items.data[0]?.price?.id ?? null,
            currentPeriodEnd: periodEnd(sub),
          });
        } else {
          await updateSubscriptionStatusByCustomer(
            customerId,
            sub.status,
            sub.id,
            periodEnd(sub),
          );
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged (200) so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // A processing failure → 500 so Stripe retries later (the handler is
    // idempotent, so a retry is safe).
    console.error(`stripe webhook handler failed for ${event.type}`, err);
    return Response.json({ error: "handler error" }, { status: 500 });
  }

  return Response.json({ received: true });
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
