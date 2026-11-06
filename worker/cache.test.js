import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorker } from "./worker.js";
import { buildQueries, normaliseQuery, CACHE_MAX_AGE_MS } from "./lib.js";
import { MemoryKV } from "./kv-fixture.js";

const start = Date.parse("2026-10-31T12:00:00Z");
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const req = (name = "lunar moss computing", extra = {}, headers = {}) => new Request("http://localhost:8787/api/topic?" + new URLSearchParams({ q: name, ...extra }), { headers });

function setup(overrides = {}) {
  const kv = new MemoryKV();
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential", ALLOWED_ORIGIN: "https://sample.example", ...overrides };
  const state = { time: start, calls: 0, fail: false };
  const worker = createWorker(async (url) => {
    state.calls++;
    // Every source request must have a counter reservation already persisted.
    const day = new Date(state.time).toISOString().slice(0, 10);
    assert(Number(kv.values.get("count:" + day)) > 0);
    if (state.fail) throw new Error("Fixture source failure");
    const filter = (value) => value.slice(value.indexOf("),") + 2).replace(/^primary_topic.id:T[0-9]+,/, "");
    const descriptor = [...buildQueries(normaliseQuery("fixture"), new Date(state.time).getUTCFullYear()), ...buildQueries(normaliseQuery("fixture"), new Date(state.time).getUTCFullYear(), false)].find(({ params }) =>
      Object.entries(params).every(([key, value]) => key === "filter" ? filter(value) === filter(url.searchParams.get(key)) : value === url.searchParams.get(key)));
    assert(descriptor, "Unrecognised source query");
    return Response.json(fixture(descriptor.id));
  }, () => new Date(state.time));
  return { worker, env, kv, state, search: (request = req()) => worker.fetch(request, env) };
}

test("normalised second search is cached without source requests or KV writes, even without a source key", async () => {
  const app = setup();
  const first = await app.search(req(" Lunar Moss Computing ", { syn: "moon circuits,orbital logic,moon circuits" }));
  const topic = await first.json();
  assert.equal(topic.cached, false);
  assert.equal(app.state.calls, 14);
  assert.equal(app.kv.writes.length, 3);
  assert.deepEqual(app.kv.writes.map((entry) => entry.key), ["count:2026-10-31", "v5:topic:" + topic.id, "library"]);
  assert.equal(app.kv.writes[0].value, "1");
  assert.equal(app.kv.writes[0].options.expirationTtl, 172800);
  assert.deepEqual(app.kv.writes[1].options, { expirationTtl: 60 * 24 * 60 * 60 });
  delete app.env.OPENALEX_KEY;
  const second = await app.search(req("lunar moss computing", { syn: "orbital logic,MOON CIRCUITS" }));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ...topic, cached: true });
  assert.equal(app.state.calls, 14);
  assert.equal(app.kv.writes.length, 3);
});

test("freshness ends at exactly seven days and refreshing keeps existing children", async () => {
  const app = setup();
  const parent = await (await app.search()).json();
  await app.search(req(undefined, { subtopic: "T123", subtopicName: "Orbital logic", parent: parent.id }));
  app.state.time = start + CACHE_MAX_AGE_MS - 1;
  assert.equal((await (await app.search()).json()).cached, true);
  assert.equal(app.state.calls, 28);
  app.state.time++;
  const refreshed = await (await app.search()).json();
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.updated, "2026-11-07");
  assert.equal(app.state.calls, 42);
  const index = await app.kv.get("library", "json");
  assert.deepEqual(index.find((entry) => entry.id === parent.id).children, [parent.id + "|primary_topic:T123"]);
});

test("default cap admits attempt 30, blocks attempt 31, and still serves fresh and expired reports", async () => {
  const app = setup();
  app.kv.values.set("count:2026-10-31", "29");
  const topic = await (await app.search()).json();
  assert.equal(app.kv.values.get("count:2026-10-31"), "30");
  const blocked = await app.search(req("other moss"));
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "daily_limit", message: "Daily limit reached. Try again tomorrow or browse the Library." });
  assert.equal((await (await app.search()).json()).cached, true);
  const old = { ...topic, updated: "2026-10-24" };
  app.kv.values.set("v5:topic:" + topic.id, JSON.stringify({ savedAt: start - CACHE_MAX_AGE_MS, topic: old }));
  // Keep the index in sync with the seeded old report, so the read spends no writes.
  const index = await app.kv.get("library", "json");
  index[0].updated = old.updated;
  app.kv.values.set("library", JSON.stringify(index));
  delete app.env.OPENALEX_KEY;
  const writes = app.kv.writes.length;
  const stale = await app.search();
  assert.equal(stale.status, 200);
  assert.deepEqual(await stale.json(), { ...old, cached: true, stale: true });
  assert.equal(app.kv.writes.length, writes);
  assert.equal(app.state.calls, 14);
  assert.equal((await app.kv.get("v5:topic:" + topic.id, "json")).savedAt, start - CACHE_MAX_AGE_MS);
});

