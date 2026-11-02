import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";
import { COUNTRY_CODES } from "./countries.js";
import { AI_MODEL, interpretationKey } from "./ai.js";
import { SEARCH_PRESETS, aiPlanSchema, validateAIPlan, compileAIPlan, judgeTitles, normaliseQuery, buildQueries, fallbackQueries, publicLibrary, queryParams, CACHE_MAX_AGE_MS } from "./lib.js";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const data = fixture("ai-search"), date = new Date("2026-11-02T12:00:00Z");
const clone = value => JSON.parse(JSON.stringify(value));
const judgments = (matching, count = 25) => ({ onTopic: Array.from({ length: count }, (_, index) => index < matching) });
const post = (input = { sentence: data.sentence }, origin) => new Request("http://localhost/api/search", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(input) });
function setup(replies = [data.plan, data.validJudgment], options = {}) {
  const kv = new MemoryKV(), calls = [], aiCalls = [];
  const starts = [];
  let time = 0;
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential", NEW_TOPICS_PER_DAY: "50", AI_SEARCHES_PER_DAY: "30", ALLOWED_ORIGIN: "https://sample.example",
    AI: { async run(model, params) {
      aiCalls.push({ model, params });
      const value = replies.shift();
      if (value instanceof Error) throw value;
      if (typeof value === "function") return value();
      return { response: typeof value === "string" ? value : JSON.stringify(value) };
    } }, ...options.env };
  const worker = createWorker(async url => {
    calls.push(new URL(url));
    starts.push(time);
    const p = url.searchParams, filter = p.get("filter") || "";
    if (options.source) { const override = options.source(url, calls.length); if (override) return override; }
    if (p.has("search.semantic")) return Response.json(fixture("papers"));
    if (filter.includes("openalex_id:")) return Response.json({ results: fixture("papers").results.map(item => ({ id: item.id })) });
    if (p.get("select") === "id,display_name") return Response.json({ results: (options.titles || data.titles).map((display_name, i) => ({ id: "https://openalex.org/W" + (10000 + i), display_name })) });
    const groups = { publication_year: "years", "authorships.author.id": "experts", "primary_topic.id": filter.includes("to_publication_date:2022") ? "early" : "late", "authorships.countries": "countries", "primary_location.source.id": "journals", "keywords.id": "keywords", "primary_topic.field.id": "field", "primary_topic.subfield.id": "subfields" };
    if (groups[p.get("group_by")]) return Response.json(fixture(groups[p.get("group_by")]));
    if (p.get("select") === "id") return Response.json(fixture(filter.includes("countries/sa") ? "gcc" : "uae"));
    return Response.json(fixture("papers"));
  }, () => date, { now: () => time, sleep: async ms => { time += ms; } });
  return { kv, env, calls, starts, aiCalls, worker, search: input => worker.fetch(post(input), env) };
}

test("the AI schema accepts every shared preset, including all eight current presets", () => {
  const accepted = aiPlanSchema(2026).properties.includeGroups.items.oneOf[0].properties.preset.enum;
  assert.deepEqual([...accepted].sort(), Object.keys(SEARCH_PRESETS).sort());
  for (const preset of Object.keys(SEARCH_PRESETS)) {
    const plan = { ...clone(data.plan), includeGroups: [{ preset }], place: { codes: [], mode: "mentions" } };
    assert.doesNotThrow(() => validateAIPlan(plan, 2026));
    assert.deepEqual(compileAIPlan(plan, 2026).query.includeTerms, [...SEARCH_PRESETS[preset].terms].sort());
  }
  assert.equal(COUNTRY_CODES.size, 249);
});

