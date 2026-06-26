// The caller's channels (owned + joined), with their membership role — powers the
// "My Channels" management sheet. A static path (not /api/channels/[id]) so there's
// no collision with the channel-id routes. Resolves a session or an anonId.
import { dsqlConfigured } from "@/lib/server/dsql";
import { listMyChannelsWithRole } from "@/lib/server/channels";
import { resolveIdentity, identityErrorResponse } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MyChannel {
  id: string;
  label: string;
  emoji: string;
  color: string;
  private: boolean;
  status: string;
  role: string;
  isOwner: boolean;
}

// GET /api/me/channels[?anonId=] — channels the caller owns or belongs to.
export async function GET(request: Request) {
  if (!dsqlConfigured()) return Response.json({ channels: [] });
  const { searchParams } = new URL(request.url);
  try {
    const identity = await resolveIdentity(request, searchParams.get("anonId") ?? undefined, {
      ensure: false,
    });
    const rows = await listMyChannelsWithRole(identity.userId);
    const channels: MyChannel[] = rows.map((c) => ({
      id: c.id,
      label: c.label,
      emoji: c.emoji ?? "🔒",
      color: c.color ?? "#a855f7",
      private: c.isPrivate,
      status: c.status,
      role: c.role,
      isOwner: c.ownerAccountId === identity.userId,
    }));
    return Response.json({ channels });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
