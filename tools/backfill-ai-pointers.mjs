// One-off helper: lets topics whose AI check was saved BEFORE the pointer fix open with checked
// papers and experts in any browser. New checks write their own pointer, so run this once after deploying.
//
//   node tools/backfill-ai-pointers.mjs           (dry run: lists what would be written)
//   node tools/backfill-ai-pointers.mjs --apply   (writes the pointers)
//
// Run it from the project folder after `npx wrangler login`. It only reads checked results and adds
// small pointer keys with the remaining lifetime of each result. It never prints stored values.
import { spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const AI_TTL = 7 * 24 * 60 * 60;
const base = ["wrangler", "kv", "key"];
const target = ["--binding", "TMM", "--config", "worker/wrangler.toml", "--remote"];

function wrangler(args) {
  const run = spawnSync("npx", [...base, ...args, ...target], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error("wrangler " + args[0] + " failed: " + (run.stderr || "").split("\n").filter(Boolean).slice(-3).join(" "));
  return run.stdout;
}

const listed = wrangler(["list", "--prefix", "ai:search:v3:"]);
const names = JSON.parse(listed.slice(listed.indexOf("["), listed.lastIndexOf("]") + 1)).map((item) => item.name).filter((name) => /^ai:search:v3:[a-f0-9]{64}$/.test(name));
console.log("Checked results found: " + names.length);

const newest = new Map();
for (const name of names) {
  let record;
  try { record = JSON.parse(wrangler(["get", name, "--text"])); } catch { console.log("Skipped one unreadable record."); continue; }
  if (record?.evidenceVersion !== 3 || typeof record.queryId !== "string" || !Number.isFinite(record.savedAt)) continue;
  const remaining = Math.floor(AI_TTL - (Date.now() - record.savedAt) / 1000);
  if (remaining < 3600) continue; // Expired or about to expire: the worker would ignore it anyway.
  const current = newest.get(record.queryId);
  if (!current || record.savedAt > current.savedAt) newest.set(record.queryId, { name, savedAt: record.savedAt, remaining });
}

console.log("Searches that can get a pointer: " + newest.size);
for (const [queryId, { name, remaining }] of newest) {
  console.log((apply ? "Writing " : "Would write ") + "pointer for: " + queryId);
  if (apply) wrangler(["put", "ai:q:v1:" + queryId, name, "--ttl", String(Math.max(60, remaining))]);
}
if (!apply && newest.size) console.log("Dry run only. Add --apply to write these pointers.");
