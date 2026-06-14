import { readSession, createWsTicket } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/realtime/ticket — mint a short-lived (60s) WebSocket connect ticket
// for the signed-in account. The browser can't send the httpOnly session cookie
// to the cross-origin API Gateway WS endpoint, so it fetches this ticket and
// passes it in the handshake query string, where the WS authorizer verifies it.
// 401 when not signed in → the client disables live updates instead of opening
// an anonymous socket.
export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = await createWsTicket({
    id: session.sub,
    displayName: session.name,
  });
  return Response.json({ token, expiresIn: 60 });
}