test("strict plan validation rejects extra properties, unsafe types, unknown presets/countries and invalid years", () => {
  for (const alter of [
    value => { value.kpis = { total: 100 }; }, value => { value.topic = 123; }, value => { value.synonyms = null; },
    value => { value.includeGroups = [{ preset: "unknown" }]; }, value => { value.includeGroups = [{ preset: "children", terms: ["other"] }]; },
    value => { value.place.codes = ["ZZ"]; }, value => { value.place.codes = ["AE|SA"]; }, value => { value.place.mode = "birthplace"; },
    value => { value.excludeTerms = ["gene editing"]; }, value => { value.years.from = "2020"; }, value => { value.years.to = 2010; },
    value => { value.synonyms = Array(6).fill("term"); }, value => { value.excludeTerms = Array(7).fill("term"); }
  ]) {
    const raw = clone(data.plan); alter(raw); assert.throws(() => validateAIPlan(raw, 2026));
  }
  assert.throws(() => judgeTitles({ onTopic: [1] }, 1));
  assert.throws(() => judgeTitles({ onTopic: [true], count: 1 }, 1));
  assert.throws(() => judgeTitles({ onTopic: [true] }, 2));
});

test("new filters have canonical suffixes, constrain every query/fallback and leave legacy IDs unchanged", () => {
  const legacy = normaliseQuery("gene editing", "CRISPR", "T123", "child", 2020, 2025, 2026, "3308");
  assert.equal(legacy.id, 'gene editing|crispr|include:["child"]|range:2020-2025|subfield:3308|primary_topic:T123');
  const query = normaliseQuery("gene editing", "CRISPR", "T123", "child", 2020, 2025, 2026, "3308", SEARCH_PRESETS, { excludeTerms: ["MERS", "Middle East respiratory syndrome", "MERS"], authoredCodes: ["SA", "AE", "AE"] });
  assert.equal(query.id, 'gene editing|crispr|include:["child"]|range:2020-2025|exclude:["mers","middle east respiratory syndrome"]|authored:["AE","SA"]|subfield:3308|primary_topic:T123');
  const responses = { experts: fixture("experts"), journals: fixture("journals") };
  for (const descriptor of [...buildQueries(query, 2026), ...fallbackQueries(query, 2026, responses)]) {
    assert(descriptor.params.filter.includes(' NOT (mers OR "middle east respiratory syndrome")'));
    assert(descriptor.params.filter.includes(",authorships.countries:AE|SA,"));
  }
  assert.deepEqual(publicLibrary([{ id: query.id, parent: null, children: [] }, { id: "child", parent: query.id, children: [] }]), []);
});

test("valid AI search checks actual titles, preserves real counts and caches question-specific semantic ranking", async () => {
  const app = setup();
  const response = await app.search(); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.understanding.mode, "ai");
  assert.deepEqual(result.understanding.check, { matched: 23, total: 25 });
  assert.equal(result.understanding.place.mode, "authored"); assert.equal(result.understanding.place.label, "GCC");
  assert.equal(result.id, compileAIPlan(data.plan, 2026).query.id);
  assert.equal(result.papersKind, "semantic");
  const realTotal = fixture("years").group_by.filter(row => Number(row.key) >= 2020 && Number(row.key) <= 2026).reduce((sum, row) => sum + row.count, 0);
  assert.equal(result.kpis.total, realTotal);
  assert.equal(app.calls.length, 17); assert.equal(app.aiCalls.length, 2);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1"); assert.equal(app.kv.values.get("ai:count:2026-11-02"), "1");
  assert.equal(app.kv.writes.length, 5);
  const core = JSON.parse(app.kv.values.get("v3:topic:" + result.id)).topic;
  assert(!core.understanding); assert(!core.papersKind);
  for (const call of app.aiCalls) {
    assert.equal(call.model, AI_MODEL);
    const sent = JSON.parse(call.params.messages[1].content);
    assert(Object.keys(sent).every(key => ["sentence", "titles"].includes(key)));
    assert(!JSON.stringify(call.params).includes(app.env.OPENALEX_KEY));
  }
  const semantic = app.calls.find(url => url.searchParams.has("search.semantic"));
  assert.equal(semantic.searchParams.get("search.semantic"), data.sentence);
  assert(!semantic.searchParams.get("filter").includes("title_and_abstract.search"));
  const membership = app.calls.find(url => url.searchParams.get("filter").includes("openalex_id:"));
  assert(membership.searchParams.get("filter").includes(" NOT "));
  const repeated = await (await app.search()).json();
  assert.equal(repeated.id, result.id); assert.deepEqual(repeated.understanding.check, result.understanding.check);
  assert.equal(app.calls.length, 17); assert.equal(app.aiCalls.length, 2); assert.equal(app.kv.writes.length, 5);
});

