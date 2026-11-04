import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseQuery, buildSearchExpression, buildQueries, shapeTopic, updateLibrary, reportLabel, suggestedSynonyms, presentReport } from "./lib.js";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";

const date = new Date("2026-10-31T12:00:00Z");
const fixture = (id) => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), "utf8"));
const request = (extra = {}) => new Request("https://sample.example/api/topic?" + new URLSearchParams({ q: "neurotechnology", syn: "neural implant", ...extra }));

test("compact labels and suggestions respect every search group, including saved reports", () => {
  const preset = "children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood";
  assert.equal(reportLabel("epigenetics", ["children"]), "epigenetics + children");
  assert.equal(reportLabel("epigenetics", ["children", "infant"]), "epigenetics + children / infant");
  const query = normaliseQuery("epigenetics", "neural implant", "", preset);
  assert.equal(reportLabel(query.name, query.includeTerms), "epigenetics + Children 0–9");
  const response = { group_by: ["Children", "EPIGENETICS", "Neural implant", "Infant", "Early childhood", "Implant", "Brain signals"].map((name, i) => ({ key: String(i), key_display_name: name, count: 100 - i })) };
  assert.deepEqual(suggestedSynonyms(response, query), ["Brain signals"]);
  const old = { name: `epigenetics + (${query.includeTerms.join(" OR ")})`, includeTerms: query.includeTerms,
    searchTerms: { name: query.name }, synonyms: query.synonyms, suggestedSynonyms: ["children", "Brain signals"] };
  old.headline = `Research on ${old.name} is growing.`;
  const displayed = presentReport(old);
  assert.equal(displayed.name, "epigenetics + Children 0–9");
  assert.equal(displayed.headline, "Research on epigenetics in children is growing.");
  assert.deepEqual(displayed.suggestedSynonyms, ["Brain signals"]);
  assert.deepEqual(presentReport(displayed), displayed);
});

test("include alternatives are canonical, separate identities and constrain all twelve queries", () => {
  const main = normaliseQuery("neurotechnology", "neural implant");
  const filtered = normaliseQuery("neurotechnology", "neural implant", "", " Children, child, early childhood, CHILD ");
  assert.deepEqual(filtered.includeTerms, ["child", "children", "early childhood"]);
  assert.equal(filtered.id, normaliseQuery("Neurotechnology", "neural implant", "", "early childhood,children,child").id);
  assert.notEqual(filtered.id, main.id);
  assert.equal(main.id, normaliseQuery("neurotechnology", "neural implant", "", " , ").id);
  assert.notEqual(filtered.id, normaliseQuery("neurotechnology", "neural implant", "", "adults").id);
  const expression = '(neurotechnology OR "neural implant") AND (child OR children OR "early childhood")';
  assert.equal(buildSearchExpression(filtered), expression);
  for (const descriptor of buildQueries(filtered, 2026)) {
    assert(descriptor.params.filter.startsWith(`title_and_abstract.search:${expression},`));
  }
  const child = normaliseQuery("neurotechnology", "neural implant", "T123", "children,child,early childhood");
  assert.equal(child.id, filtered.id + "|primary_topic:T123");
  assert(buildQueries(child, 2026).every(({ params }) => params.filter.includes(",primary_topic.id:T123,")));
});

test("variant titles and headlines preserve the combination and child-first index links", () => {
  const query = normaliseQuery("neurotechnology", "neural implant", "", "children,child");
  query.parent = normaliseQuery(query.name, "neural implant").id;
  const responses = Object.fromEntries(buildQueries(query, 2026).map(({ id }) => [id, fixture(id)]));
  const topic = shapeTopic(query, responses, date);
  assert.equal(topic.name, "neurotechnology + child / children · since 2010");
  assert.match(topic.headline, /^Since 2010, research on neurotechnology .* has been accelerating/);
  assert(topic.headline.includes("neurotechnology mentioning child or children"));
  let index = updateLibrary([], topic);
  assert.equal(index[0].variant, true);
  assert.deepEqual(index[0].searchTerms.includeTerms, ["child", "children"]);
  const main = shapeTopic(normaliseQuery(query.name, "neural implant"), responses, date);
  index = updateLibrary(index, main);
  assert.deepEqual(index.find((entry) => entry.id === main.id).children, [topic.id]);
  assert.deepEqual(updateLibrary(index, main), index);
});

