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
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const SECRET = process.env.SONAR_SESSION_SECRET || "";
const ISSUER = "sonar";
const WS_AUDIENCE = "sonar-ws";
const TABLE = process.env.TABLE_NAME;
const REGION = process.env.AWS_REGION || "us-east-1";
// The seeded public channels are never gated. Any other channel id is checked
// against its privacy meta; private ones require a membership row.
const CORE_CHANNELS = new Set(["general", "events", "food", "music", "social", "safety"]);
const VALID_CHANNEL = /^[a-z0-9]{1,16}$/;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

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

/**
 * Membership gate for private channels. Public core channels are always allowed;
 * a non-core channel is private only if it has a CHANNEL#<id>/META item with
 * isPrivate=true (written at creation), in which case the connecting account must
 * have a CH#<id>/MEMBER#<sub> row. Returns false the moment a private channel is
 * requested without membership. (WebSocket authorizers run per $connect with no
 * result caching, so reading the requested channels off the event is safe.)
 */
async function ensureChannelAccess(channels, sub) {
  if (!TABLE) return true; // misconfig → don't lock everyone out of public feed
  for (const ch of channels) {
    if (CORE_CHANNELS.has(ch)) continue;
    const meta = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `CHANNEL#${ch}`, SK: "META" },
    }));
    if (!meta.Item || !meta.Item.isPrivate) continue; // public user-created channel
    const member = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `CH#${ch}`, SK: `MEMBER#${sub}` },
    }));
    if (!member.Item) return false; // private + not a member → deny
  }
  return true;
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

  // Enforce private-channel membership on the requested channels. Deny the whole
  // handshake if any private channel is requested without membership (the client
  // should only request channels it belongs to). Garbage ids are ignored here;
  // ws-connect drops them structurally.
  const rawChannels = event.queryStringParameters?.channels;
  const channels = (rawChannels ? rawChannels.split(",") : [])
    .map((c) => c.trim().toLowerCase())
    .filter((c) => VALID_CHANNEL.test(c));
  if (channels.length > 0) {
    let ok;
    try {
      ok = await ensureChannelAccess(channels, claims.sub);
    } catch (err) {
      // A DynamoDB read failure must not silently admit private channels.
      console.error("ws-authorizer: channel access check failed", err);
      throw new Error("Unauthorized");
    }
    if (!ok) throw new Error("Unauthorized");
  }

  // Pass identity downstream so $connect can scope the connection to the user.
  return allow(claims.sub, event.methodArn, {
    sub: claims.sub,
    name: typeof claims.name === "string" ? claims.name : "",
  });
};
