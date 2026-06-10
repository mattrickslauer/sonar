#!/usr/bin/env node
// Seed a cluster of waypoints around a center point and BatchWriteItem them
// into the sonar table. Themed for Punta Arenas, Chile by default.
//
//   node infra/scripts/seed.mjs --lat -53.1638 --lng -70.9171 --count 22
//
// Flags: --lat --lng --count --seed --actorType (default bot) --table --region --dry-run
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWaypoint, offset, mulberry32 } from "./waypoint.mjs";

// Patagonia-flavored template pool (mirrors the static-pool model for bots).
const POOL = [
  { channel: "food",   kind: "photo", author: "valentina", text: "centolla (king crab) special at the wharf tonight 🦀" },
  { channel: "food",   kind: "text",  author: "mateo",     text: "completo italiano cart by Plaza Muñoz Gamero, still hot" },
  { channel: "food",   kind: "photo", author: "cata",      text: "cordero al palo at the parrilla on O'Higgins, smells unreal" },
  { channel: "food",   kind: "text",  author: "benja",     text: "sopaipillas + hot chocolate, esquina Bories, perfect for this wind" },
  { channel: "music",  kind: "voice", author: "fer",       text: "folk set on Roca — accordion + guitar, super cozy" },
  { channel: "music",  kind: "video", author: "nico",      text: "live cumbia near the Costanera, place is packed 🎶" },
  { channel: "music",  kind: "text",  author: "javi",      text: "street musician at Plaza de Armas absolutely killing it" },
  { channel: "social", kind: "text",  author: "ignacia",   text: "anyone going to the penguin colony tmrw? splitting a van" },
  { channel: "social", kind: "photo", author: "tomas",     text: "sunset over the Strait of Magellan from the mirador 🌅" },
  { channel: "social", kind: "text",  author: "sofia",     text: "wind's brutal today, grab a mate and hunker down" },
  { channel: "social", kind: "voice", author: "lukas",     text: "lost a blue beanie near the cathedral, lmk if found" },
  { channel: "social", kind: "text",  author: "anto",      text: "mate circle at the plaza in 20 if anyone's around" },
  { channel: "events", kind: "text",  author: "cultura",   text: "Patagonia film night at the cultural center, 8pm" },
  { channel: "events", kind: "photo", author: "rosa",      text: "artisan market open at the plaza all weekend" },
  { channel: "events", kind: "text",  author: "puerto",    text: "ferry to Tierra del Fuego — boarding info posted at the pier" },
  { channel: "events", kind: "video", author: "glaciar",   text: "glacier boat tour moved to morning, water's calmer then" },
  { channel: "safety", kind: "text",  author: "ops",       text: "strong wind advisory along the Costanera — hold the railings" },
  { channel: "safety", kind: "text",  author: "ops",       text: "icy patches on downtown sidewalks this morning, watch your step" },
  { channel: "safety", kind: "text",  author: "capitania", text: "harbor closed to small craft, swells too high today" },
  { channel: "safety", kind: "text",  author: "ops",       text: "road to the airport foggy, drive slow" },
  { channel: "food",   kind: "text",  author: "lena",      text: "empanadas de mariscos near the pier, fresh batch just out" },
  { channel: "music",  kind: "text",  author: "kai",       text: "acoustic night at the brewery on Bories, chill crowd" },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const lat0 = Number(args.lat ?? -53.1638);   // Punta Arenas
const lng0 = Number(args.lng ?? -70.9171);
const count = Number(args.count ?? POOL.length);
const seed = Number(args.seed ?? 4242);
const actorType = args.actorType ?? "bot";
const table = args.table ?? "sonar";
const region = args.region ?? "us-east-1";

const rand = mulberry32(seed);
const baseNow = Date.now();

const built = [];
for (let i = 0; i < count; i++) {
  const s = POOL[i % POOL.length];
  const meters = 40 + rand() * 1100;
  const bearing = rand() * 360;
  const pos = offset({ lat: lat0, lng: lng0 }, meters, bearing);
  const minutesAgo = Math.floor(rand() * 1440);
  const love = Math.floor(rand() * 60);
  const now = baseNow - minutesAgo * 60000;
  built.push(buildWaypoint({
    channel: s.channel, text: s.text, author: s.author, kind: s.kind,
    lat: pos.lat, lng: pos.lng, actorType,
    love, realLove: actorType === "human" ? love : 0, now,
  }));
}

const cells = [...new Set(built.map((b) => b.gh6))];
const byChannel = built.reduce((m, b) => ((m[b.plain.channel] = (m[b.plain.channel] || 0) + 1), m), {});
console.log(`Seeding ${built.length} drops around ${lat0}, ${lng0} (actorType=${actorType})`);
console.log(`gh6 cells: ${cells.join(", ")}`);
console.log(`channels: ${JSON.stringify(byChannel)}`);

if (args["dry-run"]) {
  console.log("\n[dry-run] not writing. Sample:");
  console.log(JSON.stringify(built.slice(0, 2).map((b) => b.plain), null, 2));
  process.exit(0);
}

function chunk(a, n) {
  const out = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

function awsJson(awsArgs) {
  return JSON.parse(execFileSync("aws", [...awsArgs, "--output", "json"], { encoding: "utf8" }) || "{}");
}

/** Delete every item in the table (scan keys → batch delete). */
function clearTable() {
  let keys = [], startKey = null;
  do {
    const a = ["dynamodb", "scan", "--table-name", table, "--region", region, "--projection-expression", "PK,SK"];
    if (startKey) a.push("--exclusive-start-key", JSON.stringify(startKey));
    const res = awsJson(a);
    keys.push(...(res.Items || []));
    startKey = res.LastEvaluatedKey || null;
  } while (startKey);
  for (const batch of chunk(keys, 25)) {
    const file = join(tmpdir(), `clear-${baseNow}-${batch[0].PK.S}.json`);
    writeFileSync(file, JSON.stringify({ [table]: batch.map((k) => ({ DeleteRequest: { Key: k } })) }));
    awsJson(["dynamodb", "batch-write-item", "--request-items", `file://${file}`, "--region", region]);
  }
  console.log(`cleared ${keys.length} existing items`);
}

if (args.clear) clearTable();

let written = 0;
for (const batch of chunk(built, 25)) {
  let requestItems = { [table]: batch.map((b) => ({ PutRequest: { Item: b.item } })) };
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = join(tmpdir(), `seed-${baseNow}-${attempt}-${written}.json`);
    writeFileSync(file, JSON.stringify(requestItems));
    const out = execFileSync("aws", [
      "dynamodb", "batch-write-item",
      "--request-items", `file://${file}`,
      "--region", region,
      "--output", "json",
    ], { encoding: "utf8" });
    const unprocessed = (JSON.parse(out || "{}").UnprocessedItems || {})[table] || [];
    written += requestItems[table].length - unprocessed.length;
    if (unprocessed.length === 0) break;
    requestItems = { [table]: unprocessed };
    console.log(`  retrying ${unprocessed.length} unprocessed…`);
  }
}
console.log(`\n✓ wrote ${written}/${built.length} drops into ${table} (${region})`);
