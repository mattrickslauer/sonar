// Owner-only revoke of a channel member. Removes the DSQL row + the DynamoDB
// membership mirror, so the WS authorizer denies the revoked account's next
// $connect and the REST guard rejects its reads/posts. (Already-open sockets are
// left to drop on their own — the authorizer gates reconnection.)
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { getChannel } from "@/lib/server/channels";
import { removeMember } from "@/lib/server/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; accountId: string }> };

// DELETE /api/channels/[id]/members/[accountId] — owner revokes a member.
export async function DELETE(request: Request, ctx: Ctx) {
  if (!dsqlConfigured() || !sessionConfigured()) {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const session = await readSession(request);
  if (!session) return Response.json({ error: "sign in" }, { status: 401 });
  const { id, accountId } = await ctx.params;

  const channel = await getChannel(id);
  if (!channel) return Response.json({ error: "not found" }, { status: 404 });
  if (channel.ownerAccountId !== session.sub) {
    return Response.json({ error: "only the owner can revoke members" }, { status: 403 });
  }
  if (accountId === channel.ownerAccountId) {
    return Response.json({ error: "cannot revoke the owner" }, { status: 400 });
  }

  await removeMember(id, accountId);
  return Response.json({ ok: true });
}
