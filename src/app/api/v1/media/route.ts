// POST /api/v1/media — an upload ticket (presigned POST) for a tenant's photo,
// video or voice clip. See docs/platform/api.md.
import { isUploadKind, MEDIA_LIMITS } from "@/lib/media";
import { createTenantUpload, mediaConfigured } from "@/lib/server/media";
import { InputError } from "@/lib/server/platform/core";
import { apiError, readJson, withTenant } from "@/lib/server/platform/http";
import { recordUsage } from "@/lib/server/platform/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(async (request, tenant) => {
  if (!mediaConfigured()) return apiError(503, "media_unavailable", "media uploads are not configured");
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const kind = body?.kind;
  const contentType = body?.contentType;
  if (typeof kind !== "string" || !isUploadKind(kind)) throw new InputError("kind must be photo, video or voice");
  if (typeof contentType !== "string" || !contentType.startsWith(MEDIA_LIMITS[kind].prefix)) {
    throw new InputError(`contentType must be ${MEDIA_LIMITS[kind].accept} for a ${kind}`);
  }
  const ticket = await createTenantUpload(tenant.id, kind, contentType);
  await recordUsage(tenant.id, { uploads: 1 });
  return Response.json({ ...ticket, maxBytes: MEDIA_LIMITS[kind].maxBytes }, { status: 201 });
});
