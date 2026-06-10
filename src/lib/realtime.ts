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

  const connect = () => {
    if (closed) return;
    const url = `${WS_URL}?channels=${encodeURIComponent(channels.join(","))}`;
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
      if (closed) return;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000); // cap at 15s
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
