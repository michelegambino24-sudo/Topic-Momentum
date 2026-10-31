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
    const descriptor = buildQueries(normaliseQuery("fixture"), new Date(state.time).getUTCFullYear()).find(({ params }) =>
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
  assert.equal(app.state.calls, 11);
  assert.equal(app.kv.writes.length, 3);
  assert.deepEqual(app.kv.writes.map((entry) => entry.key), ["count:2026-10-31", "topic:" + topic.id, "library"]);
  assert.equal(app.kv.writes[0].value, "1");
  assert.equal(app.kv.writes[0].options.expirationTtl, 172800);
  assert.equal(app.kv.writes[1].options, undefined); // Retain old reports for stale fallback.
  delete app.env.OPENALEX_KEY;
  const second = await app.search(req("lunar moss computing", { syn: "orbital logic,MOON CIRCUITS" }));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ...topic, cached: true });
  assert.equal(app.state.calls, 11);
  assert.equal(app.kv.writes.length, 3);
});

test("freshness ends at exactly seven days and refreshing keeps existing children", async () => {
  const app = setup();
  const parent = await (await app.search()).json();
  await app.search(req(undefined, { subtopic: "T123", subtopicName: "Orbital logic", parent: parent.id }));
  app.state.time = start + CACHE_MAX_AGE_MS - 1;
  assert.equal((await (await app.search()).json()).cached, true);
  assert.equal(app.state.calls, 22);
  app.state.time++;
  const refreshed = await (await app.search()).json();
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.updated, "2026-11-07");
  assert.equal(app.state.calls, 33);
  const index = await app.kv.get("library", "json");
  assert.deepEqual(index.find((entry) => entry.id === parent.id).children, [parent.id + "|primary_topic:T123"]);
});

test("default cap admits attempt 90, blocks attempt 91, and still serves fresh and expired reports", async () => {
  const app = setup();
  app.kv.values.set("count:2026-10-31", "89");
  const topic = await (await app.search()).json();
  assert.equal(app.kv.values.get("count:2026-10-31"), "90");
  const blocked = await app.search(req("other moss"));
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "daily_limit", message: "Daily limit reached. Try again tomorrow or browse the Library." });
  assert.equal((await (await app.search()).json()).cached, true);
  const old = { ...topic, updated: "2026-10-24" };
  app.kv.values.set("topic:" + topic.id, JSON.stringify({ savedAt: start - CACHE_MAX_AGE_MS, topic: old }));
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
  assert.equal(app.state.calls, 11);
  assert.equal((await app.kv.get("topic:" + topic.id, "json")).savedAt, start - CACHE_MAX_AGE_MS);
});

test("failed attempts count, leave no partial report or index, and do not overwrite an expired report", async () => {
  const app = setup({ NEW_TOPICS_PER_DAY: "2" });
  const topic = await (await app.search()).json();
  app.state.time += CACHE_MAX_AGE_MS;
  app.state.fail = true;
  const before = app.kv.values.get("topic:" + topic.id);
  const failed = await app.search();
  assert.equal(failed.status, 502);
  assert.equal(app.kv.values.get("count:2026-11-07"), "1");
  assert.equal(app.kv.values.get("topic:" + topic.id), before);
  assert.equal((await app.search(req("other topic"))).status, 502);
  assert.equal(app.kv.values.get("count:2026-11-07"), "2");
  assert.equal(app.kv.values.has("topic:other topic"), false);
  assert.equal((await app.kv.get("library", "json")).length, 1);
  assert.equal((await app.search(req("third topic"))).status, 429);
  assert.equal(app.state.calls, 33);
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
  assert.equal(app.state.calls, 22);
});

test("sub-topics use canonical parent terms plus ID and are indexed as children without duplicates", async () => {
  const app = setup();
  const parent = await (await app.search()).json();
  const child = await (await app.search(req(undefined, { subtopic: "https://openalex.org/T123", subtopicName: "Orbital logic", parent: parent.id }))).json();
  const same = await (await app.search(req(undefined, { subtopic: "T123", subtopicName: "Different display label" }))).json();
  assert.equal(same.id, child.id);
  assert.equal(same.cached, true);
  assert.equal(same.parent, parent.id);
  assert.equal(same.name, "Orbital logic");
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
  assert.equal(app.state.calls, 55);
});

test("same-isolate simultaneous requests respect reservations and coalesce identical searches", async () => {
  const app = setup({ NEW_TOPICS_PER_DAY: "1" });
  const results = await Promise.all([app.search(), app.search(), app.search(req("other topic"))]);
  assert.deepEqual(results.map((response) => response.status), [200, 200, 429]);
  assert.equal((await results[1].json()).cached, true);
  assert.equal(app.state.calls, 11);
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
  assert.deepEqual(Object.keys(index[0]), ["id", "name", "synonyms", "field", "momentum", "growth", "total", "updated", "parent", "children"]);
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
  assert.equal(app.state.calls, 11);
  assert.equal(app.kv.values.get("count:2026-10-31"), "1");
  app.kv.put = put;
  const repaired = await app.search();
  assert.equal(repaired.status, 200);
  assert.equal((await repaired.json()).cached, true);
  assert.equal((await app.kv.get("library", "json")).length, 1);
  assert.equal(app.state.calls, 11);
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
