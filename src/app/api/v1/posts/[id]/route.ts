// /api/v1/posts/{id} — read one post, or take it down. See docs/platform/api.md.
import { parseUser } from "@/lib/server/platform/core";
import { apiError, withTenant } from "@/lib/server/platform/http";
import { deletePost, getPost } from "@/lib/server/platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withTenant<Ctx>(async (request, tenant, ctx) => {
  const { id } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("user");
  const user = raw === null ? undefined : parseUser({ id: raw }).id;
  const post = await getPost(tenant.id, id, user);
  return post ? Response.json({ post }) : apiError(404, "not_found", "no live post with that id");
});

export const DELETE = withTenant<Ctx>(async (_request, tenant, ctx) => {
  const { id } = await ctx.params;
  return (await deletePost(tenant.id, id))
    ? Response.json({ deleted: true })
    : apiError(404, "not_found", "no post with that id");
});
