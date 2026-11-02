import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseQuery, normaliseSubfieldId, buildQueries, fallbackQueries, shapeTopic, presentReport, refinementCandidates, SEARCH_PRESETS, REPORT_CACHE_PREFIX, publicLibrary, updateLibrary } from "./lib.js";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";

const fixture = id => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), "utf8"));
const date = new Date("2026-10-31T12:00:00Z");
const responses = () => Object.fromEntries(buildQueries(normaliseQuery("inheritance"), 2026).map(({ id }) => [id, fixture(id)]));
const report = () => shapeTopic(normaliseQuery("inheritance"), responses(), date);
const request = params => new Request("http://localhost/api/topic?" + new URLSearchParams(params));

test("subfield IDs occupy only the new identity component and reject filter injection", () => {
  const base = normaliseQuery("inheritance", "estate", "T123", [["children"], ["gulf states"]], 2020, 2025, 2026);
  const query = normaliseQuery("inheritance", "estate", "T123", [["children"], ["gulf states"]], 2020, 2025, 2026, "https://openalex.org/subfields/3308");
  assert.equal(query.id, base.id.replace("|primary_topic:", "|subfield:3308|primary_topic:"));
  assert.equal(query.subfieldId, "3308");
  assert.equal(normaliseSubfieldId("1311"), "1311");
  for (const invalid of ["", "0", "03308", "F3308", "3308|1311", "3308,foo:true", "https://example.com/subfields/3308"]) assert.throws(() => normaliseSubfieldId(invalid));
});

test("one new selected-range query leaves the since-2020 top-one Library field query unchanged", () => {
  const base = buildQueries(normaliseQuery("inheritance", "", "", "", 2015, 2019, 2026), 2026);
  assert.equal(base.length, 12);
  assert.deepEqual(base.find(item => item.id === "field").params, { filter: "title_and_abstract.search:(inheritance),from_publication_date:2020-01-01", group_by: "primary_topic.field.id", per_page: "1" });
  assert.deepEqual(base.find(item => item.id === "subfields").params, { filter: "title_and_abstract.search:(inheritance),from_publication_date:2015-01-01,to_publication_date:2019-12-31", group_by: "primary_topic.subfield.id", per_page: "5" });
  const query = normaliseQuery("inheritance", "estate", "T123", [["children"], ["gulf states"]], 2015, 2019, 2026, "3308");
  for (const item of [...buildQueries(query, 2026), ...fallbackQueries(query, 2026, responses())]) {
    assert(item.params.filter.includes('title_and_abstract.search:(inheritance OR estate) AND (children) AND ("gulf states")'));
    assert(item.params.filter.includes(",primary_topic.subfield.id:3308,"));
    assert(item.params.filter.includes(",primary_topic.id:T123,"));
  }
});

test("chip priority uses real shares, at most five choices, and full names with short labels", () => {
  const data = report();
  data.suggestedSynonyms = ["succession law", "estate law", "third alternative"];
  const choices = refinementCandidates(data);
  assert.deepEqual(choices.map(item => item.kind), ["subfield", "subfield", "region", "region", "synonym"]);
  assert.equal(choices[0].label, "Only Law · 62%");
  assert.equal(choices[1].label, "Only Genetics · 30%");
  assert.equal(choices[4].term, "succession law");
  const distribution = data.subfields;
  data.subfields = { ...distribution, items: [{ id: "3312", name: "Sociology and Political Science", count: 500 }] };
  const long = refinementCandidates(data)[0];
  assert.equal(long.name, "Sociology and Political Science");
  assert(long.label.length <= 30);
  assert(long.label.includes("…"));
});

test("85 percent threshold uses unrounded shares, all papers and the matching range", () => {
  const data = report(); data.kpis.total = 1000;
  data.subfields = { from: data.from, to: data.to, total: 1000, items: [{ id: "3308", name: "Law", count: 849 }, { id: "1311", name: "Genetics", count: 100 }] };
  assert.equal(refinementCandidates(data)[0].label, "Only Law · 85%");
  data.subfields.items[0].count = 850;
  assert(!refinementCandidates(data).some(item => item.kind === "subfield"));
  data.subfields.items[0].count = 620;
  assert.equal(refinementCandidates(data)[0].label, "Only Law · 62%");
  data.subfields.items[0].count = 1200;
  assert(!refinementCandidates(data).some(item => item.kind === "subfield"));
  data.subfields.items[0].count = 620;
  data.subfields.from = 2020;
  assert(!refinementCandidates(data).some(item => item.kind === "subfield"));
  delete data.subfields;
  assert(!refinementCandidates(data).some(item => item.kind === "subfield"));
  data.kpis.total = 0;
  assert(!refinementCandidates(data).some(item => item.kind === "subfield"));
});

