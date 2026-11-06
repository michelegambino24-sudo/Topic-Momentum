// One-off helper: lets topics whose AI check was saved BEFORE the pointer fix open with checked
// papers and experts in any browser. New checks write their own pointer, so run this once after deploying.
//
//   node tools/backfill-ai-pointers.mjs           (dry run: lists what would be written)
//   node tools/backfill-ai-pointers.mjs --apply   (writes the pointers)
//
// Run it from the project folder after `npx wrangler login`. It only reads checked results and adds
// small pointer keys with the remaining lifetime of each result. It never prints stored values.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { queryPointerKey } from "../worker/ai.js";

const apply = process.argv.includes("--apply");
const AI_TTL = 7 * 24 * 60 * 60;
const base = ["kv", "key"];
const target = ["--binding", "TMM", "--config", "worker/wrangler.toml", "--remote"];

// Topic names contain spaces, quotes and | characters, so wrangler is started directly with node (no shell).
function findWranglerEntry() {
  const local = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(local)) return local;
  const probe = spawnSync("npx", ["--yes", "--package=wrangler", "--", "node", "-p", "process.env.PATH"], { encoding: "utf8", shell: process.platform === "win32", timeout: 180000 });
  for (const dir of String(probe.stdout || "").trim().split(delimiter)) {
    const entry = join(dir, "..", "wrangler", "bin", "wrangler.js");
    if (existsSync(entry)) return entry;
  }
  throw new Error("Could not find wrangler. Run: npm install --no-save wrangler");
}
const wranglerEntry = findWranglerEntry();

function wrangler(args) {
  const run = spawnSync(process.execPath, [wranglerEntry, ...base, ...args, ...target], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  if (run.status !== 0) throw new Error("wrangler " + args[0] + " failed: " + (run.stderr || "").split("\n").filter(Boolean).slice(-10).join(" / "));
  return run.stdout;
}

const listed = wrangler(["list", "--prefix", "ai:search:v3:"]);
const names = JSON.parse(listed.slice(listed.indexOf("["), listed.lastIndexOf("]") + 1)).map((item) => item.name).filter((name) => /^ai:search:v3:[a-f0-9]{64}$/.test(name));
console.log("Checked results found: " + names.length);

const newest = new Map();
let done = 0;
for (const name of names) {
  console.log("Reading " + (++done) + " of " + names.length + "...");
  let record;
  try { record = JSON.parse(wrangler(["get", name, "--text"])); } catch { console.log("Skipped one unreadable record."); continue; }
  if (record?.evidenceVersion !== 3 || typeof record.queryId !== "string" || !Number.isFinite(record.savedAt)) continue;
  const remaining = Math.floor(AI_TTL - (Date.now() - record.savedAt) / 1000);
  if (remaining < 3600) continue; // Expired or about to expire: the worker would ignore it anyway.
  const current = newest.get(record.queryId);
  if (!current || record.savedAt > current.savedAt) newest.set(record.queryId, { name, savedAt: record.savedAt, remaining });
}

console.log("Searches that can get a pointer: " + newest.size);
let written = 0;
const failed = [];
for (const [queryId, { name, remaining }] of newest) {
  console.log((apply ? "Writing " : "Would write ") + "pointer for: " + queryId.slice(0, 80) + (queryId.length > 80 ? "..." : "") + " (key length " + (queryPointerKey(queryId)).length + ")");
  if (!apply) continue;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { wrangler(["put", queryPointerKey(queryId), name, "--ttl", String(Math.max(60, remaining))]); written++; lastError = null; break; } catch (error) { lastError = error; }
  }
  if (lastError) { failed.push(queryId); console.log("  FAILED: " + lastError.message); }
}
if (apply) console.log("Pointers written: " + written + ". Failed: " + failed.length + ".");
if (!apply && newest.size) console.log("Dry run only. Add --apply to write these pointers.");
