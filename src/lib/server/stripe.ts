// Server-only: the Stripe client + billing config. Stripe is the billing
// authority for paid subscriptions; the durable mirror of subscription STATE
// lives in DSQL (see ./subscriptions.ts) so the app can gate the permanent-
// waypoint feature without a Stripe call on the hot path.
//
// CONFIG (set in .env.local / Vercel — the user supplies the keys):
//   STRIPE_SECRET_KEY      sk_… secret key. Server-only; never sent to the client.
//   STRIPE_WEBHOOK_SECRET  whsec_… signing secret for /api/billing/webhook.
//   STRIPE_PRICE_ID        price_… the recurring price the subscription buys.
//   NEXT_PUBLIC_APP_URL    (optional) absolute base for Checkout return URLs;
//                          falls back to the request's own origin when unset.
//
// Hosted Checkout means no client-side Stripe SDK and no card data ever touching
// our servers — billing features degrade gracefully (503) when keys are absent,
// the same pattern auth/DSQL use.
import Stripe from "stripe";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
// A recurring METERED price (recurring.usage_type=metered, aggregate_usage=sum)
// for locked private channels. One usage unit = one member-hour; the hourly tick
// (infra/lambda/channel-meter-tick) reports usage = current member count.
export const STRIPE_CHANNEL_PRICE_ID = process.env.STRIPE_CHANNEL_PRICE_ID;

/** Whether billing is configured (secret key + price present). Routes return
 *  503 when false so the app keeps running without Stripe. */
export function stripeConfigured(): boolean {
  return Boolean(SECRET_KEY && STRIPE_PRICE_ID);
}

/** Whether LOCKED-CHANNEL billing is configured (secret key + metered price). */
export function channelBillingConfigured(): boolean {
  return Boolean(SECRET_KEY && STRIPE_CHANNEL_PRICE_ID);
}

let client: Stripe | undefined;

/** Lazily-built singleton Stripe client. Throws if the secret key is unset. */
export function stripe(): Stripe {
  if (!SECRET_KEY) {
    throw new Error("Stripe is not configured: set STRIPE_SECRET_KEY.");
  }
  if (!client) {
    // Pin no apiVersion → the installed SDK uses its own pinned version, which
    // keeps the typed surface and the wire format in lockstep across upgrades.
    client = new Stripe(SECRET_KEY, { appInfo: { name: "sonar" } });
  }
  return client;
}

/**
 * Resolve the absolute base URL for Checkout success/cancel redirects. Prefers
 * the explicit NEXT_PUBLIC_APP_URL; otherwise derives it from the request's
 * Origin/Host so local dev and preview deployments work without extra config.
 */
export function appBaseUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = req.headers.get("host");
  const proto = host?.startsWith("localhost") || host?.startsWith("127.")
    ? "http"
    : "https";
  return host ? `${proto}://${host}` : "";
}