test("failed attempts count, leave no partial report or index, and do not overwrite an expired report", async () => {
  const app = setup({ NEW_TOPICS_PER_DAY: "2" });
  const topic = await (await app.search()).json();
  app.state.time += CACHE_MAX_AGE_MS;
  app.state.fail = true;
  const before = app.kv.values.get("v5:topic:" + topic.id);
  const failed = await app.search();
  assert.equal(failed.status, 502);
  assert.equal(app.kv.values.get("count:2026-11-07"), "1");
  assert.equal(app.kv.values.get("v5:topic:" + topic.id), before);
  assert.equal((await app.search(req("other topic"))).status, 502);
  assert.equal(app.kv.values.get("count:2026-11-07"), "2");
  assert.equal(app.kv.values.has("v5:topic:other topic"), false);
  assert.equal((await app.kv.get("library", "json")).length, 1);
  assert.equal((await app.search(req("third topic"))).status, 429);
  assert.equal(app.state.calls, 38);
});

test("daily counters roll over at midnight UTC and honour a configured cap", async () => {
  const app = setup({ NEW_TOPICS_PER_DAY: "1" });
  app.state.time = Date.parse("2026-10-31T23:59:59.999Z");
  assert.equal((await app.search()).status, 200);
  assert.equal((await app.search(req("second topic"))).status, 429);
  app.state.time++;
  assert.equal((await app.search(req("second topic"))).status, 200);
  assert.equal(app.kv.values.get("count:2026-10-31"), "1");
  assert.equal(app.kv.values.get("count:2026-11-01"), "1");
  assert.equal(app.state.calls, 28);
});

test("sub-topics use canonical parent terms plus ID and are indexed as children without duplicates", async () => {
  const app = setup();
  const parent = await (await app.search()).json();
  const child = await (await app.search(req(undefined, { subtopic: "https://openalex.org/T123", subtopicName: "Orbital logic", parent: parent.id }))).json();
  const same = await (await app.search(req(undefined, { subtopic: "T123", subtopicName: "Different display label" }))).json();
  assert.equal(same.id, child.id);
  assert.equal(same.cached, true);
  assert.equal(same.parent, parent.id);
  assert.equal(same.name, "Orbital logic · since 2010");
  const secondChild = await (await app.search(req(undefined, { subtopic: "T456", subtopicName: "Spore networks" }))).json();
  const otherParent = await (await app.search(req("other topic"))).json();
  const otherChild = await (await app.search(req("other topic", { subtopic: "T123", subtopicName: "Orbital logic" }))).json();
  assert.notEqual(otherChild.id, child.id);
  assert.equal(otherChild.parent, otherParent.id);
  const index = await app.kv.get("library", "json");
  assert.deepEqual(index.find((entry) => entry.id === parent.id).children, [child.id, secondChild.id]);
  assert.deepEqual(index.find((entry) => entry.id === otherParent.id).children, [otherChild.id]);
  assert.equal(index.find((entry) => entry.id === child.id).subtopicId, "T123");
  assert.equal(index.filter((entry) => entry.id === child.id).length, 1);
  assert.equal(app.kv.writes.length, 15);
  const reads = app.kv.reads.length;
  const invalid = await app.search(req(undefined, { subtopic: "T123", parent: "unrelated topic" }));
  assert.equal(invalid.status, 400);
  assert.equal(app.kv.reads.length, reads);
  assert.equal(app.state.calls, 70);
});

test("same-isolate simultaneous requests respect reservations and coalesce identical searches", async () => {
  const app = setup({ NEW_TOPICS_PER_DAY: "1" });
  const results = await Promise.all([app.search(), app.search(), app.search(req("other topic"))]);
  assert.deepEqual(results.map((response) => response.status), [200, 200, 429]);
  assert.equal((await results[1].json()).cached, true);
  assert.equal(app.state.calls, 14);
  assert.equal(app.kv.writes.length, 3);
  assert.equal(app.kv.values.get("count:2026-10-31"), "1");
});