test("place mode switches reuse cached interpretation without inference and preserve current edits", async () => {
  const app = setup();
  const first = await (await app.search()).json();
  const switched = await (await app.search({ sentence: data.sentence, mode: "mentions" })).json();
  assert.equal(app.aiCalls.length, 2);
  assert.equal(switched.understanding.place.mode, "mentions"); assert.equal(switched.understanding.check, null);
  assert(switched.id.includes("preset:gcc@1")); assert(!switched.id.includes("|authored:"));
  assert.equal(switched.includeGroups.length, 2); assert.equal(switched.excludeTerms.length, 1);
  const changed = await (await app.search({ sentence: data.sentence, mode: "authored", current: { name: "gene editing", synonyms: [], includeGroups: switched.includeGroups, excludeTerms: [], from: 2021, to: 2025 } })).json();
  assert.equal(app.aiCalls.length, 2); assert.equal(changed.from, 2021); assert.equal(changed.to, 2025);
  assert.equal(changed.excludeTerms, undefined); assert.deepEqual(changed.synonyms, []);
  assert(!changed.includeGroups); assert(changed.includeTerms.includes("children"));
  assert.deepEqual(changed.authoredCodes, first.authoredCodes);
  const daily = app.kv.values.get("ai:count:2026-11-02"); assert.equal(daily, "1");
});

test("one tightening keeps the higher share, retains original on ties and never loops", async () => {
  const tighter = clone(data.plan); tighter.synonyms = ["CRISPR"]; tighter.excludeTerms.push("unrelated mineral spectroscopy");
  for (const [score, tightened] of [[23, true], [17, false], [10, false]]) {
    const app = setup([data.plan, judgments(17), tighter, judgments(score)]);
    const response = await app.search(); assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.understanding.mode, "ai"); assert.equal(body.understanding.check.matched, tightened ? score : 17);
    assert.equal(body.synonyms.length, tightened ? 1 : 2);
    assert.equal(app.aiCalls.length, 4); assert.equal(app.calls.length, 18);
    assert.equal(app.kv.values.get("count:2026-11-02"), "1");
    const tighteningInput = JSON.parse(app.aiCalls[2].params.messages[1].content);
    assert.deepEqual(Object.keys(tighteningInput), ["sentence", "titles"]);
  }
});

test("exactly 70 percent does not tighten; zero valid titles do not invent a percentage", async () => {
  const boundary = setup([data.plan, judgments(7, 10)], { titles: data.titles.slice(0, 10) });
  assert.deepEqual((await (await boundary.search()).json()).understanding.check, { matched: 7, total: 10 });
  assert.equal(boundary.aiCalls.length, 2);
  const empty = setup([data.plan], { titles: [] });
  assert.deepEqual((await (await empty.search()).json()).understanding.check, { matched: 0, total: 0 });
  assert.equal(empty.aiCalls.length, 1);
});

test("invalid JSON, invalid plans, provider quota and timeouts use Quick mode without extra inference", async () => {
  for (const reply of [data.invalidJSON, { ...data.plan, unexpected: true }, new Error(data.quotaError), () => new Promise(() => {})]) {
    const app = setup([reply], { env: { AI_TIMEOUT_MS: "1" } });
    const response = await app.search(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.understanding.mode, "quick");
    assert.equal(app.aiCalls.length, 1); assert(app.calls.length <= 14);
    assert.equal(app.kv.values.get("count:2026-11-02"), "1");
    assert.equal([...app.kv.values.keys()].filter(key => key.startsWith("ai:search:")).length, 0);
  }
});

test("an AI failure after sampling reuses the reservation and shared request allowance", async () => {
  const app = setup([data.plan, new Error(data.quotaError)]);
  const body = await (await app.search()).json(); assert.equal(body.understanding.mode, "quick");
  assert.equal(app.aiCalls.length, 2); assert.equal(app.calls.length, 15);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1"); assert.equal(app.kv.writes.length, 4);
});

