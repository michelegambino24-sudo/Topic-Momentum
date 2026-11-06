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
const payload=params=>JSON.parse(params.messages?.[1]?.content || params.prompt.split("<|im_start|>user\n")[1].split("\n/no_think")[0]);
const clone = value => JSON.parse(JSON.stringify(value));
// These orchestration fixtures isolate inference: each model element is attributed
// to the original sentence. Separate grounding tests use narrow exact spans.
const sourced=(plan,sentence)=>({plan,sources:["topic",...plan.synonyms.map((_,i)=>"synonyms."+i),...plan.includeGroups.map((_,i)=>"includeGroups."+i),...(plan.place.codes.length?["place"]:[]),...plan.excludeTerms.map((_,i)=>"excludeTerms."+i),"years.from",...(plan.years.to?["years.to"]:[])].map(path=>({path,source:sentence})),ambiguity:null});
const questionPapers=()=>({results:fixture("papers").results.map(item=>({...item,display_name:"Gene editing in children: "+item.display_name}))});
const judgments = (matching, count = 20) => ({ onTopic: Array.from({ length: count }, (_, index) => index < matching) });
const post = (input = { sentence: data.sentence }, origin) => new Request("http://localhost/api/search", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(input) });
function setup(replies = [data.plan, judgments(18)], options = {}) {
  const kv = new MemoryKV(), calls = [], aiCalls = [];
  const starts = [];
  let time = 0;
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential", NEW_TOPICS_PER_DAY: "50", AI_SEARCHES_PER_DAY: "30", ALLOWED_ORIGIN: "https://sample.example",
    AI: { async run(model, params) {
      aiCalls.push({ model, params });
      if(payload(params).task==="self-check")return {response:{ok:true},usage:{neurons:1}};
      let value = replies.length ? replies.shift() : { onTopic: (payload(params).titles || []).map(() => true) };
      if (value instanceof Error) throw value;
      if (typeof value === "function") return value();
      if(value?.topic)value=sourced(value,payload(params).sentence);
      if (value?.onTopic) value={pass:value.onTopic.flatMap((pass,i)=>pass?[i+1]:[])};
      return { response: typeof value === "string" ? value : JSON.stringify(value), usage:{neurons:1} };
    } }, ...options.env };
  const worker = createWorker(async url => {
    const reply=body=>Response.json(options.costUsd!==undefined?{...body,meta:{...body.meta,cost_usd:options.costUsd}}:body,
      {headers:options.unitlessCost!==undefined?{"x-ratelimit-cost":String(options.unitlessCost)}:{}});
    calls.push(new URL(url));
    starts.push(time);
    const p = url.searchParams, filter = p.get("filter") || "";
    if (options.source) { const override = options.source(url, calls.length); if (override) return override; }
    if (p.has("search.semantic")) return reply(questionPapers());
    if (filter.includes("openalex_id:")) return reply({ results: fixture("papers").results.map(item => ({ id: item.id })) });
    if (p.get("select") === "id,display_name") {
      const all = (options.titles || data.titles.map(title=>"Gene editing in children: "+title)).slice(0, 20), half = Math.ceil(all.length / 2);
      const early = /from_publication_date:(2010|2020)-01-01/.test(filter);
      const base = [...filter.replace(/,(?:from|to)_publication_date:[^,]+/g, "")].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 10000, 0);
      return reply({ results: (early ? all.slice(0, half) : all.slice(half)).map((display_name, i) => ({ id: "https://openalex.org/W" + (1000000 + base * 100 + (early ? 0 : 10) + i), display_name })) });
    }
    const groups = { publication_year: "years", "authorships.author.id": "experts", "primary_topic.id": filter.includes("to_publication_date:2022") ? "early" : "late", "authorships.countries": "countries", "primary_location.source.id": "journals", "keywords.id": "keywords", "primary_topic.field.id": "field", "primary_topic.subfield.id": "subfields" };
    if (groups[p.get("group_by")]) return reply(fixture(groups[p.get("group_by")]));
    if (p.get("select") === "id") return reply(fixture(filter.includes("countries/sa") ? "gcc" : "uae"));
    return reply(questionPapers());
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

test("valid AI search checks actual titles, preserves real counts and caches question-specific checked evidence", async () => {
  const app = setup();
  const response = await app.search(); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.understanding.mode, "ai");
  assert.deepEqual(result.understanding.check, { matched: 18, total: 20, early: { matched: 10, total: 10 }, late: { matched: 8, total: 10 }, lowPrecision: false, trendDistorted: false });
  assert.equal(result.understanding.place.mode, "authored"); assert.equal(result.understanding.place.label, "GCC");
  assert.equal(result.id, compileAIPlan(data.plan, 2026).query.id);
  assert.equal(result.papersKind, "checked");
  const realTotal = fixture("years").group_by.filter(row => Number(row.key) >= 2020 && Number(row.key) <= 2026).reduce((sum, row) => sum + row.count, 0);
  assert.equal(result.kpis.total, realTotal);
  assert.equal(app.calls.length, 20); assert.equal(app.aiCalls.length, 4);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1"); assert.equal(app.kv.values.get("ai:count:2026-11-02"), "1");
  assert.equal(app.kv.writes.length, 8);
  const core = JSON.parse(app.kv.values.get("v5:topic:" + result.id)).topic;
  assert(!core.understanding); assert(!core.papersKind);
  for (const call of app.aiCalls) {
    assert([AI_MODEL,"@cf/qwen/qwen3-30b-a3b-fp8"].includes(call.model));
    const sent = payload(call.params);
    assert(Object.keys(sent).every(key => ["task", "contentQuestion", "sentence", "decision", "feedback", "baseline", "plan", "mismatches", "question", "required", "titles", "year"].includes(key)));
    assert(!JSON.stringify(call.params).includes(app.env.OPENALEX_KEY));
  }
  const semantic = app.calls.find(url => url.searchParams.has("search.semantic"));
  assert.equal(semantic.searchParams.get("search.semantic"), data.sentence);
  assert(!semantic.searchParams.get("filter").includes("title_and_abstract.search"));
  const membership = app.calls.find(url => url.searchParams.get("filter").includes("openalex_id:"));
  assert(membership.searchParams.get("filter").includes(" NOT "));
  const repeated = await (await app.search()).json();
  assert.equal(repeated.id, result.id); assert.deepEqual(repeated.understanding.check, result.understanding.check);
  assert.equal(app.calls.length, 20); assert.equal(app.aiCalls.length,4); assert.equal(app.kv.writes.length, 8);
});