test("same-isolate simultaneous different topics preserve all index entries", async () => {
  const app = setup();
  const results = await Promise.all([app.search(), app.search(req("other topic")), app.search(req(undefined, { subtopic: "T123" }))]);
  assert(results.every((response) => response.status === 200));
  const index = await app.kv.get("library", "json");
  assert.equal(index.length, 3);
  assert.equal(app.kv.values.get("count:2026-10-31"), "3");
  assert.deepEqual(index.find((entry) => entry.id === "lunar moss computing").children, ["lunar moss computing|primary_topic:T123"]);
  assert.equal(app.kv.writes.length, 9);
});

test("library needs no key, handles CORS and methods, and never calls OpenAlex or changes counters", async () => {
  const app = setup();
  delete app.env.OPENALEX_KEY;
  const url = "http://localhost:8787/api/library";
  const empty = await app.worker.fetch(new Request(url, { headers: { Origin: "https://sample.example" } }), app.env);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), []);
  assert.equal(empty.headers.get("Access-Control-Allow-Origin"), "https://sample.example");
  assert.equal((await app.worker.fetch(new Request(url, { method: "OPTIONS" }), {})).status, 204);
  assert.equal((await app.worker.fetch(new Request(url, { method: "POST" }), app.env)).status, 405);
  assert.equal((await app.worker.fetch(new Request(url, { headers: { Origin: "https://untrusted.example" } }), app.env)).status, 403);
  assert.equal(app.state.calls, 0);
  assert.equal(app.kv.writes.length, 0);
});

test("stored data is topic-only and library responses use the required topic fields", async () => {
  const app = setup();
  await app.search(req(undefined, { ignored: "visitor@example.test" }, { "CF-Connecting-IP": "192.0.2.42", "User-Agent": "Private visitor marker", Cookie: "identity=hidden" }));
  const index = await (await app.worker.fetch(new Request("http://localhost:8787/api/library"), app.env)).json();
  assert.deepEqual(Object.keys(index[0]).sort(), ["id", "name", "synonyms", "field", "momentum", "growth", "total", "updated", "parent", "children", "spark", "from", "to", "sparkStartYear", "growthLabel", "growthStartCount", "growthEndCount", "growthStartYear", "growthEndYear"].sort());
  assert.equal(index[0].total, 1992);
  assert.equal(index[0].parent, null);
  const stored = JSON.stringify([...app.kv.values]);
  for (const marker of ["192.0.2.42", "Private visitor marker", "visitor@example.test", "identity=hidden", app.env.OPENALEX_KEY, "api.openalex.org"]) assert(!stored.includes(marker));
});

test("KV failures prevent uncounted source work and a later cache hit can repair an index write failure", async () => {
  const app = setup();
  const put = app.kv.put.bind(app.kv);
  app.kv.put = async () => { throw new Error("Private storage details"); };
  const failed = await app.search();
  assert.equal(failed.status, 503);
  assert(!JSON.stringify(await failed.json()).includes("Private storage details"));
  assert.equal(app.state.calls, 0);
  app.kv.put = async (key, ...args) => { if (key === "library") throw new Error("Storage failed"); return put(key, ...args); };
  assert.equal((await app.search()).status, 503);
  assert.equal(app.state.calls, 14);
  assert.equal(app.kv.values.get("count:2026-10-31"), "1");
  app.kv.put = put;
  const repaired = await app.search();
  assert.equal(repaired.status, 200);
  assert.equal((await repaired.json()).cached, true);
  assert.equal((await app.kv.get("library", "json")).length, 1);
  assert.equal(app.state.calls, 14);
});

test("missing bindings and invalid caps or counters fail closed without source calls", async () => {
  for (const config of [{ TMM: undefined }, { NEW_TOPICS_PER_DAY: "bad" }, { NEW_TOPICS_PER_DAY: "-1" }]) {
    const app = setup(config);
    assert.equal((await app.search()).status, 503);
    assert.equal(app.state.calls, 0);
  }
  const app = setup();
  app.kv.values.set("count:2026-10-31", '"not a number"');
  assert.equal((await app.search()).status, 503);
  assert.equal(app.state.calls, 0);
  assert.equal(app.kv.writes.length, 0);
});

