import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";
import { SEARCH_PRESETS, normaliseQuery, normaliseIncludeGroups, includeGroupsOf, buildSearchExpression, buildQueries, fallbackQueries, queryOperatorCount, shapeTopic, presentReport, publicLibrary, updateLibrary, reportLabel, headlineSubject, REPORT_CACHE_PREFIX, COMPLEX_SEARCH_MESSAGE } from "./lib.js";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const cases = fixture("precise-searches");
const responses = Object.fromEntries(["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field", "subfields"].map(name => [name, fixture(name)]));
const date = new Date("2026-10-31T12:00:00Z");
const request = values => new Request("http://localhost/api/topic?" + new URLSearchParams(values));
const timing = () => { let time = 0; return { now: () => time, sleep: async ms => { time += ms; } }; };

for (const row of cases.queries) test("precise fixture: " + row.id, () => {
  const query = normaliseQuery(row.name, row.synonyms, "", row.groups);
  assert.equal(query.id, row.id);
  assert.equal(buildSearchExpression(query), row.expression);
  for (const descriptor of [...buildQueries(query, 2026), ...fallbackQueries(query, 2026, responses)]) assert(descriptor.params.filter.startsWith("title_and_abstract.search:" + row.expression + ","));
  const count = query.synonyms.length + includeGroupsOf(query).reduce((sum, terms) => sum + terms.length, 0);
  assert.equal(queryOperatorCount(query), count);
});

test("approved keyword presets exclude ambiguous aliases and retain the exact Children preset", () => {
  assert.deepEqual(Object.keys(SEARCH_PRESETS), ["children", "gcc", "middleEast", "pregnancy", "women", "adolescents", "olderAdults", "students"]);
  for (const [name, terms] of Object.entries(cases.presets)) {
    assert.deepEqual(SEARCH_PRESETS[name].terms, terms);
    const query = normaliseQuery("inheritance", "", "", terms.join(","));
    assert(new TextEncoder().encode(REPORT_CACHE_PREFIX + query.id).length <= 512);
  }
  for (const name of ["gcc", "middleEast"]) for (const term of ["gcc", "turkey", "jordan", "cyprus", "cypriot"]) assert(!SEARCH_PRESETS[name].terms.includes(term));
  assert(SEARCH_PRESETS.middleEast.terms.includes("türkiye"));
  assert(SEARCH_PRESETS.middleEast.terms.includes("jordanian"));
  assert(SEARCH_PRESETS.middleEast.terms.includes("turkish"));
});

test("single-group identities, metadata and expressions remain exact, including Unicode and collapsed groups", () => {
  const legacy = normaliseQuery("Inheritance", "estate", "T123", "child,children", 2020, 2025, 2026);
  const collapsed = normaliseQuery("Inheritance", "estate", "T123", [[], ["children", "child"], ["CHILD", "children"]], 2020, 2025, 2026);
  assert.deepEqual(collapsed, legacy);
  assert.equal(legacy.id, 'inheritance|estate|include:["child","children"]|range:2020-2025|primary_topic:T123');
  assert(!("includeGroups" in legacy));
  assert.throws(() => normaliseIncludeGroups([["a"],["b"],["c"],["d"]]), /three include groups/);
  const query = normaliseQuery("inheritance", "", "T123", [["gulf states"],["child"]], 2020, 2025, 2026);
  assert.equal(query.id, 'inheritance|includeGroups:[["gulf states"],["child"]]|range:2020-2025|primary_topic:T123');
});

test("multi-group titles, headline contexts and private Library descendants retain every group", () => {
  const groups = [SEARCH_PRESETS.gcc.terms, SEARCH_PRESETS.children.terms];
  const query = normaliseQuery("inheritance", "", "", groups);
  query.parent = "inheritance";
  const report = shapeTopic(query, responses, date);
  assert.equal(reportLabel("Inheritance", report.includeGroups), "Inheritance + GCC + Children 0–9");
  assert.equal(headlineSubject("inheritance", report.includeGroups), "inheritance in children in the GCC");
  assert.match(report.headline, /inheritance in children in the GCC/);
  assert.deepEqual(report.searchTerms.includeGroups, report.includeGroups);
  assert.deepEqual(presentReport(presentReport(report)), presentReport(report));
  assert(!report.suggestedSynonyms.some(term => groups.flat().includes(term.toLowerCase())));
  const childQuery = normaliseQuery("inheritance", "", "T123", groups);
  Object.assign(childQuery, { parent: query.id, subtopicName: "Measured sub-topic" });
  const child = shapeTopic(childQuery, responses, date);
  const index = updateLibrary(updateLibrary([], report), child);
  assert.deepEqual(index[0].includeGroups, report.includeGroups);
  assert.equal(index[1].parent, report.id);
  assert.deepEqual(publicLibrary(index), []);
  const bare = [{ id: 'root|includeGroups:[["child"],["school"]]', parent:null, children:["child"] }, {id:"child",parent:'root|includeGroups:[["child"],["school"]]',children:[]}];
  assert.deepEqual(publicLibrary(bare), []);
});

