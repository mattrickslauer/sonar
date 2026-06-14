import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
// CJS Lambda — import the module's default (module.exports) and read .handler.
import authorizer from "../../../infra/lambda/ws-authorizer/index.js";

const { handler } = authorizer;

// Must match vitest.config.ts test.env.SONAR_SESSION_SECRET (the authorizer
// reads it at module load).
const SECRET = "test-secret-at-least-32-chars-long-xx";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function mint(payload, { alg = "HS256", secret = SECRET } = {}) {
  const h = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

function validTicket(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return mint({
    sub: "acct_1",
    name: "Ann",
    iss: "sonar",
    aud: "sonar-ws",
    iat: now,
    exp: now + 60,
    ...overrides,
  });
}

const evt = (token) => ({
  methodArn: "arn:aws:execute-api:us-east-1:123:abc/live/$connect",
  queryStringParameters: token === undefined ? {} : { token },
});

describe("ws-authorizer", () => {
  it("allows a valid ticket and surfaces the identity as context", async () => {
    const res = await handler(evt(validTicket()));
    expect(res.principalId).toBe("acct_1");
    expect(res.policyDocument.Statement[0].Effect).toBe("Allow");
    expect(res.policyDocument.Statement[0].Resource).toBe(evt().methodArn);
    expect(res.context).toEqual({ sub: "acct_1", name: "Ann" });
  });

  it("denies an expired ticket", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(handler(evt(validTicket({ exp: now - 1 })))).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("denies a session-audience token replayed as a WS ticket", async () => {
    await expect(
      handler(evt(validTicket({ aud: "sonar-web" }))),
    ).rejects.toThrow("Unauthorized");
  });

  it("denies a wrong issuer", async () => {
    await expect(handler(evt(validTicket({ iss: "evil" })))).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("denies a tampered signature", async () => {
    const [h, p] = validTicket().split(".");
    await expect(handler(evt(`${h}.${p}.AAAAAAAA`))).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("denies a ticket signed with the wrong secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = mint(
      { sub: "acct_1", iss: "sonar", aud: "sonar-ws", iat: now, exp: now + 60 },
      { secret: "another-secret-32-chars-xxxxxxxxxxxx" },
    );
    await expect(handler(evt(forged))).rejects.toThrow("Unauthorized");
  });

  it("denies an alg=none forgery", async () => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const p = b64url(
      JSON.stringify({ sub: "x", iss: "sonar", aud: "sonar-ws", exp: now + 60 }),
    );
    await expect(handler(evt(`${h}.${p}.`))).rejects.toThrow("Unauthorized");
  });

  it("denies a missing token", async () => {
    await expect(handler(evt())).rejects.toThrow("Unauthorized");
    await expect(handler(evt("garbage"))).rejects.toThrow("Unauthorized");
  });
});