test("cache-only reads serve both fresh and stale reports without counters, index reads, writes or a source key", async () => {
  const app = setup();
  const topic = await (await app.search()).json();
  delete app.env.OPENALEX_KEY;
  app.env.NEW_TOPICS_PER_DAY = "invalid"; // Cache-only mode bypasses all new-search configuration.
  const writes = app.kv.writes.length;
  app.kv.reads.length = 0;
  const fresh = await app.search(req(undefined, { cache: "only" }));
  assert.equal(fresh.status, 200);
  assert.deepEqual(await fresh.json(), { ...topic, cached: true });
  app.state.time += CACHE_MAX_AGE_MS;
  const stale = await app.search(req(undefined, { cache: "only" }));
  assert.equal(stale.status, 200);
  assert.deepEqual(await stale.json(), { ...topic, cached: true, stale: true });
  const pointer = "ai:q:v1:" + topic.id; // A plain read also looks up a saved checked result for the same search.
  assert.deepEqual(app.kv.reads, ["v5:topic:" + topic.id, pointer, "v5:topic:" + topic.id, pointer]);
  assert.equal(app.kv.writes.length, writes);
  assert.equal(app.state.calls, 14);
});

test("missing current-version saved reports rebuild automatically and reject invalid requests", async () => {
  const app = setup();
  const response = await app.search(req(undefined, { cache: "only" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cached, false);
  assert.equal(app.state.calls, 14);
  assert.equal(app.kv.writes.length, 3);
  assert.equal((await app.search(req(undefined, { cache: "onyl" }))).status, 400);
  assert.equal((await app.search(req(undefined, { cache: "only", subtopic: "T123|T456" }))).status, 400);
  assert.equal(app.state.calls, 14);
});

test("normal searches and saved links rebuild fresh v1 reports into v2 without changing v1", async () => {
  for (const extra of [{}, { cache: "only" }]) {
    const app = setup();
    const legacy = { savedAt: start, topic: { id: "lunar moss computing", name: "Legacy report", updated: "2026-10-01" } };
    const original = JSON.stringify(legacy);
    app.kv.values.set("topic:lunar moss computing", original);
    const response = await app.search(req(undefined, extra));
    assert.equal(response.status, 200);
    const topic = await response.json();
    assert.equal(topic.cached, false);
    assert.equal(topic.from, 2010);
    assert.equal(topic.to, null);
    assert.equal(topic.kpis.growthLabel, "5-year growth");
    assert.equal(app.state.calls, 14);
    assert.equal(app.kv.values.get("topic:lunar moss computing"), original);
    assert.deepEqual(app.kv.writes.map((entry) => entry.key), ["count:2026-10-31", "v5:topic:lunar moss computing", "library"]);
    assert.deepEqual(app.kv.writes[1].options, { expirationTtl: 5184000 });
    const writes = app.kv.writes.length;
    delete app.env.OPENALEX_KEY;
    assert.equal((await app.search(req(undefined, { cache: "only" }))).status, 200);
    assert.equal(app.kv.writes.length, writes); // Hits do not extend retention.
    assert.equal(app.state.calls, 14);
  }
});

test("at the cap, missing v2 records fall back to matching v1 records without writes or a source key", async () => {
  for (const extra of [{}, { cache: "only" }]) {
    const app = setup({ NEW_TOPICS_PER_DAY: "0", OPENALEX_KEY: undefined });
    const topic = { id: "lunar moss computing", name: "Legacy report", updated: "2026-09-01" };
    const legacy = JSON.stringify({ savedAt: start - CACHE_MAX_AGE_MS, topic });
    app.kv.values.set("topic:" + topic.id, legacy);
    const response = await app.search(req(undefined, extra));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...topic, cached: true, stale: true });
    assert.equal(app.kv.values.get("topic:" + topic.id), legacy);
    assert.equal(app.kv.writes.length, 0);
    assert.equal(app.state.calls, 0);
    assert.deepEqual(app.kv.reads, ["v5:topic:" + topic.id, "count:2026-10-31", "v2:topic:" + topic.id, "topic:" + topic.id, "ai:q:v1:" + topic.id]);
    assert.equal((await app.search(req("absent report", extra))).status, 429);
    app.kv.values.set("topic:wrong record", JSON.stringify({ savedAt: start, topic }));
    assert.equal((await app.search(req("wrong record", extra))).status, 429);
  }
});

