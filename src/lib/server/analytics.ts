// Server events to tally (t.mattrickslauer.com), through its vendored SDK
// (src/lib/server/tally, re-copy with infra/vendor-tally.sh).
//
// Users are known to tally by their Sonar account id (a random UUID), the same
// id the page identifies with — never an email or name. With no TALLY_KEY
// (local dev, or the SSM key missing at deploy) this does nothing. Each call
// waits for its send: the web Lambda is frozen once it answers. A failure only
// logs; it never fails the request.
import { Tally } from "./tally/server.js";
import type { Properties } from "../tally/index.js";

let client: Tally | null | undefined;

function analytics(): Tally | null {
  if (client === undefined) {
    const key = process.env.TALLY_KEY;
    client = key
      ? new Tally({
          key,
          flushAt: 100,
          flushInterval: 0,
          timeout: 1500,
          onError: (err) => console.warn("[tally]", err.message),
        })
      : null;
  }
  return client;
}

/** Send one event for an account and wait for it to go out. Never throws. */
export async function track(
  distinctId: string,
  event: string,
  properties?: Properties,
): Promise<void> {
  const t = analytics();
  if (!t) return;
  try {
    t.capture({ distinctId, event, properties });
    await t.flush();
  } catch (err) {
    console.warn("[tally]", err);
  }
}