test("two and three groups cache separately, inherit into children and preserve pacing, reservations and three writes", async () => {
  const clock = timing(), starts = [], kv = new MemoryKV();
  const env = { TMM:kv, OPENALEX_KEY:"fixture-only-not-a-credential" };
  let query = normaliseQuery("inheritance", "estate", "", [["gulf states","emirati"],["children","child"],["education","school policy"]]);
  const worker = createWorker(async url => {
    starts.push(clock.now());
    const descriptor = [...buildQueries(query, 2026), ...buildQueries(query, 2026, false)].find(({params}) => Object.entries(params).every(([key,value]) => url.searchParams.get(key) === value));
    assert(descriptor, "Every query and fallback must contain all three predicates");
    return Response.json(fixture(descriptor.id));
  }, () => date, clock);
  const params = {q:"inheritance",syn:"estate",include:"emirati,gulf states",include2:"child,children",include3:"education,school policy"};
  const first = await worker.fetch(request(params), env);
  assert.equal(first.status, 200);
  const report = await first.json();
  assert.deepEqual(report.includeGroups, includeGroupsOf(query));
  assert.equal(starts.length, 14);
  for (let i=1;i<starts.length;i++) assert(starts[i]-starts[i-1]>=400);
  assert.equal(kv.writes.length, 3);
  const cached = await worker.fetch(request({...params,cache:"only"}), env);
  assert.equal((await cached.json()).id, report.id);
  assert.equal(starts.length, 14);
  assert.equal(kv.writes.length, 3);
  query = normaliseQuery("inheritance", "estate", "T123", includeGroupsOf(query));
  const child = await worker.fetch(request({...params,subtopic:"T123",subtopicName:"Measured sub-topic",parent:report.id}), env);
  assert.equal(child.status, 200);
  const data = await child.json();
  assert.equal(data.parent, report.id);
  assert.deepEqual(data.includeGroups, report.includeGroups);
  assert.equal(kv.writes.length, 6);
  assert.equal(starts.length, 28);
  const publicResponse = await worker.fetch(new Request("http://localhost/api/library"), env);
  assert.deepEqual(await publicResponse.json(), []);
});

test("malformed, oversized and UTF-8-long group requests fail before source calls, KV reads or reservations", async () => {
  const kv = new MemoryKV();
  const worker = createWorker(() => assert.fail("Invalid queries must stay offline"));
  const env = {TMM:kv,OPENALEX_KEY:"fixture-only-not-a-credential"};
  const longUnicode = "ü".repeat(240);
  const queries = [
    {q:"inheritance",include:"child",include4:"school"},
    {q:"inheritance",include1:"child"},
    {q:"inheritance",include:"x".repeat(600),include2:"y".repeat(601)},
    {q:"inheritance",include:longUnicode,include2:"school"},
    {q:"inheritance",include:"x".repeat(480),include2:SEARCH_PRESETS.children.terms.join(",")}
  ];
  for (const values of queries) assert.equal((await worker.fetch(request(values),env)).status,400);
  const duplicate = new Request("http://localhost/api/topic?q=inheritance&include=child&include=school");
  assert.equal((await worker.fetch(duplicate,env)).status,400);
  assert.equal(kv.writes.length,0);
  assert.equal(kv.reads.length,0);
  const result = await worker.fetch(request(queries[3]),env);
  assert.equal((await result.json()).message,COMPLEX_SEARCH_MESSAGE);
});

test("multi-group failures consume one admitted attempt without partial cache/index records", async t => {
  t.mock.method(console,"error",()=>{});
  const kv = new MemoryKV();
  const worker = createWorker(async()=>new Response("source failure",{status:500}),()=>date,timing());
  const response = await worker.fetch(request({q:"inheritance",include:"gulf states,emirati",include2:"child,children",include3:"education,school policy"}),{TMM:kv,OPENALEX_KEY:"fixture-only-not-a-credential"});
  assert.equal(response.status,502);
  assert.equal(kv.writes.length,1);
  assert.match(kv.writes[0].key,/^count:/);
});