test("place mode switches reuse cached interpretation without inference and preserve current edits", async () => {
  const app = setup();
  const first = await (await app.search()).json();
  const switched = await (await app.search({ sentence: data.sentence, mode: "mentions" })).json();
  assert.equal(app.aiCalls.length,4);
  assert.equal(switched.understanding.place.mode, "mentions"); assert.equal(switched.understanding.check, null);
  assert(switched.id.includes('places:["gcc@1"]:mentions')); assert(!switched.id.includes("|authored:"));
  assert(switched.includeTerms.includes("children")); assert.equal(switched.excludeTerms.length, 1);
  const changed = await (await app.search({ sentence: data.sentence, mode: "authored", current: { name: "gene editing", synonyms: [], includeGroups: [switched.includeTerms], excludeTerms: [], from: 2021, to: 2025 } })).json();
  assert.equal(app.aiCalls.length,4); assert.equal(changed.from, 2021); assert.equal(changed.to, 2025);
  assert.equal(changed.excludeTerms, undefined); assert.deepEqual(changed.synonyms, []);
  assert(!changed.includeGroups); assert(changed.includeTerms.includes("children"));
  assert.deepEqual(changed.authoredCodes, first.authoredCodes);
  const daily = app.kv.values.get("ai:count:2026-11-02"); assert.equal(daily, "1");
});

