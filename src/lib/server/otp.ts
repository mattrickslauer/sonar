// Server-only: email one-time-passcodes, stored as short-TTL items in the same
// ephemeral DynamoDB table the waypoints use — the auth code expiring is the
// very same TTL primitive as a drop expiring.
//
// SECURITY:
//   - Only a salted HASH of the code is stored, never the plaintext (a table
//     leak can't reveal live codes). HMAC-SHA256 peppered with the session
//     secret; compared in constant time.
//   - Codes are 6 random digits from crypto.randomInt, expire in 10 min, and
//     allow a small fixed number of guesses (atomic decrement) before the
//     challenge is burned — defeating brute force.
//   - Resends are throttled to one per RESEND_COOLDOWN, capped per window.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE } from "@/lib/server/dynamo";

const TTL_SECONDS = 10 * 60; // codes live 10 minutes
const MAX_ATTEMPTS = 5; // guesses before the code is burned
const RESEND_COOLDOWN_MS = 30 * 1000; // min gap between sends to one email
const MAX_SENDS = 5; // sends per code lifetime

const pepper = process.env.SONAR_SESSION_SECRET ?? "";

// Exported for unit tests (the crypto contract is security-critical). Not part
// of the route-facing API.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashCode(email: string, code: string): string {
  // Bind the hash to the email so a code is only valid for its address.
  return createHmac("sha256", pepper).update(`${email}:${code}`).digest("hex");
}

function pk(email: string): string {
  return `OTP#${email}`;
}

export type StartResult =
  | { ok: true; code: string }
  | { ok: false; reason: "throttled" };

/**
 * Begin an OTP challenge: generate a code, store its hash with a TTL, and
 * return the plaintext code to the caller (which emails it — the code never
 * goes to the client in a response body).
 */
export async function startOtp(emailRaw: string): Promise<StartResult> {
  const email = normalizeEmail(emailRaw);
  const now = Date.now();

  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: pk(email), SK: "OTP" } }),
  );
  const cur = existing.Item;
  if (cur) {
    if (now - Number(cur.sentAt ?? 0) < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: "throttled" };
    }
    if (Number(cur.sendCount ?? 0) >= MAX_SENDS) {
      return { ok: false, reason: "throttled" };
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk(email),
        SK: "OTP",
        codeHash: hashCode(email, code),
        attemptsLeft: MAX_ATTEMPTS,
        sentAt: now,
        sendCount: Number(cur?.sendCount ?? 0) + 1,
        ttl: Math.floor(now / 1000) + TTL_SECONDS,
      },
    }),
  );
  return { ok: true, code };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "no_attempts" | "mismatch" };

/** Verify a submitted code. Burns the challenge on success or exhaustion. */
export async function verifyOtp(
  emailRaw: string,
  codeRaw: string,
): Promise<VerifyResult> {
  const email = normalizeEmail(emailRaw);
  const code = String(codeRaw).trim();

  // Atomically claim one attempt, so concurrent guesses can't exceed the cap.
  let attemptsLeft: number;
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(email), SK: "OTP" },
        UpdateExpression: "ADD attemptsLeft :neg",
        ConditionExpression: "attribute_exists(PK) AND attemptsLeft > :zero",
        ExpressionAttributeValues: { ":neg": -1, ":zero": 0 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    attemptsLeft = Number(res.Attributes?.attemptsLeft ?? 0);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // No live challenge (never sent / expired-and-gone) or attempts exhausted.
      return { ok: false, reason: "no_attempts" };
    }
    throw err;
  }

  const item = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: pk(email), SK: "OTP" } }),
  );
  const cur = item.Item;
  // Expired between the decrement and read (TTL deletes are not instant; also
  // check the stored expiry ourselves).
  if (!cur || Number(cur.ttl ?? 0) * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const expected = Buffer.from(String(cur.codeHash ?? ""), "utf8");
  const got = Buffer.from(hashCode(email, code), "utf8");
  const matches =
    expected.length === got.length && timingSafeEqual(expected, got);

  if (!matches) {
    return { ok: false, reason: attemptsLeft > 0 ? "mismatch" : "no_attempts" };
  }

  // Success → burn the challenge so the code can't be reused.
  await ddb
    .send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(email), SK: "OTP" } }))
    .catch(() => {});
  return { ok: true };
}
