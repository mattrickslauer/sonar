import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  createWsTicket,
  verifySessionToken,
} from "../session";

const account = { id: "acct_123", displayName: "Ann" };

// Read JWT claims without verifying — used only to assert the audience split.
function decodePayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("session token", () => {
  it("round-trips: a freshly signed token verifies back to its claims", async () => {
    const token = await createSessionToken(account);
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ sub: "acct_123", name: "Ann" });
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await createSessionToken(account);
    const [h, p] = token.split(".");
    const forged = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAA`;
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("rejects obvious garbage", async () => {
    expect(await verifySessionToken("not.a.jwt")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });
});

describe("WebSocket ticket vs session audience separation", () => {
  it("signs the session and the WS ticket for different audiences", async () => {
    const session = await createSessionToken(account);
    const ticket = await createWsTicket(account);
    expect(decodePayload(session).aud).toBe("sonar-web");
    expect(decodePayload(ticket).aud).toBe("sonar-ws");
    // Same subject, so the authorizer can attribute the connection.
    expect(decodePayload(ticket).sub).toBe("acct_123");
  });

  it("a WS ticket cannot be replayed as a session (audience mismatch)", async () => {
    const ticket = await createWsTicket(account);
    expect(await verifySessionToken(ticket)).toBeNull();
  });

  it("mints a short-lived ticket (<= 5 min ttl)", async () => {
    const ticket = await createWsTicket(account);
    const { iat, exp } = decodePayload(ticket) as { iat: number; exp: number };
    expect(exp - iat).toBeLessThanOrEqual(300);
    expect(exp - iat).toBeGreaterThan(0);
  });
});
