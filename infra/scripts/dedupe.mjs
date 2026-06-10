#!/usr/bin/env node
// Remove duplicate waypoints from the sonar table. Two items are duplicates
// when they share (PK, author, text) — i.e. the same drop written twice. Keeps
// the earliest (lexicographically smallest SK / ULID) and deletes the rest.
//
//   node infra/scripts/dedupe.mjs            # delete duplicates
//   node infra/scripts/dedupe.mjs --dry-run  # just report
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (const a of argv) if (a.startsWith("--")) out[a.slice(2)] = true;
  return out;
}
const args = parseArgs(process.argv.slice(2));
const table = "sonar";
const region = "us-east-1";

function awsJson(a) {
  return JSON.parse(execFileSync("aws", [...a, "--output", "json"], { encoding: "utf8" }) || "{}");
}

// Scan all items (paginated).
let items = [], startKey = null;
do {
  const a = ["dynamodb", "scan", "--table-name", table, "--region", region];
  if (startKey) a.push("--exclusive-start-key", JSON.stringify(startKey));
  const res = awsJson(a);
  items.push(...(res.Items || []));
  startKey = res.LastEvaluatedKey || null;
} while (startKey);

// Group waypoints by logical identity; collect the extras to delete.
const groups = new Map();
for (const it of items) {
  const sk = it.SK?.S || "";
  if (!sk.startsWith("WP#")) continue;
  const key = `${it.PK.S}|${it.author?.S ?? ""}|${it.text?.S ?? ""}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push(it);
}

const toDelete = [];
for (const copies of groups.values()) {
  if (copies.length <= 1) continue;
  copies.sort((a, b) => (a.SK.S < b.SK.S ? -1 : 1)); // keep earliest
  toDelete.push(...copies.slice(1));
}

console.log(`scanned ${items.length} items · ${groups.size} unique waypoints · ${toDelete.length} duplicates to remove`);
if (args["dry-run"]) { console.log("[dry-run] not deleting."); process.exit(0); }
if (toDelete.length === 0) { console.log("nothing to do."); process.exit(0); }

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
let removed = 0;
for (const batch of chunk(toDelete, 25)) {
  const reqs = batch.map((it) => ({ DeleteRequest: { Key: { PK: it.PK, SK: it.SK } } }));
  const file = join(tmpdir(), `dedupe-${removed}.json`);
  writeFileSync(file, JSON.stringify({ [table]: reqs }));
  awsJson(["dynamodb", "batch-write-item", "--request-items", `file://${file}`, "--region", region]);
  removed += reqs.length;
}
console.log(`✓ removed ${removed} duplicate waypoints`);