test("one tightening keeps the higher share, retains original on ties and never loops", async () => {
  const tighter = clone(data.plan); tighter.synonyms = ["CRISPR"]; tighter.excludeTerms.push("unrelated mineral spectroscopy");
  for (const [score, tightened] of [[18, true], [12, false], [8, false]]) {
    const app = setup([data.plan, judgments(12), tighter, judgments(score)]);
    const response = await app.search(); assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.understanding.mode, "ai"); assert.equal(body.understanding.check.matched, tightened ? score : 12);
    assert.equal(body.synonyms.length, tightened ? 1 : 2);
    assert.equal(app.aiCalls.length, 7); assert.equal(app.calls.length, 22);
    assert.equal(app.kv.values.get("count:2026-11-02"), "1");
    const tighteningInput = payload(app.aiCalls[3].params);
    assert.equal(tighteningInput.task,"plan"); assert(tighteningInput.plan && tighteningInput.mismatches);
  }
});

test("exactly 70 percent does not tighten; zero valid titles do not invent a percentage", async () => {
  const boundary = setup([data.plan, judgments(7, 10)], { titles: data.titles.slice(0, 10).map(title=>"Gene editing in children: "+title) });
  assert.deepEqual((await (await boundary.search()).json()).understanding.check, { matched: 7, total: 10, early: { matched: 5, total: 5 }, late: { matched: 2, total: 5 }, lowPrecision: false, trendDistorted: true });
  assert.equal(boundary.aiCalls.length, 4);
  const empty = setup([data.plan], { titles: [] });
  assert.deepEqual((await (await empty.search()).json()).understanding.check, { matched: 0, total: 0, early: { matched: 0, total: 0 }, late: { matched: 0, total: 0 }, lowPrecision: false, trendDistorted: false });
  assert.equal(empty.aiCalls.length, 3);
});

test("invalid JSON, invalid plans, quota and timeout stop after one retry with no unchecked results", async()=>{
  for(const reply of [data.invalidJSON,{...data.plan,topic:null},new Error(data.quotaError),()=>new Promise(()=>{})]){
    const app=setup([reply,reply],{env:{AI_TIMEOUT_MS:"1"}}),response=await app.search();assert.equal(response.status,503);
    const body=await response.json();assert.equal(body.error,"ai_unavailable");assert(!body.papers);assert(!body.experts);assert(app.aiCalls.length>=1&&app.aiCalls.length<=2);assert.equal(app.calls.length,0);
    assert(![...app.kv.values.keys()].some(key=>key.startsWith("ai:search:")));
  }
});

test("one failed relevance call retries with the same source reservation",async()=>{
  const app=setup([data.plan,new Error(data.quotaError),judgments(18)]),body=await(await app.search()).json();
  assert.equal(body.understanding.mode,"ai");assert.equal(app.aiCalls.length,5);assert.equal(app.calls.length,20);assert.equal(app.kv.values.get("count:2026-11-02"),"1");
});

test("AI cap and source cap are checked before inference; cached source reports still work", async () => {
  const cappedAI = setup(); cappedAI.kv.values.set("ai:count:2026-11-02", "30");
  assert.equal((await cappedAI.search()).status,503);
  assert.equal(cappedAI.aiCalls.length, 0);
  const cappedSource = setup(); cappedSource.kv.values.set("count:2026-11-02", "50");
  assert.equal((await cappedSource.search()).status, 429);
  assert.equal(cappedSource.aiCalls.length, 0); assert.equal(cappedSource.calls.length, 0);
});

test("semantic failures retain the fully filtered citation list and title evidence", async () => {
  const app = setup(undefined, { source: url => url.searchParams.has("search.semantic") ? new Response("unavailable", { status: 503 }) : null });
  const body = await (await app.search()).json();
  assert.equal(body.understanding.mode, "ai"); assert.equal(body.understanding.check.matched, 18);
  assert.equal(body.papersKind, "checked"); assert.equal(body.papers[0].title, questionPapers().results[0].display_name);
});

