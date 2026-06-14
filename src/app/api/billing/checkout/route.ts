import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { getAccountById } from "@/lib/server/accounts";
import {
  stripe,
  stripeConfigured,
  STRIPE_PRICE_ID,
  appBaseUrl,
} from "@/lib/server/stripe";
import {
  getSubscriptionByAccount,
  upsertSubscription,
} from "@/lib/server/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/checkout
// Authenticated only. Creates (or reuses) the account's Stripe customer and
// returns a hosted Checkout Session URL the client redirects to. The actual
// subscription state is recorded later by the webhook, on completion.
export async function POST(request: Request) {
  if (!stripeConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  // Only a claimed account (with a session) may subscribe — anonymous devices
  // can't. The client cannot override this with a body field.
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "sign in to subscribe" }, { status: 401 });
  }

  const account = await getAccountById(session.sub);
  if (!account) {
    return Response.json({ error: "account not found" }, { status: 404 });
  }

  // Reuse the customer from a prior checkout so a user who subscribes, cancels,
  // and resubscribes stays one Stripe customer (and one subscriptions row).
  const existing = await getSubscriptionByAccount(account.id);
  let customerId = existing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: account.email ?? undefined,
      name: account.displayName,
      // Lets a Stripe-dashboard human (and the webhook, as a fallback) map the
      // customer back to our account.
      metadata: { account_id: account.id },
    });
    customerId = customer.id;
    // Persist the customer immediately (status 'incomplete') so the webhook can
    // resolve subscription.* events by customer id even before checkout completes.
    await upsertSubscription({
      accountId: account.id,
      stripeCustomerId: customerId,
      status: "incomplete",
    });
  }

  const base = appBaseUrl(request);
  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    // Carried back to us on checkout.session.completed, and stamped on the
    // subscription so every later subscription.* event can identify the account.
    client_reference_id: account.id,
    subscription_data: { metadata: { account_id: account.id } },
    success_url: `${base}/?billing=success`,
    cancel_url: `${base}/?billing=cancelled`,
    allow_promotion_codes: true,
  });

  if (!checkout.url) {
    return Response.json({ error: "could not start checkout" }, { status: 502 });
  }
  return Response.json({ url: checkout.url });
}
