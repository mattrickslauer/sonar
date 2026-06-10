import { lovedAmong } from "@/lib/server/waypoints";

// Reads DynamoDB per request — never cached.
export const dynamic = "force-dynamic";

// POST /api/loves  { user, ids: string[] }  →  { loved: string[] }
// Which of `ids` has `user` already loved? Used to seed loved-state on load.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : null;
  if (!body?.user || !ids) {
    return Response.json({ error: "user and ids[] are required" }, { status: 400 });
  }
  const loved = await lovedAmong(ids, body.user);
  return Response.json({ loved });
}