test("interpretation keys include year and preset versions; GET cache-only restoration makes no inference", async () => {
  assert.equal(await interpretationKey("  GENE   EDITING ", 2026), await interpretationKey("gene editing", 2026));
  assert.notEqual(await interpretationKey("gene editing", 2026), await interpretationKey("gene editing", 2027));
  const app = setup(); const body = await (await app.search()).json();
  const params = queryParams(compileAIPlan(data.plan, 2026).query); params.set("cache", "only"); params.set("understanding", body.understanding.key);
  const restored = await (await app.worker.fetch(new Request("http://localhost/api/topic?" + params), app.env)).json();
  assert.deepEqual(restored.understanding.check, body.understanding.check);
  assert.equal(app.calls.length, 20); assert.equal(app.aiCalls.length,4); assert.equal(app.kv.writes.length, 8);
  const record = JSON.parse(app.kv.values.get(body.understanding.key)); record.savedAt -= CACHE_MAX_AGE_MS;
  app.kv.values.set(body.understanding.key, JSON.stringify(record));
  const expired = await app.search({ sentence: data.sentence, mode: "mentions" });
  assert.equal(expired.status, 400); assert.equal(app.aiCalls.length,4);
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
  assert.equal(app.aiCalls.length, 3);
  assert.equal(app.calls.length, 30);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1");
  assert.equal(app.kv.writes.length, 4);
  assert(![...app.kv.values.keys()].some(key => key.startsWith("v5:topic:") || key.startsWith("ai:search:")));
});

test("semantic membership constrains semantic candidates while cited matches are independently checked", async () => {
  const papers = questionPapers().results.slice().reverse();
  const permitted = papers.slice(0, 1);
  const app = setup(undefined, { source: url => {
    if (url.searchParams.has("search.semantic")) return Response.json({ results: papers });
    if (url.searchParams.get("filter")?.includes("openalex_id:")) return Response.json({ results: permitted.map(item => ({ id: item.id })) });
    return null;
  } });
  const result = await (await app.search()).json();
  assert.equal(result.papersKind, "checked"); assert.equal(result.papers.length, fixture("papers").results.length);
  assert.equal(result.papers[0].title, questionPapers().results[0].display_name);
  assert(app.calls.every(url => !url.searchParams.has("rerank")));
});

test("topic-changing tightening re-plans once and asks for a rephrase", async () => {
  const wider = clone(data.plan); wider.topic = "another research topic";
  const app = setup([data.plan, judgments(10), wider, wider]);
  const result = await (await app.search()).json();
  assert.equal(result.error,"rephrase_required"); assert(!result.clarification); assert(!result.papers);
  assert.equal(app.aiCalls.length, 5);
  assert.equal(app.calls.filter(url => url.searchParams.get("select") === "id,display_name").length, 2);
  assert.equal(app.kv.values.get("count:2026-11-02"), "1");
});

test("simultaneous identical questions coalesce within an isolate without duplicate inference/writes", async () => {
  const app = setup();
  const responses = await Promise.all([app.search(), app.search(), app.search()]);
  assert(responses.every(response => response.status === 200));
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert(bodies.every(body => body.id === bodies[0].id));
  assert.equal(app.aiCalls.length,4); assert.equal(app.calls.length, 20); assert.equal(app.kv.writes.length, 8);
});

test("restored context for edited filters clears evidence but retains a switchable place", async () => {
  const app = setup(); const initial = await (await app.search()).json();
  const query = compileAIPlan(data.plan, 2026).query;
  const changed = normaliseQuery(query.name, "", "", query.includeTerms, 2021, 2025, 2026, "", SEARCH_PRESETS, query);
  const params = queryParams(changed); params.set("understanding", initial.understanding.key);
  const response = await app.worker.fetch(new Request("http://localhost/api/topic?" + params), app.env);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.understanding.check, null); assert.equal(body.understanding.place.mode, "authored");
  assert.equal(app.aiCalls.length,4);
});

