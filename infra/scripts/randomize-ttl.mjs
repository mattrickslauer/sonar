// One-off: randomize how much life each existing waypoint has left, so the
// countdown rings show a natural spread (some fresh, some near-destruction).
//
// IMPORTANT: the ring fraction the UI draws is `remaining / lifespan`, where
// lifespan = ttl - createdAt. So we must move createdAt and ttl *together* —
// randomizing ttl alone decouples them and the rings stop correlating with the
// real time-to-expiry. Here every waypoint is given the same total LIFESPAN
// (default 24h) and a random remaining time within it; createdAt is back-dated
// to keep lifespan constant. Result: ring fill maps directly to time left
// (half-full ⇒ ~12h left).
//
//   node infra/scripts/randomize-ttl.mjs [--min 120] [--lifespan 86400] [--dry-run]
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.SONAR_TABLE || "sonar";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
};
const LIFESPAN = Number(arg("lifespan", 86400)); // total life (s); fixed per item
const MIN = Number(arg("min", 120)); // floor on remaining time (s) — still alive
const DRY = process.argv.includes("--dry-run");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

async function main() {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  let scanned = 0;
  let updated = 0;
  const samples = [];
  let ExclusiveStartKey;

  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey,
      FilterExpression: "begins_with(SK, :wp)", // only waypoints carry a ring
      ExpressionAttributeValues: { ":wp": "WP#" },
    }));
    for (const it of res.Items || []) {
      scanned++;
      const remaining = randInt(MIN, LIFESPAN); // seconds left
      const elapsed = LIFESPAN - remaining; // seconds since (back-dated) birth
      const ttl = nowSec + remaining;
      const createdAt = now - elapsed * 1000; // keep lifespan == LIFESPAN

      if (samples.length < 8) {
        samples.push(Math.round((remaining / LIFESPAN) * 100));
      }
      if (!DRY) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: it.PK, SK: it.SK },
          UpdateExpression: "SET #t = :ttl, createdAt = :c",
          ExpressionAttributeNames: { "#t": "ttl" },
          ExpressionAttributeValues: { ":ttl": ttl, ":c": createdAt },
          ConditionExpression: "attribute_exists(PK)",
        }));
      }
      updated++;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(`${DRY ? "[dry-run] " : ""}waypoints scanned: ${scanned}, randomized: ${updated}`);
  console.log(`lifespan: ${Math.round(LIFESPAN / 3600)}h, remaining floor: ${Math.round(MIN / 60)}m`);
  console.log("sample ring fill (%):", samples.sort((a, b) => a - b).join(", "));
}

main().catch((e) => {
  console.error("randomize-ttl failed:", e);
  process.exit(1);
});
