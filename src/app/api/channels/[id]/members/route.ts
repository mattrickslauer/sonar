// Owner-only membership management for a locked channel: list members, invite a
// member by email or account id. Invite-only (no self-join) per the design. The
// invited account gains read/post access (REST guard) and can connect (the WS
// authorizer reads the DynamoDB membership mirror addMember writes).
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { getAccountById, getAccountByEmail, isUuid } from "@/lib/server/accounts";
import { getChannel } from "@/lib/server/channels";
import { addMember, listMembers } from "@/lib/server/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Resolve the request to the channel owner, or an error Response. */
async function requireOwner(request: Request, channelId: string) {
  if (!dsqlConfigured() || !sessionConfigured()) {
    return { error: Response.json({ error: "not configured" }, { status: 503 }) };
  }
  const session = await readSession(request);
  if (!session) return { error: Response.json({ error: "sign in" }, { status: 401 }) };
  const channel = await getChannel(channelId);
  if (!channel) return { error: Response.json({ error: "not found" }, { status: 404 }) };
  if (channel.ownerAccountId !== session.sub) {
    return { error: Response.json({ error: "only the owner can manage members" }, { status: 403 }) };
  }
  return { session, channel };
}

// GET /api/channels/[id]/members — owner lists the allow-list.
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const owner = await requireOwner(request, id);
  if ("error" in owner) return owner.error;
  return Response.json({ members: await listMembers(id) });
}

// POST /api/channels/[id]/members { email? | accountId? } — owner invites.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const owner = await requireOwner(request, id);
  if ("error" in owner) return owner.error;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : undefined;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : undefined;

  const target = accountId && isUuid(accountId)
    ? await getAccountById(accountId)
    : email
      ? await getAccountByEmail(email)
      : null;
  if (!target) {
    return Response.json({ error: "no account for that email/id" }, { status: 404 });
  }

  await addMember(id, target.id, "member");
  return Response.json({ ok: true, accountId: target.id });
}
