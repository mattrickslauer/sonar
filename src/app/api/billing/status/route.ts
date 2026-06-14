import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { stripeConfigured } from "@/lib/server/stripe";
import {
  getSubscriptionByAccount,
  isActiveStatus,
} from "@/lib/server/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/billing/status
// The signed-in user's subscription state, used by the client to decide whether
// to offer the "permanent" drop option or a subscribe CTA. Anonymous callers
// (and unconfigured billing) get { active: false } rather than an error, so the
// UI degrades cleanly.
export async function GET(request: Request) {
  const inactive = { active: false, status: null as string | null };

  if (!stripeConfigured() || !dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ ...inactive, configured: false });
  }
  const session = await readSession(request);
  if (!session) return Response.json({ ...inactive, configured: true });

  const sub = await getSubscriptionByAccount(session.sub);
  return Response.json({
    active: isActiveStatus(sub?.status),
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    configured: true,
  });
}