test("AI cap and source cap are checked before inference; cached source reports still work", async () => {
  const cappedAI = setup(); cappedAI.kv.values.set("ai:count:2026-11-02", "30");
  assert.equal((await (await cappedAI.search()).json()).understanding.mode, "quick");
  assert.equal(cappedAI.aiCalls.length, 0);
  const cappedSource = setup(); cappedSource.kv.values.set("count:2026-11-02", "50");
  assert.equal((await cappedSource.search()).status, 429);
  assert.equal(cappedSource.aiCalls.length, 0); assert.equal(cappedSource.calls.length, 0);
});

test("semantic failures retain the fully filtered citation list and title evidence", async () => {
  const app = setup(undefined, { source: url => url.searchParams.has("search.semantic") ? new Response("unavailable", { status: 503 }) : null });
  const body = await (await app.search()).json();
  assert.equal(body.understanding.mode, "ai"); assert.equal(body.understanding.check.matched, 23);
  assert.equal(body.papersKind, "cited"); assert.equal(body.papers[0].title, fixture("papers").results[0].display_name);
});

test("interpretation keys include year and preset versions; GET cache-only restoration makes no inference", async () => {
  assert.equal(await interpretationKey("  GENE   EDITING ", 2026), await interpretationKey("gene editing", 2026));
  assert.notEqual(await interpretationKey("gene editing", 2026), await interpretationKey("gene editing", 2027));
  const app = setup(); const body = await (await app.search()).json();
  const params = queryParams(compileAIPlan(data.plan, 2026).query); params.set("cache", "only"); params.set("understanding", body.understanding.key);
  const restored = await (await app.worker.fetch(new Request("http://localhost/api/topic?" + params), app.env)).json();
  assert.deepEqual(restored.understanding.check, body.understanding.check);
  assert.equal(app.calls.length, 17); assert.equal(app.aiCalls.length, 2); assert.equal(app.kv.writes.length, 5);
  const record = JSON.parse(app.kv.values.get(body.understanding.key)); record.savedAt -= CACHE_MAX_AGE_MS;
  app.kv.values.set(body.understanding.key, JSON.stringify(record));
  const expired = await app.search({ sentence: data.sentence, mode: "mentions" });
  assert.equal(expired.status, 400); assert.equal(app.aiCalls.length, 2);
});

test("new endpoint keeps origin restrictions and exposes only POST JSON preflight", async () => {
  const app = setup();
  assert.equal((await app.worker.fetch(post(undefined, "https://untrusted.example"), app.env)).status, 403);
  assert.equal((await app.worker.fetch(new Request("http://localhost/api/search"), app.env)).status, 405);
  const preflight = await app.worker.fetch(new Request("http://localhost/api/search", { method: "OPTIONS", headers: { Origin: "https://sample.example", "Access-Control-Request-Method": "POST" } }), app.env);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.equal((await app.search({ sentence: "x".repeat(1001) })).status, 400);
  assert.equal(app.aiCalls.length, 0); assert.equal(app.calls.length, 0);
});

test("sample and report retries share the same hard thirty-call ceiling and one reservation", async () => {
  const attempts = new Map();
  const app = setup(undefined, { source: url => {
    if (url.searchParams.get("select") === "id,display_name") return null;
    const key = url.toString(), count = attempts.get(key) || 0;
    attempts.set(key, count + 1);
    return count < 2 ? new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }) : null;
  } });
  const response = await app.search();
  assert.equal(response.status, 429);
  assert.equal(app.aiCalls.length, 2);
  assert.equal(app.calls.length, 30);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1");
  assert.equal(app.kv.writes.length, 2);
  assert(![...app.kv.values.keys()].some(key => key.startsWith("v3:topic:") || key.startsWith("ai:search:")));
});

test("semantic membership keeps only cohort papers and preserves semantic order", async () => {
  const papers = fixture("papers").results.slice().reverse();
  const permitted = papers.slice(0, 1);
  const app = setup(undefined, { source: url => {
    if (url.searchParams.has("search.semantic")) return Response.json({ results: papers });
    if (url.searchParams.get("filter")?.includes("openalex_id:")) return Response.json({ results: permitted.map(item => ({ id: item.id })) });
    return null;
  } });
  const result = await (await app.search()).json();
  assert.equal(result.papersKind, "semantic"); assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].title, permitted[0].display_name);
  assert(app.calls.every(url => !url.searchParams.has("rerank")));
});

