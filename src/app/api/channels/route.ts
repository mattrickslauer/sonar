// Channel registry API: discover/search public channels and search-or-create.
// Creating a public channel is idempotent (the normalized slug is the unique id,
// so re-creating just joins it). Creating a PRIVATE (locked) channel mints a
// random id and hands off to Stripe Checkout — it becomes usable only once the
// webhook confirms payment and seeds the owner as a member.
import { CHANNELS } from "@/lib/channels";
import { readSession, sessionConfigured } from "@/lib/server/session";
import { dsqlConfigured } from "@/lib/server/dsql";
import { getAccountById } from "@/lib/server/accounts";
import { channelBillingConfigured } from "@/lib/server/stripe";
import {
  type ChannelRow,
  listPublicChannels,
  searchPublicChannels,
  searchOrCreateChannel,
  createPrivateChannel,
  getChannel,
  randomChannelId,
  ChannelNameError,
} from "@/lib/server/channels";
import { listMyPrivateChannelIds, putChannelMeta } from "@/lib/server/membership";
import { createChannelCheckout } from "@/lib/server/channel-billing";
import { resolveIdentity } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClientChannel {
  id: string;
  label: string;
  emoji: string;
  color: string;
  private: boolean;
}

function toClient(c: ChannelRow): ClientChannel {
  return {
    id: c.id,
    label: c.label,
    emoji: c.emoji ?? "📍",
    color: c.color ?? "#22d3ee",
    private: c.isPrivate,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

// GET /api/channels[?q=][&anonId=] — the caller's visible channels: all public
// channels (or a search), plus any private channels they're a member of.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  if (!dsqlConfigured()) {
    return Response.json({ channels: CHANNELS.map((c) => ({ ...c, private: !!c.private })) });
  }
  try {
    const pub = q ? await searchPublicChannels(q) : await listPublicChannels();
    let mine: ChannelRow[] = [];
    if (!q) {
      try {
        const id = await resolveIdentity(request, searchParams.get("anonId") ?? undefined, {
          ensure: false,
        });
        const ids = await listMyPrivateChannelIds(id.userId);
        mine = (await Promise.all(ids.map((cid) => getChannel(cid)))).filter(
          (r): r is ChannelRow => r != null && r.status === "active",
        );
      } catch {
        // no identity → just the public set
      }
    }
    return Response.json({ channels: [...pub, ...mine].map(toClient) });
  } catch (err) {
    // Degrade gracefully (e.g. registry not migrated yet) so the radar keeps
    // working with the static core channels rather than hard-failing.
    console.error("GET /api/channels failed; falling back to static core", err);
    return Response.json({
      channels: CHANNELS.map((c) => ({ ...c, private: !!c.private })),
    });
  }
}

// POST /api/channels { name, emoji?, color?, isPrivate?, anonId? }
//   public  → search-or-create, returns { channel, created }
//   private → create + Stripe Checkout, returns { channel, url }
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = str(body?.name);
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  const emoji = str(body?.emoji);
  const color = str(body?.color);

  if (body?.isPrivate) {
    // Locked private channel: needs Stripe + a claimed account (session).
    if (!channelBillingConfigured() || !dsqlConfigured() || !sessionConfigured()) {
      return Response.json({ error: "locked channels not configured" }, { status: 503 });
    }
    const session = await readSession(request);
    if (!session) {
      return Response.json({ error: "sign in to create a locked channel" }, { status: 401 });
    }
    const account = await getAccountById(session.sub);
    if (!account) return Response.json({ error: "account not found" }, { status: 404 });

    const id = randomChannelId();
    const channel = await createPrivateChannel({
      id,
      label: name,
      ownerAccountId: account.id,
      emoji,
      color,
    });
    await putChannelMeta(id, true); // so the WS authorizer knows it's private
    const url = await createChannelCheckout(account, id, request);
    if (!url) return Response.json({ error: "could not start checkout" }, { status: 502 });
    return Response.json({ channel: toClient(channel), url });
  }

  // Public channel: search-or-create.
  if (!dsqlConfigured()) {
    return Response.json({ error: "channels not configured" }, { status: 503 });
  }
  let ownerAccountId: string | undefined;
  try {
    const id = await resolveIdentity(request, str(body?.anonId), { ensure: false });
    ownerAccountId = id.userId;
  } catch {
    // anonymous create with no id → unowned public channel is fine
  }
  try {
    const { channel, created } = await searchOrCreateChannel({
      rawLabel: name,
      emoji,
      color,
      ownerAccountId,
    });
    return Response.json({ channel: toClient(channel), created }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ChannelNameError) {
      return Response.json({ error: "channel name has no usable characters" }, { status: 400 });
    }
    throw err;
  }
}
