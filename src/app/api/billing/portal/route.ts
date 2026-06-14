import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { stripe, stripeConfigured, appBaseUrl } from "@/lib/server/stripe";
import { getSubscriptionByAccount } from "@/lib/server/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/portal — a Stripe Billing Portal session for the signed-in
// account's customer (manage payment method, view invoices, cancel). Returns
// { url } for the client to redirect to.
export async function POST(request: Request) {
  if (!stripeConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }
  const session = await readSession(request);
  if (!session) return Response.json({ error: "sign in" }, { status: 401 });

  const sub = await getSubscriptionByAccount(session.sub);
  if (!sub?.stripeCustomerId) {
    return Response.json({ error: "no billing account yet" }, { status: 400 });
  }
  const portal = await stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appBaseUrl(request)}/`,
  });
  return Response.json({ url: portal.url });
}
