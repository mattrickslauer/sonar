// /api/v1/posts — create a post, or read a place wall / what's nearby.
// See docs/platform/api.md.
import { parseFeedQuery, parseNewPost } from "@/lib/server/platform/core";
import { apiError, readJson, withTenant } from "@/lib/server/platform/http";
import { moderatePhoto } from "@/lib/server/platform/moderation";
import { createPost, readFeed, recordUsage } from "@/lib/server/platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(async (request, tenant) => {
  const input = parseNewPost(tenant.id, await readJson(request));
  if (input.kind === "photo" && input.mediaKey) {
    let verdict;
    try {
      verdict = await moderatePhoto(input.mediaKey);
    } catch (err) {
      // No object at that key (never uploaded, or the ticket wasn't used).
      if (err instanceof Error && /InvalidS3Object|NoSuchKey/i.test(err.name)) {
        return apiError(400, "media_missing", "upload the file to the ticket's url before posting");
      }
      throw err;
    }
    if (verdict.status !== "off") await recordUsage(tenant.id, { moderations: 1 });
    if (verdict.status === "rejected") {
      return apiError(422, "rejected_by_moderation", "this photo can't be posted", { labels: verdict.labels });
    }
  }
  const post = await createPost(tenant.id, input);
  await recordUsage(tenant.id, { posts: 1 });
  return Response.json({ post }, { status: 201 });
});

export const GET = withTenant(async (request, tenant) => {
  const query = parseFeedQuery(new URL(request.url).searchParams);
  return Response.json({ posts: await readFeed(tenant.id, query) });
});
