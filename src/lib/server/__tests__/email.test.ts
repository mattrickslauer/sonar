import { describe, it, expect, vi, afterEach } from "vitest";
import { resend, ResendError } from "../resend";
import { sendOtpEmail, emailConfigured } from "../email";

type Step = [status: number, json: unknown, retryAfter?: number];

// Replies in turn from `script`. Records every request and every wait.
function scripted(script: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const waits: number[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const [status, json, retryAfter] = script[Math.min(calls.length, script.length - 1)];
    calls.push({ url, init });
    const headers = new Headers(retryAfter == null ? {} : { "retry-after": String(retryAfter) });
    return { ok: status >= 200 && status < 300, status, headers, json: async () => json };
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { calls, waits, fetch: f, client: resend("re_key", f, { sleep }) };
}

const email = { idempotencyKey: "otp_1", from: "a@b.dev", to: "ana@example.com", subject: "s", text: "t" };

describe("resend client", () => {
  it("posts JSON with a bearer key, idempotency key in the header only", async () => {
    const { calls, client } = scripted([[200, { id: "em_1" }]]);
    expect(await client.send(email)).toEqual({ id: "em_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer re_key");
    expect(h["idempotency-key"]).toBe("otp_1");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      from: "a@b.dev",
      to: "ana@example.com",
      subject: "s",
      text: "t",
    });
  });

  it("retries 429 with the same body, capping retry-after at 2 s", async () => {
    const { calls, waits, client } = scripted([[429, {}, 30], [200, { id: "em_2" }]]);
    await client.send(email);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.body).toBe(calls[0].init.body);
    expect(waits).toEqual([2000]);
  });

  it("gives up after two retries with a ResendError", async () => {
    const { calls, client } = scripted([[429, { message: "rate limited" }]]);
    await expect(client.send(email)).rejects.toMatchObject({ status: 429, message: "rate limited" });
    expect(calls).toHaveLength(3);
  });

  it("does not retry other errors", async () => {
    const { calls, client } = scripted([[422, { message: "bad address" }]]);
    await expect(client.send(email)).rejects.toBeInstanceOf(ResendError);
    expect(calls).toHaveLength(1);
  });
});

describe("sendOtpEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs instead of sending when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { calls, fetch } = scripted([[200, {}]]);
    await sendOtpEmail("ana@example.com", "123456", fetch);
    expect(emailConfigured()).toBe(false);
    expect(calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("sends the code from SONAR_MAIL_FROM (default sonar@agfarms.dev)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { calls, fetch } = scripted([[200, { id: "em_3" }]]);
    await sendOtpEmail("ana@example.com", "123456", fetch);
    expect(emailConfigured()).toBe(true);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.from).toBe("Sonar <sonar@agfarms.dev>");
    expect(body.to).toBe("ana@example.com");
    expect(body.subject).toBe("Your Sonar sign-in code: 123456");
    expect(body.text).toContain("123456");

    vi.stubEnv("SONAR_MAIL_FROM", "Sonar <sonar@mattrickslauer.com>");
    await sendOtpEmail("ana@example.com", "123456", fetch);
    expect(JSON.parse(calls[1].init.body as string).from).toBe("Sonar <sonar@mattrickslauer.com>");
  });

  it("throws when Resend rejects, so the route returns 502", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { fetch } = scripted([[403, { message: "domain not verified" }]]);
    await expect(sendOtpEmail("ana@example.com", "123456", fetch)).rejects.toBeInstanceOf(ResendError);
  });
});
