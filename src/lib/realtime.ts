// Browser WebSocket client for the live radar feed. Connects to the API
// Gateway WebSocket API (NEXT_PUBLIC_WS_URL) subscribed to the given channels,
// and invokes onWaypoint for each pushed waypoint. Auto-reconnects with backoff.
import { RawWaypoint } from "./waypoints";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

/**
 * Open a radar socket. Returns a disposer that closes it for good (no further
 * reconnects). No-op (returns a noop disposer) when NEXT_PUBLIC_WS_URL is unset.
 */
export function openRadarSocket(
  channels: string[],
  onWaypoint: (wp: RawWaypoint) => void,
): () => void {
  if (!WS_URL) {
    console.warn("NEXT_PUBLIC_WS_URL not set — live updates disabled");
    return () => {};
  }

  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;

  const scheduleRetry = () => {
    if (closed) return;
    retry = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000); // cap at 15s
  };

  const connect = async () => {
    if (closed) return;

    // Mint a fresh, short-lived connect ticket. The API Gateway WS authorizer
    // requires it (?token=); an anonymous socket is rejected at the handshake.
    let token: string;
    try {
      const res = await fetch("/api/realtime/ticket", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) {
        // Not signed in — there's nothing to retry to. Give up quietly.
        console.warn("realtime: not authenticated — live updates disabled");
        return;
      }
      if (!res.ok) throw new Error(`ticket ${res.status}`);
      token = (await res.json()).token;
    } catch {
      scheduleRetry(); // transient (offline, server hiccup) — back off and retry
      return;
    }
    if (closed) return;

    const url =
      `${WS_URL}?channels=${encodeURIComponent(channels.join(","))}` +
      `&token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      backoff = 1000; // reset after a healthy connect
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.type === "waypoint" && msg.waypoint) onWaypoint(msg.waypoint as RawWaypoint);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      scheduleRetry();
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
