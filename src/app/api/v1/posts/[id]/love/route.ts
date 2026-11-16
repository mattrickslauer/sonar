// /api/v1/posts/{id}/love — a user likes (POST) or unlikes (DELETE) a post.
// Each like buys the post five more minutes. See docs/platform/api.md.
import { parseUser } from "@/lib/server/platform/core";
import { apiError, readJson, withTenant } from "@/lib/server/platform/http";
import { setLove } from "@/lib/server/platform/store";
import type { Tenant } from "@/lib/server/platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const love = (dir: 1 | -1) => async (request: Request, tenant: Tenant, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = parseUser((await readJson(request) as Record<string, unknown> | null)?.user);
  const result = await setLove(tenant.id, id, user.id, dir);
  return result ? Response.json(result) : apiError(404, "not_found", "no live post with that id");
};

export const POST = withTenant<Ctx>(love(1));
export const DELETE = withTenant<Ctx>(love(-1));
