"use strict";

/**
 * WebSocket $connect authorizer (REQUEST type).
 *
 * Closes the open-socket hole: without this, anyone could open the live feed
 * and receive every waypoint (lat/lng/author/text) and inflate metered billing.
 *
 * The browser fetches a short-lived ticket from /api/realtime/ticket (which
 * requires the httpOnly session cookie) and passes it as `?token=`. We verify
 * that ticket here with the SAME SONAR_SESSION_SECRET the Next server signs it
 * with — issuer "sonar", audience "sonar-ws", unexpired, HS256.
 *
 * Verification is hand-rolled on Node's built-in `crypto` (HMAC-SHA256) so this
 * Lambda needs no bundled deps / layer. HS256 verification is small and the
 * checks below mirror what `jose` enforces in src/lib/server/session.ts.
 */
const crypto = require("crypto");

const SECRET = process.env.SONAR_SESSION_SECRET || "";
const ISSUER = "sonar";
const WS_AUDIENCE = "sonar-ws";

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verify an HS256 JWT and return its claims, or null if anything is off. */
function verify(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header;
  try {
    header = JSON.parse(b64urlDecode(h).toString("utf8"));
  } catch {
    return null;
  }
  // Pin the algorithm — reject "none" and alg-confusion attempts.
  if (!header || header.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest();
  const got = b64urlDecode(sig);
  if (expected.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expected, got)) return null;

  let claims;
  try {
    claims = JSON.parse(b64urlDecode(p).toString("utf8"));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now) return null;
  if (claims.iss !== ISSUER) return null;
  // jose serializes a single audience as a string (array for multiple).
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(WS_AUDIENCE)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;

  return claims;
}

function allow(principalId, methodArn, context) {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: "Allow",
          Resource: methodArn,
        },
      ],
    },
    context,
  };
}

exports.handler = async (event) => {
  if (!SECRET || SECRET.length < 32) {
    // Misconfiguration — fail closed rather than admit everyone.
    console.error("ws-authorizer: SONAR_SESSION_SECRET missing/too short");
    throw new Error("Unauthorized");
  }

  const token = event.queryStringParameters?.token;
  const claims = verify(token, SECRET);
  if (!claims) {
    // Throwing "Unauthorized" makes API Gateway return 401 to the handshake.
    throw new Error("Unauthorized");
  }

  // Pass identity downstream so $connect can scope the connection to the user.
  return allow(claims.sub, event.methodArn, {
    sub: claims.sub,
    name: typeof claims.name === "string" ? claims.name : "",
  });
};
