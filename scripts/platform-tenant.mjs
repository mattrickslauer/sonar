#!/usr/bin/env node
// Sonar Platform admin: tenants and their API keys (docs/platform/api.md).
//
//   node scripts/platform-tenant.mjs create <id> "<name>" [origin …]   new tenant + first key
//   node scripts/platform-tenant.mjs key <id>                          another key (rotation)
//   node scripts/platform-tenant.mjs keys <id>                         list key labels
//   node scripts/platform-tenant.mjs revoke <id> <sk_live_xxxx>        revoke by label
//   node scripts/platform-tenant.mjs suspend|activate <id>
//   node scripts/platform-tenant.mjs list
//
// Uses the default AWS credential chain (or SONAR_AWS_*), region SONAR_REGION
// (default us-east-1) and table SONAR_TABLE (default sonar). A key is printed
// once; only its SHA-256 is stored. Key format and hashing must match
// src/lib/server/platform/core.ts.
import { createHash, randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.SONAR_TABLE ?? "sonar";
const REGION = process.env.SONAR_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const { SONAR_AWS_ACCESS_KEY_ID: accessKeyId, SONAR_AWS_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION, ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const TENANT_ID_RE = /^[a-z][a-z0-9]{1,23}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newKey() {
  const b = randomBytes(32);
  let body = "";
  for (let i = 0; i < 32; i++) body += ALPHABET[b[i] % ALPHABET.length];
  return `sk_live_${body}`;
}

async function mintKey(tenant) {
  const key = newKey();
  const label = key.slice(0, 12);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `APIKEY#${createHash("sha256").update(key).digest("hex")}`,
      SK: "APIKEY",
      GSI1PK: `TENANT#${tenant}`,
      GSI1SK: `KEY#${label}`,
      tenant,
      label,
      createdAt: Date.now(),
    },
    ConditionExpression: "attribute_not_exists(PK)",
  }));
  console.log(`key ${label}… for ${tenant} (shown once, store it in the tenant's secrets):\n\n  ${key}\n`);
}

async function mustTenant(id) {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `TENANT#${id}`, SK: "TENANT" } }));
  if (!res.Item) throw new Error(`no tenant ${id}`);
  return res.Item;
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case "create": {
      const [id, name, ...origins] = args;
      if (!id || !TENANT_ID_RE.test(id)) throw new Error("id: 2–24 chars, a-z then a-z0-9");
      if (!name) throw new Error('usage: create <id> "<name>" [origin …]');
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: `TENANT#${id}`, SK: "TENANT", id, name, status: "active", origins, ratePerMinute: 600, createdAt: Date.now() },
        ConditionExpression: "attribute_not_exists(PK)",
      }));
      console.log(`tenant ${id} (${name}) created`);
      await mintKey(id);
      break;
    }
    case "key":
      await mustTenant(args[0]);
      await mintKey(args[0]);
      break;
    case "keys": {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE, IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :t AND begins_with(GSI1SK, :k)",
        ExpressionAttributeValues: { ":t": `TENANT#${args[0]}`, ":k": "KEY#" },
      }));
      for (const it of res.Items ?? []) {
        console.log(`${it.label}…  made ${new Date(it.createdAt).toISOString()}${it.revokedAt ? `  REVOKED ${new Date(it.revokedAt).toISOString()}` : ""}`);
      }
      break;
    }
    case "revoke": {
      const [id, label] = args;
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE, IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :t AND GSI1SK = :k",
        ExpressionAttributeValues: { ":t": `TENANT#${id}`, ":k": `KEY#${(label ?? "").slice(0, 12)}` },
      }));
      for (const it of res.Items ?? []) {
        await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { PK: it.PK, SK: it.SK }, UpdateExpression: "SET revokedAt = :n", ExpressionAttributeValues: { ":n": Date.now() } }));
      }
      console.log(`revoked ${res.Items?.length ?? 0} key(s)`);
      break;
    }
    case "suspend":
    case "activate":
      await mustTenant(args[0]);
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { PK: `TENANT#${args[0]}`, SK: "TENANT" },
        UpdateExpression: "SET #s = :s", ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": cmd === "suspend" ? "suspended" : "active" },
      }));
      console.log(`${args[0]} ${cmd === "suspend" ? "suspended" : "active"}`);
      break;
    case "list": {
      let start;
      do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, FilterExpression: "SK = :s", ExpressionAttributeValues: { ":s": "TENANT" }, ExclusiveStartKey: start }));
        for (const t of res.Items ?? []) console.log(`${t.id}\t${t.status}\t${t.name}\t${(t.origins ?? []).join(" ")}`);
        start = res.LastEvaluatedKey;
      } while (start);
      break;
    }
    default:
      console.log("commands: create, key, keys, revoke, suspend, activate, list (see the top of this file)");
  }
} catch (err) {
  console.error(err.message ?? err);
  process.exit(1);
}
