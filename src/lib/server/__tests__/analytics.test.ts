import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("server analytics", () => {
  it("does nothing without TALLY_KEY", async () => {
    vi.stubEnv("TALLY_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { track } = await import("../analytics");
    await track("acct-1", "signup", { method: "google" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the event with the site key and waits for it", async () => {
    vi.stubEnv("TALLY_KEY", "sk_sonar_test");
    const f = vi.fn(async () => new Response(JSON.stringify({ accepted: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const { track } = await import("../analytics");
    await track("acct-1", "signup", { method: "email_otp" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://t.mattrickslauer.com/e");
    expect(new Headers(init.headers).get("x-tally-key")).toBe("sk_sonar_test");
    const item = JSON.parse(String(init.body)).batch[0];
    expect(item).toMatchObject({ type: "capture", event: "signup", distinct_id: "acct-1" });
    expect(item.properties).toEqual({ method: "email_otp" });
  });

  it("never throws when tally is unreachable", async () => {
    vi.stubEnv("TALLY_KEY", "sk_sonar_test");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { track } = await import("../analytics");
    await expect(track("acct-1", "purchase", { amount: 5 })).resolves.toBeUndefined();
  }, 20000);
});
