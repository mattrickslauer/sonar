// Sonar Platform — the request wrapper every /api/v1 route goes through:
// bearer key → tenant, per-minute budget, usage count, uniform JSON errors.
import { bearerKey, InputError } from "./core";
import { authenticateKey, recordUsage, takeRequest, Tenant } from "./store";

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InputError("body must be valid JSON");
  }
}

export function withTenant<C>(handler: (request: Request, tenant: Tenant, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const key = bearerKey(request.headers.get("authorization"));
    if (!key) return apiError(401, "missing_key", "send Authorization: Bearer sk_live_…");
    try {
      const auth = await authenticateKey(key);
      if (!auth.ok) return apiError(auth.status, auth.code, auth.message);
      const { tenant } = auth;
      if (!(await takeRequest(tenant))) {
        return apiError(429, "rate_limited", `over ${tenant.ratePerMinute} requests this minute`, {}, { "Retry-After": "60" });
      }
      await recordUsage(tenant.id, { requests: 1 });
      return await handler(request, tenant, ctx);
    } catch (err) {
      if (err instanceof InputError) return apiError(400, err.code, err.message);
      console.error("platform api error", err);
      return apiError(500, "server_error", "something went wrong on Sonar's side");
    }
  };
}