test("failed saved-link rebuilds consume the attempt and leave legacy reports untouched", async () => {
  const app = setup();
  const legacy = JSON.stringify({ savedAt: start, topic: { id: "lunar moss computing", name: "Legacy report", updated: "2026-10-01" } });
  app.kv.values.set("topic:lunar moss computing", legacy);
  app.state.fail = true;
  assert.equal((await app.search(req(undefined, { cache: "only" }))).status, 502);
  assert.equal(app.kv.values.get("count:2026-10-31"), "1");
  assert.equal(app.kv.values.get("topic:lunar moss computing"), legacy);
  assert.equal(app.kv.values.has("v5:topic:lunar moss computing"), false);
  assert.equal(app.kv.values.has("library"), false);
});

test("v2 refreshes renew the 60-day TTL and reports deleted by expiry rebuild on a saved link", async () => {
  const app = setup();
  const topic = await (await app.search()).json();
  app.state.time += CACHE_MAX_AGE_MS;
  assert.equal((await app.search()).status, 200);
  const reportWrites = app.kv.writes.filter((entry) => entry.key === "v5:topic:" + topic.id);
  assert.equal(reportWrites.length, 2);
  assert(reportWrites.every((entry) => entry.options.expirationTtl === 5184000));
  app.state.time += 60 * 24 * 60 * 60 * 1000;
  app.kv.values.delete("v5:topic:" + topic.id); // Model the record's deletion by KV expiry.
  assert.equal((await app.search(req(undefined, { cache: "only" }))).status, 200);
  assert.equal(app.state.calls, 42);
  assert.equal(app.kv.writes.filter((entry) => entry.key === "v5:topic:" + topic.id).at(-1).options.expirationTtl, 5184000);
});

test("library browsing reads only the index, returning new spark arrays and older entries unchanged", async () => {
  const app = setup();
  await app.search();
  const index = await app.kv.get("library", "json");
  assert.equal(index[0].spark.length, 16);
  const legacy = { ...index[0], id: "older topic", name: "older topic" };
  delete legacy.spark;
  delete legacy.period;
  delete legacy.from;
  delete legacy.to;
  app.kv.values.set("library", JSON.stringify([...index, legacy]));
  app.kv.reads.length = 0;
  const writes = app.kv.writes.length;
  const response = await app.worker.fetch(new Request("http://localhost:8787/api/library"), app.env);
  assert.deepEqual(await response.json(), [...index, legacy]);
  assert.deepEqual(app.kv.reads, ["library"]);
  assert.equal(app.kv.writes.length, writes);
  assert.equal(app.state.calls, 14);
});

test("v3 migration rebuilds v2 reports without modifying either older cache generation", async()=>{
 for(const extra of [{},{cache:'only'}]){
  const app=setup();const id='lunar moss computing';
  const v2=JSON.stringify({savedAt:start,topic:{id,name:'Second generation',updated:'2026-10-01'}});
  const v1=JSON.stringify({savedAt:start,topic:{id,name:'First generation',updated:'2026-09-01'}});
  app.kv.values.set('v2:topic:'+id,v2);app.kv.values.set('topic:'+id,v1);
  const response=await app.search(req(undefined,extra));assert.equal(response.status,200);
  assert.equal((await response.json()).cached,false);assert.equal(app.state.calls, 14);
  assert.equal(app.kv.values.get('v2:topic:'+id),v2);assert.equal(app.kv.values.get('topic:'+id),v1);
  assert.equal(app.kv.writes.find(w=>w.key==='v5:topic:'+id).options.expirationTtl,5184000);
 }
});

test("capped normal and saved searches prefer v2, then matching v1, without writes",async()=>{
 for(const extra of [{},{cache:'only'}]){
  const app=setup({NEW_TOPICS_PER_DAY:'0',OPENALEX_KEY:undefined}),id='lunar moss computing';
  const v2={id,name:'Second generation',updated:'2026-10-01'},v1={id,name:'First generation',updated:'2026-09-01'};
  app.kv.values.set('v2:topic:'+id,JSON.stringify({savedAt:start,topic:v2}));app.kv.values.set('topic:'+id,JSON.stringify({savedAt:start,topic:v1}));
  assert.deepEqual(await(await app.search(req(undefined,extra))).json(),{...v2,cached:true,stale:true});
  assert(!app.kv.reads.includes('topic:'+id));
  app.kv.values.set('v2:topic:'+id,JSON.stringify({savedAt:start,topic:{...v2,id:'mismatched'}}));
  assert.deepEqual(await(await app.search(req(undefined,extra))).json(),{...v1,cached:true,stale:true});
  assert.equal(app.state.calls,0);assert.equal(app.kv.writes.length,0);
 }
});