test("variants cache independently, reopen read-only, inherit into sub-topics and keep three-write budget", async () => {
  const kv = new MemoryKV();
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" };
  let calls = 0;
  let query = normaliseQuery("neurotechnology", "neural implant", "", "children,child");
  const worker = createWorker(async (url) => {
    calls++;
    const descriptor = [...buildQueries(query, 2026), ...buildQueries(query, 2026, false)].find(({ params }) => Object.entries(params).every(([key, value]) => String(value) === url.searchParams.get(key)));
    assert(descriptor, "All requests must use the exact combined search");
    return Response.json(fixture(descriptor.id));
  }, () => date);
  const fetch = (extra) => worker.fetch(request(extra), env);
  const first = await fetch({ include: "children,child" });
  assert.equal(first.status, 200);
  const topic = await first.json();
  assert.equal(kv.writes.length, 3);
  assert.equal(calls, 14);
  const second = await fetch({ include: " CHILD, children,child " });
  assert.deepEqual(await second.json(), { ...topic, cached: true });
  assert.equal(kv.writes.length, 3);
  const saved = await fetch({ include: "child,children", cache: "only" });
  assert.equal(saved.status, 200);
  assert.equal(kv.writes.length, 3);
  assert.equal(calls, 14);
  query = normaliseQuery("neurotechnology", "neural implant", "T123", "children,child");
  const child = await fetch({ include: "child,children", subtopic: "T123", subtopicName: "Orbital processors", parent: topic.id });
  assert.equal(child.status, 200);
  const childTopic = await child.json();
  assert.equal(childTopic.parent, topic.id);
  assert.equal(childTopic.name, "Orbital processors + child / children · since 2010");
  assert.equal(kv.writes.length, 6);
  assert.equal((await fetch({ include: "child,children", subtopic: "T123", parent: "wrong" })).status, 400);
  assert.equal((await fetch({ include: "x".repeat(1201) })).status, 400);
  assert.equal(calls, 28);
});

 test("public library removes variants, filtered descendants and all references without cache writes", async () => {
  const { publicLibrary } = await import("./lib.js");
  const kv = new MemoryKV();
  const base = { id: "main", name: "Main", synonyms: [], field: "Biology", updated: "2026-10-31", parent: null, children: ["child", "secret"] };
  const index = [base, { ...base, id: "child", parent: "main", children: [] },
    { ...base, id: "secret", name: "Private combination", variant: true, parent: "main", children: ["filtered-child"] },
    { ...base, id: "filtered-child", parent: "secret", children: [] },
    { ...base, id: 'main|include:["private"]', parent: null, children: [] }];
  const original = JSON.stringify(index);
  kv.values.set("library", original);
  const worker = createWorker(() => assert.fail("Public browsing must not call OpenAlex"), () => date);
  const result = await (await worker.fetch(new Request("http://localhost/api/library"), { TMM: kv })).json();
  assert.deepEqual(result, publicLibrary(index));
  assert.deepEqual(result.map((item) => item.id), ["main", "child"]);
  assert.deepEqual(result[0].children, ["child"]);
  assert(!JSON.stringify(result).includes("secret"));
  assert(!JSON.stringify(result).includes("private"));
  assert.equal(JSON.stringify(index), original);
  assert.equal(kv.values.get("library"), original);
  assert.equal(kv.writes.length, 0);
  assert.deepEqual(kv.reads, ["library"]);
 });
