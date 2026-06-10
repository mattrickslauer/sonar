#!/usr/bin/env node
// Create a waypoint ("drop") in the sonar table via the AWS CLI.
//
//   node infra/scripts/drop.mjs --channel food --author deon \
//     --text "birria truck by gate C — line is short rn" --lat 25.7617 --lng -80.1918
//
// Flags: --channel --author --text --kind --lat --lng --love --actorType
//        --table (default sonar) --region (default us-east-1) --dry-run
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWaypoint } from "./waypoint.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Defaults: Miami (the app's default center), food channel.
const channel = args.channel ?? "food";
const author = args.author ?? "deon";
const text = args.text ?? "birria truck by gate C — line is short rn";
const kind = args.kind ?? "text";
const lat = Number(args.lat ?? 25.7617);
const lng = Number(args.lng ?? -80.1918);
const love = Number(args.love ?? 0);
const actorType = args.actorType ?? "human";
const table = args.table ?? "sonar";
const region = args.region ?? "us-east-1";

const VALID_CHANNELS = ["events", "food", "music", "social", "safety"];
if (!VALID_CHANNELS.includes(channel)) {
  console.error(`channel must be one of: ${VALID_CHANNELS.join(", ")}`);
  process.exit(1);
}
if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error("lat/lng must be numbers");
  process.exit(1);
}

const { plain, item, key, gh6, id } = buildWaypoint({
  channel, text, author, kind, lat, lng, actorType, love, realLove: love,
});

console.log("Waypoint:");
console.log(JSON.stringify(plain, null, 2));
console.log(`\nPK = ${key.PK}\nSK = ${key.SK}\ngh6 = ${gh6}`);

if (args["dry-run"]) {
  console.log("\n[dry-run] not writing.");
  process.exit(0);
}

const file = join(tmpdir(), `wp-${id}.json`);
writeFileSync(file, JSON.stringify(item));
try {
  execFileSync("aws", [
    "dynamodb", "put-item",
    "--table-name", table,
    "--region", region,
    "--item", `file://${file}`,
    "--condition-expression", "attribute_not_exists(PK)",
    "--output", "json",
  ], { stdio: ["ignore", "inherit", "inherit"] });
  console.log(`\n✓ dropped into ${table} (${region})`);
} catch (e) {
  console.error("\n✗ put-item failed");
  process.exit(1);
}