test("regions require positive evidence and room; synonyms are deduplicated against every group", () => {
  const data = report(); delete data.subfields;
  data.regionalCounts = { gcc: 0, uae: 0 }; data.countries = [{ code: "JO", count: 3 }]; data.suggestedSynonyms = [];
  assert.deepEqual(refinementCandidates(data).map(item => item.label), ["Mentions Middle East"]);
  data.countries[0].count = 0;
  assert.deepEqual(refinementCandidates(data), []);
  data.countries = [{ code: "AE", count: 1 }];
  data.includeTerms = [...SEARCH_PRESETS.gcc.terms].reverse();
  data.suggestedSynonyms = ["Inheritance", "UAE", "estate", "ESTATE", "succession law", "another"];
  data.searchTerms.synonyms = ["estate"];
  assert(!refinementCandidates(data).some(item => item.preset === "gcc"));
  assert.deepEqual(refinementCandidates(data).filter(item => item.kind === "synonym").map(item => item.term), ["succession law", "another"]);
  delete data.includeTerms;
  data.includeGroups = [["one"], ["two"], ["three"]];
  assert(!refinementCandidates(data).some(item => item.kind === "region"));
  data.includeGroups = [["x".repeat(470)]];
  for (const item of refinementCandidates(data)) {
    const groups = item.kind === "region" ? [...data.includeGroups, SEARCH_PRESETS[item.preset].terms] : data.includeGroups;
    const query = normaliseQuery(data.searchTerms.name, [...data.searchTerms.synonyms, ...(item.term ? [item.term] : [])].join(","), "", groups);
    assert(new TextEncoder().encode(REPORT_CACHE_PREFIX + query.id).length <= 512);
  }
});

test("subfield searches, cached reads and sub-topics preserve filters, private variants and write budget", async () => {
  const kv = new MemoryKV(), calls = [];
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" };
  const query = normaliseQuery("inheritance law", "estate", "", [["gulf states"], ["children"]], 2020, 2025, 2026, "3308");
  let current = query;
  const worker = createWorker(async url => {
    calls.push(url);
    const descriptor = [...buildQueries(current, 2026), ...buildQueries(current, 2026, false)].find(item => Object.entries(item.params).every(([key, value]) => url.searchParams.get(key) === value));
    assert(descriptor, "Every source query must retain subfield, groups and range");
    return Response.json(fixture(descriptor.id));
  }, () => date);
  const params = { q: "inheritance law", syn: "estate", include: "gulf states", include2: "children", from: "2020", to: "2025", subfield: "3308" };
  const first = await worker.fetch(request(params), env);
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(data.id, query.id);
  assert.equal(data.selectedSubfield.name, "Law");
  assert.equal(data.name, "inheritance law + gulf states + children, Law papers · 2020–2025");
  assert(data.headline.includes("within Law"));
  assert.equal(presentReport(data).name, data.name);
  assert.equal(data.field, "Computer Science");
  assert(!data.refinements.some(item => item.kind === "subfield"));
  assert.equal(calls.length, 14);
  assert.equal(kv.writes.length, 3);
  assert.deepEqual(publicLibrary(JSON.parse(kv.values.get("library"))), []);
  const cached = await worker.fetch(request({ ...params, cache: "only" }), env);
  assert.equal((await cached.json()).id, data.id);
  assert.equal(calls.length, 14); assert.equal(kv.writes.length, 3);
  current = normaliseQuery("inheritance law", "estate", "T123", [["gulf states"], ["children"]], 2020, 2025, 2026, "3308");
  const child = await (await worker.fetch(request({ ...params, subtopic: "T123", subtopicName: "Measured area", parent: data.id }), env)).json();
  assert.equal(child.parent, data.id);
  assert.equal(presentReport(child).name, child.name);
  const projected = publicLibrary(updateLibrary([], child));
  assert.deepEqual(projected, []);
  assert.deepEqual(publicLibrary([{ id: "old|subfield:3308", children: [] }, { id: "child", parent: "old|subfield:3308", children: [] }]), []);
});

test("invalid subfields and an oversized selected identity fail before reservation or source calls", async () => {
  const kv = new MemoryKV();
  const worker = createWorker(() => assert.fail("No source request allowed"), () => date);
  for (const suffix of ["subfield=", "subfield=3308&subfield=1311", "subfield=3308%7C1311", "subfield=F3308"]) {
    assert.equal((await worker.fetch(new Request("http://localhost/api/topic?q=inheritance&" + suffix), { TMM: kv })).status, 400);
  }
  const response = await worker.fetch(request({ q: "x".repeat(200), syn: "y".repeat(300), subfield: "3308" }), { TMM: kv });
  assert.equal(response.status, 400);
  assert.equal(kv.writes.length, 0);
});

test("a failed new subfield query consumes one attempt without partial report writes", async () => {
  const kv = new MemoryKV();
  const descriptors = [...buildQueries(normaliseQuery("inheritance"), 2026), ...buildQueries(normaliseQuery("inheritance"), 2026, false)];
  const worker = createWorker(async url => {
    const descriptor = descriptors.find(item => Object.entries(item.params).every(([key, value]) => url.searchParams.get(key) === value));
    return Response.json(descriptor.id === "subfields" ? { group_by: null } : fixture(descriptor.id));
  }, () => date);
  const response = await worker.fetch(request({ q: "inheritance" }), { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" });
  assert.equal(response.status, 502);
  assert.equal(kv.writes.length, 1);
});
