// Public join-link endpoint. A private channel's link is /j/<joinToken>; the
// landing page GETs the channel preview (no id leaked pre-join) and POSTs to join.
// Joining works for anonymous visitors (resolveIdentity ensure:true lazily creates
// the anon account) or a signed-in session, and only for ACTIVE private channels.
import { dsqlConfigured } from "@/lib/server/dsql";
import { getChannelByJoinToken } from "@/lib/server/channels";
import { addMember, isMember } from "@/lib/server/membership";
import { setDisplayNameIfUnclaimed } from "@/lib/server/accounts";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

// GET /api/join/[token] — public preview for the join landing page. Resolves the
// token to an ACTIVE private channel and returns just its presentation (the live
// channel id is withheld until the visitor actually joins).
export async function GET(request: Request, ctx: Ctx) {
  if (!dsqlConfigured()) {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const { token } = await ctx.params;
  const channel = await getChannelByJoinToken(token);
  if (!channel || !channel.isPrivate || channel.status !== "active") {
    return Response.json({ error: "this link is no longer valid" }, { status: 404 });
  }

  // If the caller already belongs, say so (the page can skip straight to the map).
  let alreadyMember = false;
  try {
    const { searchParams } = new URL(request.url);
    const id = await resolveIdentity(request, searchParams.get("anonId") ?? undefined, {
      ensure: false,
    });
    alreadyMember = await isMember(channel.id, id.userId);
  } catch {
    // no identity → just a logged-out preview
  }

  return Response.json({
    channel: {
      label: channel.label,
      emoji: channel.emoji ?? "🔒",
      color: channel.color ?? "#a855f7",
    },
    alreadyMember,
  });
}

// POST /api/join/[token] { anonId?, displayName? } — join the channel. Returns the
// channel id so the client can toggle it on and redirect to the map.
export async function POST(request: Request, ctx: Ctx) {
  if (!dsqlConfigured()) {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
  const { token } = await ctx.params;
  const channel = await getChannelByJoinToken(token);
  if (!channel || !channel.isPrivate || channel.status !== "active") {
    return Response.json({ error: "this link is no longer valid" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const identity = await resolveIdentity(request, str(body?.anonId), { ensure: true });
    const displayName = str(body?.displayName);
    if (displayName) await setDisplayNameIfUnclaimed(identity.userId, displayName);
    await addMember(channel.id, identity.userId, "member");
    return Response.json({ channelId: channel.id });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
