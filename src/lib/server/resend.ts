// Server-only: minimal Resend HTTP client (POST https://api.resend.com/emails).
//
// On 429 (rate limit) it waits `retry-after` seconds (at most 2 s, 1 s if
// absent) and tries again, up to RETRIES more times, with the same
// Idempotency-Key. `fetchImpl` and `sleep` are injectable for tests.

export class ResendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export interface ResendEmail {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  /** Sent as the Idempotency-Key header, not in the body. */
  idempotencyKey?: string;
}

const RETRIES = 2;
const MAX_WAIT_MS = 2000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number {
  const h = res.headers?.get?.("retry-after");
  const s = h == null || h.trim() === "" ? NaN : Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_WAIT_MS) : 1000;
}

export function resend(
  key: string,
  fetchImpl: typeof fetch = fetch,
  { sleep = wait }: { sleep?: (ms: number) => Promise<void> } = {},
) {
  return {
    async send({ idempotencyKey, ...email }: ResendEmail): Promise<{ id?: string } | null> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      };
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      const body = JSON.stringify(email);
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers,
          body,
        });
        if (res.status === 429 && attempt < RETRIES) {
          await sleep(retryAfterMs(res));
          continue;
        }
        let json: { id?: string; message?: string } | null = null;
        try {
          json = await res.json();
        } catch {
          /* non-JSON body */
        }
        if (!res.ok) {
          throw new ResendError(res.status, json?.message ?? `Resend returned ${res.status}`);
        }
        return json;
      }
    },
  };
}