test("invalid tightening keeps the checked first plan, without a second sampling loop", async () => {
  const wider = clone(data.plan); wider.years.from = 2010;
  const app = setup([data.plan, judgments(10), wider]);
  const result = await (await app.search()).json();
  assert.equal(result.understanding.mode, "ai");
  assert.equal(result.understanding.check.matched, 10);
  assert.equal(app.aiCalls.length, 3);
  assert.equal(app.calls.filter(url => url.searchParams.get("select") === "id,display_name").length, 1);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1");
});

test("simultaneous identical questions coalesce within an isolate without duplicate inference/writes", async () => {
  const app = setup();
  const responses = await Promise.all([app.search(), app.search(), app.search()]);
  assert(responses.every(response => response.status === 200));
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert(bodies.every(body => body.id === bodies[0].id));
  assert.equal(app.aiCalls.length, 2); assert.equal(app.calls.length, 17); assert.equal(app.kv.writes.length, 5);
});

test("restored context for edited filters clears evidence but retains a switchable place", async () => {
  const app = setup(); const initial = await (await app.search()).json();
  const query = compileAIPlan(data.plan, 2026).query;
  const changed = normaliseQuery(query.name, "", "", query.includeTerms, 2021, 2025, 2026, "", SEARCH_PRESETS, query);
  const params = queryParams(changed); params.set("understanding", initial.understanding.key);
  const response = await app.worker.fetch(new Request("http://localhost/api/topic?" + params), app.env);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.understanding.check, null); assert.equal(body.understanding.place.mode, "authored");
  assert.equal(app.aiCalls.length, 2);
});

test("deploy configuration pins only the free model and the 50/30 caps", () => {
  const configuration = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(configuration, /NEW_TOPICS_PER_DAY = "50"/);
  assert.match(configuration, /AI_SEARCHES_PER_DAY = "30"/);
  assert.match(configuration, /\[ai\]\s+binding = "AI"/);
  assert.match(configuration, /AI_MODEL = "@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast"/);
});

test("semantic retries start at least one second apart even with a zero Retry-After", async () => {
  let retries = 0;
  const app = setup(undefined, { source: url => url.searchParams.has("search.semantic") && retries++ < 2 ? new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }) : null });
  const response = await app.search(); assert.equal(response.status, 200);
  const times = app.calls.flatMap((url, index) => url.searchParams.has("search.semantic") ? [app.starts[index]] : []);
  assert.equal(times.length, 3);
  assert(times[1] - times[0] >= 1000); assert(times[2] - times[1] >= 1000);
});

test("schemas sent to Workers AI contain no keywords it rejects", async () => {
  const { modelSchema } = await import("./ai.js");
  const { aiPlanSchema } = await import("./lib.js");
  const text = JSON.stringify(modelSchema(aiPlanSchema(2026)));
  assert(!text.includes("uniqueItems"));
  assert(JSON.stringify(aiPlanSchema(2026)).length > 0);
});

test("AI plans never repeat a place as a keyword group and never invent an end year", async () => {
  const { tidyPlan } = await import("./ai.js");
  const saudi = [...globalThis.TMM_COUNTRY_GROUPS.find(country => country.label === "Saudi Arabia").terms];
  const plan = { topic: "gamification", synonyms: [], excludeTerms: [],
    includeGroups: [{ preset: "gcc" }, { terms: ["primary school", "pupils"] }, { terms: saudi }],
    place: { codes: ["SA"], mode: "authored" }, years: { from: 2010, to: 2026 } };
  const tidy = tidyPlan(plan, 2026);
  assert.deepEqual(tidy.includeGroups, [{ terms: ["primary school", "pupils"] }]);
  assert.equal(tidy.years.to, null);
  const noPlace = tidyPlan({ ...plan, place: { codes: [], mode: "mentions" }, years: { from: 2015, to: 2020 } }, 2026);
  assert.equal(noPlace.includeGroups.length, 3);
  assert.equal(noPlace.years.to, 2020);
});
