// GET /api/v1/usage?days=30 — the tenant's hourly usage, what billing is based on.
import { InputError } from "@/lib/server/platform/core";
import { withTenant } from "@/lib/server/platform/http";
import { readUsage } from "@/lib/server/platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (request, tenant) => {
  const raw = new URL(request.url).searchParams.get("days");
  const days = raw === null ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new InputError("days must be an integer from 1 to 400");
  return Response.json({ tenant: tenant.id, hours: await readUsage(tenant.id, days) });
});
