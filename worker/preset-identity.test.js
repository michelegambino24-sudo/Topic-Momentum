import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEARCH_PRESETS, normaliseQuery, normaliseIncludeGroups, includeGroupIdentity, legacyMultiGroupId, buildQueries, shapeTopic, REPORT_CACHE_PREFIX } from "./lib.js";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";

const fixture = id => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), "utf8"));
const date = new Date("2026-10-31T12:00:00Z");
const groups = [SEARCH_PRESETS.children.terms, SEARCH_PRESETS.middleEast.terms];
const request = params => new Request("http://localhost/api/topic?" + new URLSearchParams({ q: "neurotechnology", ...params }));
const params = { include: groups[0].join(","), include2: groups[1].join(",") };

test("single presets, empty queries and duplicate-collapsed groups keep their exact old IDs", () => {
  assert.equal(normaliseQuery("neurotechnology").id, "neurotechnology");
  for (const preset of Object.values(SEARCH_PRESETS)) {
    const expected = "neurotechnology|include:" + JSON.stringify([...preset.terms].sort());
    assert.equal(normaliseQuery("neurotechnology", "", "", preset.terms).id, expected);
    assert.equal(normaliseQuery("neurotechnology", "", "", [preset.terms, [...preset.terms].reverse()]).id, expected);
    assert.equal(normaliseQuery("neurotechnology", "", "T123", preset.terms, 2020, 2025, 2026, "3308").id, expected + "|range:2020-2025|subfield:3308|primary_topic:T123");
  }
  const custom = normaliseQuery("neurotechnology", "", "", [["school"], ["child"]]);
  assert.equal(custom.id, 'neurotechnology|includeGroups:[["school"],["child"]]');
});

test("multi-preset tokens fit the key ceiling, are order-independent, and retain full data order", () => {
  const query = normaliseQuery("neurotechnology", "", "", groups);
  assert.equal(query.id, 'neurotechnology|includeGroups:["preset:children@1","preset:middleEast@1"]');
  assert(new TextEncoder().encode(REPORT_CACHE_PREFIX + query.id).length <= 512);
  assert.deepEqual(query.includeGroups, groups.map(terms => [...terms].sort()));
  const reversed = normaliseQuery("neurotechnology", "", "", [...groups].reverse());
  assert.equal(reversed.id, query.id);
  assert.deepEqual(reversed.includeGroups, [...query.includeGroups].reverse());
  const all = [...groups, SEARCH_PRESETS.gcc.terms];
  const expected = normaliseQuery("neurotechnology", "", "", all).id;
  for (const permutation of [[all[0],all[2],all[1]], [all[1],all[0],all[2]], [all[1],all[2],all[0]], [all[2],all[0],all[1]], [all[2],all[1],all[0]]]) assert.equal(normaliseQuery("neurotechnology", "", "", permutation).id, expected);
  const mixed = normaliseQuery("neurotechnology", "", "", [groups[0], ["classroom", "school"]]);
  assert.equal(mixed.id, 'neurotechnology|includeGroups:["preset:children@1",["classroom","school"]]');
  assert.equal(normaliseQuery("neurotechnology", "", "", [["school", "classroom"], groups[0]]).id, mixed.id);
});

test("preset versions change multi-group IDs only, and saved version fixtures lock each term set", () => {
  const history = fixture("preset-versions");
  for (const [id, preset] of Object.entries(SEARCH_PRESETS)) {
    assert(Number.isSafeInteger(preset.version) && preset.version >= 1);
    assert(history[id]?.[preset.version], "Add an immutable fixture for each new preset version");
    assert.deepEqual(preset.terms, history[id][preset.version], "Changing preset terms must bump its version");
  }
  const updated = { ...SEARCH_PRESETS, children: { ...SEARCH_PRESETS.children, version: 2 } };
  const oldQuery = normaliseQuery("neurotechnology", "", "", groups);
  const newQuery = normaliseQuery("neurotechnology", "", "", groups, 2010, "", 2026, "", updated);
  assert.notEqual(newQuery.id, oldQuery.id); assert(newQuery.id.includes("preset:children@2"));
  assert.deepEqual(newQuery.includeGroups, oldQuery.includeGroups);
  assert.equal(normaliseQuery("neurotechnology", "", "", groups[0], 2010, "", 2026, "", updated).id, normaliseQuery("neurotechnology", "", "", groups[0]).id);
  assert.equal(includeGroupIdentity(normaliseIncludeGroups([["one"], ["two"]]), updated), 'includeGroups:[["one"],["two"]]');
});

