// Owner-only join-link management for a locked channel. GET returns the channel's
// join token (minting one on first view); POST rotates it, invalidating every
// outstanding /j/<token> link. The client builds the absolute URL from the token.
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import {
  getChannel,
  getOrCreateJoinToken,
  rotateJoinToken,
} from "@/lib/server/channels";

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
    return { error: Response.json({ error: "only the owner can manage the join link" }, { status: 403 }) };
  }
  return { channel };
}

// GET /api/channels/[id]/join-token — owner reads the link (mints on first view).
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const owner = await requireOwner(request, id);
  if ("error" in owner) return owner.error;
  return Response.json({ token: await getOrCreateJoinToken(id) });
}

// POST /api/channels/[id]/join-token — owner rotates the link (revokes old ones).
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const owner = await requireOwner(request, id);
  if ("error" in owner) return owner.error;
  return Response.json({ token: await rotateJoinToken(id) });
}