test("deploy configuration pins only the free model and the 70/70 caps", () => {
  const configuration = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(configuration, /NEW_TOPICS_PER_DAY = "70"/);
  assert.match(configuration, /AI_SEARCHES_PER_DAY = "70"/);
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

test("a single place keyword is dropped when the same place is already 'written in'", async () => {
  const { tidyPlan } = await import("./ai.js");
  const plan = { topic: "gamification", synonyms: [], excludeTerms: [],
    includeGroups: [{ terms: ["pupils", "primary school"] }, { terms: ["saudi arabia"] }, { terms: ["Egypt"] }],
    place: { codes: ["SA"], mode: "authored" }, years: { from: 2010, to: null } };
  assert.deepEqual(tidyPlan(plan, 2026).includeGroups, [{ terms: ["pupils", "primary school"] }, { terms: ["Egypt"] }]);
});

// Step 16 regressions: fixture title judgments are deliberately explicit, never network calls.
test("canonicalization preserves broad user words and lets the planner choose expansions", async () => {
  const { tidyPlan } = await import("./ai.js");

  const failing = fixture("checked-evidence"), tidy = tidyPlan(failing.plan, 2026);
  assert.deepEqual(tidy.synonyms, failing.plan.synonyms);
  assert.deepEqual(tidy.includeGroups, failing.plan.includeGroups);
  assert.deepEqual(tidyPlan({...failing.plan,includeGroups:[{terms:["attention","focus"]}]},2026).includeGroups,[{terms:["attention","focus"]}]);
});

test("tightening can replace group phrases and synonyms but never changes topic/place/years or drops populations", async () => {
  const { tidyPlan } = await import("./ai.js");
  const { isTighterPlan } = await import("./lib.js");
  const initial = tidyPlan(fixture("checked-evidence").plan, 2026), candidate = clone(initial);
  candidate.synonyms = ["social networking platforms"];
  candidate.includeGroups[0].terms = ["sustained attention", "attention problems"];
  candidate.excludeTerms = ["gambling marketing"];
  assert.equal(isTighterPlan(initial, candidate, 2026), true);
  for (const change of [p=>{p.topic="digital media"},p=>{p.place.codes=["AE"]},p=>{p.years.from=2020},p=>{p.includeGroups.pop()},p=>{p.includeGroups[1]={preset:"students"}}]) {
    const unsafe = clone(candidate); change(unsafe); assert.equal(isTighterPlan(initial, unsafe, 2026), false);
  }
});

test("the exact social-media/kids/attention failure never shows rejected papers or their experts, and warns about unreliable growth", async () => {
  const failing = fixture("checked-evidence"), badRevision = clone(failing.plan); badRevision.years.from = 2020;
  const app = setup([failing.plan, {onTopic:[true,true,true,true,false,false,false,false,false,false,true,true,true,true,true,true,true,true,true,false]}, failing.plan, {onTopic:failing.accepted}], { source: url => {
    const p = url.searchParams;
    if (p.has("sample")) return Response.json({results:p.get("filter").includes("from_publication_date:2010")?failing.early:failing.late});
    if (p.has("search.semantic")) return Response.json({results:failing.candidates});
    if (p.get("filter").includes("openalex_id:")) return Response.json({results:failing.candidates.map(({id})=>({id}))});
    if (p.get("per_page")==="30" || p.get("per_page")==="50") return Response.json({results:failing.candidates});
    if(p.get("group_by")==="authorships.author.id")return Response.json({group_by:[{key:"https://openalex.org/A780000001",key_display_name:"Relevant researcher",count:120},{key:"https://openalex.org/A780000002",key_display_name:"Gambling marketing researcher",count:150}]});
    return null;
  } });
  const result = await (await app.search({sentence:failing.question})).json();
  assert.equal(result.understanding.mode, "ai");
  assert.equal(result.papersKind, "checked");
  assert.equal(result.evidence.accepted, 2);
  assert.equal(result.papers.length, 2);
  for (const paper of result.papers) assert(!/COVID|vaccine|loneliness|gambling/i.test(paper.title));
  assert.deepEqual(result.experts.map(({name,count})=>({name,count})),[{name:"Relevant researcher",count:120}]);
  assert.equal(result.experts[0].openalexUrl, "https://openalex.org/A780000001");
  assert.equal(result.understanding.check.matched, 13); assert.equal(result.understanding.check.total,20);
  assert.equal(result.understanding.check.lowPrecision,false); assert(result.understanding.check.trendDistorted);
  assert(result.evidence.notices.includes("Few papers match this question exactly"));
  assert(!result.evidence.notices.includes("Many matching papers may be off-topic; narrow the search for reliable numbers"));
  assert(!result.evidence.notices.includes("The trend may be distorted by off-topic papers."));
  assert(!result.headline.includes("off-topic"));
  const core = JSON.parse(app.kv.values.get("v5:topic:"+result.id)).topic;
  assert.deepEqual(result.kpis,core.kpis); assert.deepEqual(result.years,core.years); assert.deepEqual(result.countries,core.countries);
  assert(!core.evidence); assert(!core.understanding);
  assert(app.calls.length<=30);
  const cached=JSON.parse(app.kv.values.get(result.understanding.key));
  assert(cached.budget.neurons<=600); assert(cached.budget.calls<=10);
  const before=app.calls.length, aiBefore=app.aiCalls.length;
  const again=await (await app.search({sentence:failing.question})).json();
  assert.deepEqual(again.papers,result.papers); assert.deepEqual(again.experts,result.experts);
  assert.equal(app.calls.length,before);assert.equal(app.aiCalls.length,aiBefore);
});

test("stratified sampling has disjoint year windows, seeds, exact thresholds and honest missing periods", async () => {
  const { reliabilitySamples, reliabilityCheck } = await import("./lib.js");
  const samples=reliabilitySamples(normaliseQuery("social media","","","",2010,2025,2026),2026,1234);
  assert.equal(samples.length,2); assert(samples[0].params.filter.includes("to_publication_date:2017-12-31"));
  assert(samples[1].params.filter.includes("from_publication_date:2018-01-01"));
  assert(samples.every(item=>item.params.sample==="10" && item.params.seed==="1234" && !item.params.sort));
  const exact=reliabilityCheck({matched:7,total:10},{matched:7,total:10});assert.equal(exact.lowPrecision,false);
  assert.equal(reliabilityCheck({matched:3,total:4},{matched:2,total:4}).trendDistorted,false);
  assert.equal(reliabilityCheck({matched:3,total:4},{matched:1,total:4}).trendDistorted,true);
  assert.equal(reliabilityCheck({matched:0,total:0},{matched:0,total:0}).lowPrecision,false);
  assert.equal(reliabilitySamples(normaliseQuery("topic","","","",2026,2026,2026),2026).length,1);
});

test("candidate relevance is batched by 25, deduped and sorted by citations with ten papers maximum", async () => {
  const f=fixture("checked-evidence");
  const papers=Array.from({length:60},(_,i)=>({...f.candidates[0],id:"https://openalex.org/W"+(790000000+i),display_name:"Social media and childhood attention "+i,cited_by_count:i}));
  const app=setup([f.plan,judgments(20)], { source:url=>{
    const p=url.searchParams;
    if(p.has("sample")){const early=p.get("filter").includes("from_publication_date:2010");return Response.json({results:Array.from({length:10},(_,i)=>({id:"https://openalex.org/W"+(early?80000000+i:81000000+i),display_name:"Social media and childhood attention "+i}))});}
    if(p.get("per_page")==="50")return Response.json({results:papers.slice(0,50)});
    if(p.get("group_by")==="authorships.author.id")return Response.json({group_by:[{key:"https://openalex.org/A780000001",key_display_name:"Relevant researcher",count:600}]});
    if(p.has("search.semantic"))return Response.json({results:papers.slice(30)});
    if(p.get("filter").includes("openalex_id:"))return Response.json({results:papers.slice(30).map(({id})=>({id}))});
    if(p.get("per_page")==="30")return Response.json({results:papers.slice(0,30)});
    return null;
  }});
  const body=await (await app.search({sentence:f.question})).json();
  assert.equal(body.evidence.candidates,60);assert.equal(body.evidence.accepted,60);assert.equal(body.papers.length,10);
  assert.deepEqual(body.papers.map(p=>p.citations),[59,58,57,56,55,54,53,52,51,50]);
  assert(app.aiCalls.filter(c=>payload(c.params).titles).every(c=>payload(c.params).titles.length<=25));
  assert.equal(body.experts[0].count,600);
});

test("measured neuron ledger blocks at 9000 and refunds the in-flight reservation",async()=>{
 const {AI_DAILY_CAP,AI_DAILY_NEURONS}=await import("./ai.js");assert(AI_DAILY_CAP>=40);assert.equal(AI_DAILY_NEURONS,9000);
 const app=setup();app.kv.values.set("ai:usage:2026-11-02",JSON.stringify({used:9000,reserved:0}));
 const response=await app.search();assert.equal(response.status,503);assert.equal((await response.json()).aiReason,"daily_neuron_limit");assert.equal(app.aiCalls.length,0);
 const good=setup();const body=await(await good.search()).json(),ledger=JSON.parse(good.kv.values.get("ai:usage:2026-11-02"));
 assert.equal(ledger.reserved,0);assert.equal(ledger.used,body.aiUsage.neurons);assert(body.aiUsage.measured);
});

test("a failed display check after one retry shows no unchecked lists and saves no evidence",async()=>{
 const app=setup([data.plan,judgments(18),new Error("quota"),new Error("quota")]);
 const response=await app.search(),body=await response.json();assert.equal(response.status,503);assert.equal(body.error,"ai_unavailable");assert(!body.papers);assert(!body.experts);
 assert(![...app.kv.values.keys()].some(key=>key.startsWith("ai:search:")));
});

test("rejected papers cannot reappear through a fallback after checking fails",async()=>{
 const app=setup([data.plan,judgments(18),new Error("quota"),new Error("quota")]);const response=await app.search();
 assert.equal(response.status,503);assert(!((await response.json()).papers));
});

test("changed candidate titles are checked anew even if their source ID appeared in a sample", async () => {
  const papers=questionPapers().results;
  const app=setup([data.plan,judgments(20),{onTopic:[true,false,false]}],{source:url=>{
    const p=url.searchParams;
    if(p.has("sample")) {
      const early=p.get("filter").includes("from_publication_date:2020");
      return Response.json({results:Array.from({length:10},(_,i)=>({id:early&&i===0?papers[0].id:"https://openalex.org/W"+(early?8000000+i:9000000+i),display_name:"Gene editing in children original sample "+i}))});
    }
    return null;
  }});
  // The two display candidates must both be reviewed despite one reused ID.
  app.env.AI.run=async(_model,params)=>{
    const titles=payload(params).titles;
    if(payload(params).task==="self-check")return{response:{ok:true},usage:{neurons:1}};
    if(!titles)return{response:sourced(data.plan,data.sentence),usage:{neurons:1}};
    if(titles.length===20)return{response:JSON.stringify({pass:Array.from({length:20},(_,i)=>i+1)}),usage:{neurons:1}};
    assert.equal(titles.length,2);return{response:JSON.stringify({pass:[2]}),usage:{neurons:1}};
  };
  const result=await (await app.search()).json();
  assert.equal(result.papersKind,"checked");assert.equal(result.papers.length,1);
  assert.equal(result.papers[0].title,papers[1].display_name);
});

test("reordered AND groups are valid tightenings and corrupt cached evidence earns no checked claim", async () => {
  const { tidyPlan }=await import("./ai.js"), { isTighterPlan }=await import("./lib.js");
  const first=tidyPlan(fixture("checked-evidence").plan,2026), revised=clone(first);
  revised.includeGroups.reverse();assert.equal(isTighterPlan(first,revised,2026),true);
  const app=setup(), initial=await (await app.search()).json();
  const record=JSON.parse(app.kv.values.get(initial.understanding.key));record.check.early.matched=999;
  app.kv.values.set(initial.understanding.key,JSON.stringify(record));
  const params=queryParams(compileAIPlan(data.plan,2026).query);params.set("understanding",initial.understanding.key);params.set("cache","only");
  const restored=await (await app.worker.fetch(new Request("http://localhost/api/topic?"+params),app.env)).json();
  assert.equal(restored.understanding.mode,"unavailable");assert(!restored.understanding.check);assert.notEqual(restored.papersKind,"checked");
});

test("the original 613-neuron/eight-attempt dashboard case no longer blocks checked searches",async()=>{
  const f=fixture("checked-evidence");
  const app=setup([f.plan,judgments(20)],{source:url=>{
    if(!url.searchParams.has("sample"))return null;
    const early=url.searchParams.get("filter").includes("from_publication_date:2010");
    return Response.json({results:Array.from({length:10},(_,i)=>({id:"https://openalex.org/W"+(early?9010000+i:9020000+i),display_name:"Social media use and attention span in children"}))});
  }});
  app.kv.values.set("ai:count:2026-11-02","8");app.kv.values.set("ai:usage:2026-11-02",JSON.stringify({used:613,reserved:0}));
  const response=await app.search({sentence:f.question});assert.equal(response.status,200);const body=await response.json();assert.equal(body.understanding.mode,"ai");
  assert.equal(app.kv.values.get("ai:count:2026-11-02"),"9");assert(JSON.parse(app.kv.values.get("ai:usage:2026-11-02")).used<9000);
});


test("OpenAlex reporting counts every actual source attempt, with a distinct estimate when no USD is reported",async()=>{
 const app=setup(),body=await(await app.search()).json(),cost=body.openalexUsage;
 assert.equal(cost.calls,app.calls.length);assert.equal(cost.calls,20);assert(cost.measuredCalls);
 assert.equal(cost.reportedUsd,null);assert.equal(cost.estimatedUsd,.020);assert.equal(cost.costBasis,"estimate_from_spec");assert.equal(body.aiUsage.sourceCalls,20);
 assert.equal(cost.byQuery.checkearly,1);assert.equal(cost.byQuery.checklate,1);assert.equal(cost.byQuery.expertCandidates,1);assert.equal(cost.byStage.reliability,2);assert(cost.byStage.report>0&&cost.byStage.candidates>0&&cost.byStage.experts>0);
 assert.equal(cost.attempts.length,20);assert(!JSON.stringify(cost).includes(app.env.OPENALEX_KEY));assert(!JSON.stringify(cost).includes("api_key"));
 const cached=await(await app.search()).json();assert.equal(cached.openalexUsage.calls,0);assert.equal(cached.openalexUsage.reportedUsd,0);assert.equal(cached.openalexUsage.estimatedUsd,0);assert.equal(cached.aiUsage.sourceCalls,0);
});
test("explicit provider USD is summed separately from SPEC estimates, including charged retry responses",async()=>{
 let semanticAttempts=0;
 const app=setup(undefined,{costUsd:.00025,source:url=>url.searchParams.has("search.semantic")&&semanticAttempts++===0?Response.json({}, {status:429,headers:{"Retry-After":"0","x-ratelimit-cost-usd":"0.0001"}}):null});
 const body=await(await app.search()).json(),cost=body.openalexUsage;
 assert.equal(cost.calls,app.calls.length);assert.equal(cost.calls,21);assert.equal(cost.reportedCalls,21);assert.equal(cost.reportedUsd,.0051);assert.equal(cost.estimatedUsd,.021);assert.equal(cost.costBasis,"provider_reported_usd");
 assert.equal(cost.byQuery.semanticPapers,2);assert(cost.attempts.some(item=>item.status===429&&item.reportedUsd===.0001));
});
test("unitless source cost headers are retained as signals, never invented dollar charges",async()=>{
 const app=setup(undefined,{unitlessCost:100}),body=await(await app.search()).json();
 assert.equal(body.openalexUsage.reportedUsd,null);assert.equal(body.openalexUsage.costBasis,"estimate_from_spec");assert(body.openalexUsage.attempts.every(item=>item.unitlessCostSignal===100));
});
test("source work before an AI failure remains visible in cost reporting",async()=>{
 const app=setup([data.plan,judgments(18),new Error("quota"),new Error("quota")],{costUsd:.00025});
 const response=await app.search(),body=await response.json();assert.equal(response.status,503);assert.equal(body.openalexUsage.calls,app.calls.length);assert(body.openalexUsage.calls>0);assert.equal(body.openalexUsage.reportedUsd,app.calls.length*.00025);assert.equal(body.aiUsage.sourceCalls,app.calls.length);
});
test("tightening samples and source transport failures count without hiding partial costs",async()=>{
 const tighter=clone(data.plan);tighter.synonyms=["CRISPR"];
 const app=setup([data.plan,judgments(12),tighter,judgments(18)],{costUsd:.00025,source:url=>{if(url.searchParams.has("search.semantic"))throw new Error("network failure");return null;}});
 const body=await(await app.search()).json(),cost=body.openalexUsage;
 assert.equal(cost.calls,app.calls.length);assert.equal(cost.byStage.tighteningReliability,2);assert(cost.attempts.some(item=>item.query==="semanticPapers"&&item.status===null));assert.equal(cost.reportedUsd,null);assert(cost.partialReportedUsd>0);assert.equal(cost.estimatedUsd,cost.calls*.001);
});