test("the Worker searches full preset terms once, saves full metadata and serves reordered groups read-only", async () => {
  const query = normaliseQuery("neurotechnology", "", "", groups);
  const descriptors = [...buildQueries(query, 2026), ...buildQueries(query, 2026, false)];
  const kv = new MemoryKV(), calls = [];
  let time = 0;
  const worker = createWorker(async url => {
    calls.push(url);
    const descriptor = descriptors.find(item => Object.entries(item.params).every(([key, value]) => url.searchParams.get(key) === value));
    assert(descriptor);
    assert(!url.searchParams.get("filter").includes("preset:"));
    assert(url.searchParams.get("filter").includes('"early childhood"'));
    assert(url.searchParams.get("filter").includes('"middle east"'));
    return Response.json(fixture(descriptor.id));
  }, () => date, { now: () => time, sleep: async ms => { time += ms; } });
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" };
  const response = await worker.fetch(request(params), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.id, query.id); assert.equal(calls.length, 14);
  assert.deepEqual(data.includeGroups, query.includeGroups);
  assert.deepEqual(data.searchTerms.includeGroups, query.includeGroups);
  assert(data.name.includes("Children 0–9 + Middle East"));
  assert(data.headline.includes("in children in the Middle East"));
  assert.equal(kv.writes.length, 3);
  assert(kv.reads.every(key => new TextEncoder().encode(key).length <= 512));
  const cached = await worker.fetch(request({ include: params.include2, include2: params.include, cache: "only" }), env);
  assert.equal((await cached.json()).id, data.id);
  assert.equal(calls.length, 14); assert.equal(kv.writes.length, 3);
});

test("legacy full-term multi-group cache records remain readable with their old IDs and parents", async () => {
  const query = normaliseQuery("neurotechnology", "", "", [SEARCH_PRESETS.children.terms, SEARCH_PRESETS.gcc.terms]);
  const legacyId = legacyMultiGroupId(query);
  assert.notEqual(legacyId, query.id);
  const responses = Object.fromEntries(buildQueries(query, 2026).map(({ id }) => [id, fixture(id)]));
  const topic = { ...shapeTopic(query, responses, date), id: legacyId, parent: "neurotechnology" };
  const record = JSON.stringify({ savedAt: date.getTime(), topic });
  const key = REPORT_CACHE_PREFIX + legacyId;
  const kv = new MemoryKV([[key, record]]);
  const worker = createWorker(() => assert.fail("Legacy cached links stay offline"), () => date);
  const response = await worker.fetch(request({ include: SEARCH_PRESETS.children.terms.join(","), include2: SEARCH_PRESETS.gcc.terms.join(","), cache: "only" }), { TMM: kv });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.id, legacyId); assert.equal(saved.parent, topic.parent);
  assert.equal(kv.values.get(key), record); assert.equal(kv.writes.length, 0);
  const childQuery = normaliseQuery("neurotechnology", "", "T123", [SEARCH_PRESETS.children.terms, SEARCH_PRESETS.gcc.terms]);
  const oldChildId = legacyMultiGroupId(childQuery);
  const child = { ...shapeTopic({ ...childQuery, parent: legacyId, subtopicName: "Measured area" }, responses, date), id: oldChildId };
  kv.values.set(REPORT_CACHE_PREFIX + oldChildId, JSON.stringify({ savedAt: date.getTime(), topic: child }));
  const childResponse = await worker.fetch(request({ include: SEARCH_PRESETS.children.terms.join(","), include2: SEARCH_PRESETS.gcc.terms.join(","), subtopic: "T123", parent: legacyId, cache: "only" }), { TMM: kv });
  assert.equal(childResponse.status, 200);
  const savedChild = await childResponse.json();
  assert.equal(savedChild.id, oldChildId); assert.equal(savedChild.parent, legacyId);
  assert.equal(kv.writes.length, 0);
});

test("custom terms are never shortened, and oversized mixed/single queries still fail before KV or source work", async () => {
  const worker = createWorker(() => assert.fail("Validation must precede source calls"), () => date);
  const kv = new MemoryKV();
  for (const values of [
    { include: "ü".repeat(250), include2: SEARCH_PRESETS.children.terms.join(",") },
    { include: "x".repeat(480), include2: SEARCH_PRESETS.gcc.terms.join(",") },
    { q: "x".repeat(200), include: SEARCH_PRESETS.middleEast.terms.join(",") }
  ]) {
    const response = await worker.fetch(request(values), { TMM: kv });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "This search has too many terms. Remove some synonyms or additional terms and try again.");
  }
  assert.equal(kv.reads.length, 0); assert.equal(kv.writes.length, 0);
});
