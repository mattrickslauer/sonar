// Client-side billing helpers. Subscriptions are managed by Stripe hosted
// Checkout: the client never touches card data or a Stripe SDK — it just asks
// our server for a Checkout URL and reads back the subscription status.

export interface SubscriptionStatus {
  /** True when the signed-in user currently has an entitling subscription. */
  active: boolean;
  /** Raw Stripe status ('active','trialing','past_due','canceled'…), or null. */
  status: string | null;
  /** Whether billing is configured on the server (Stripe keys present). */
  configured: boolean;
  currentPeriodEnd?: string | null;
}

/** The signed-in user's subscription status. Anonymous → { active: false }. */
export async function fetchSubscription(): Promise<SubscriptionStatus> {
  try {
    const res = await fetch("/api/billing/status", { cache: "no-store" });
    if (!res.ok) return { active: false, status: null, configured: false };
    return (await res.json()) as SubscriptionStatus;
  } catch {
    return { active: false, status: null, configured: false };
  }
}

/**
 * Start a Checkout session and redirect the browser to Stripe. On return Stripe
 * sends the user back to `/?billing=success|cancelled`. Throws with the server's
 * message (e.g. 401 "sign in to subscribe") so the caller can surface it.
 */
export async function startCheckout(): Promise<void> {
  const res = await fetch("/api/billing/checkout", { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error(data?.error ?? `checkout failed: ${res.status}`);
  }
  window.location.assign(data.url as string);
}
