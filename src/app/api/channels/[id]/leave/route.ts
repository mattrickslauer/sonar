// Self-service leave: a member removes THEMSELVES from a channel (the owner-only
// revoke lives at /members/[accountId]). Works for an anonymous member (anonId) or
// a signed-in session. The owner cannot leave their own channel — they must cancel
// it (DELETE /api/channels/[id]) so billing is torn down too.
import { dsqlConfigured } from "@/lib/server/dsql";
import { getChannel } from "@/lib/server/channels";
import { removeMember } from "@/lib/server/membership";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

// POST /api/channels/[id]/leave { anonId? } — caller leaves the channel.
export async function POST(request: Request, ctx: Ctx) {
  if (!dsqlConfigured()) {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const { id } = await ctx.params;
  const channel = await getChannel(id);
  if (!channel) return Response.json({ error: "not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const identity = await resolveIdentity(request, str(body?.anonId), { ensure: false });
    if (identity.userId === channel.ownerAccountId) {
      return Response.json({ error: "the owner cannot leave; cancel the channel instead" }, { status: 400 });
    }
    await removeMember(id, identity.userId);
    return Response.json({ ok: true });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
