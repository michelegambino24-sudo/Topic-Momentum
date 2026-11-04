const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = (name) => readFileSync(__dirname + "/" + name, "utf8");
const settle = () => new Promise(setImmediate);

function setup(fetch, saved = null, initialHash = "#search", summaries = null, aiEnabled = false) {
  const nodes = new Map();
  function element() {
    return { value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, focus() {}, append() {}, click() {}, remove() {} };
  }
  const doc = element();
  doc.getElementById = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  doc.querySelectorAll = () => [...nodes.values()];
  doc.createElement = element;
  doc.body = element();
  const stored = new Map(saved ? [["topic-momentum:last-topic", saved]] : []);
  if (summaries) stored.set("topic-momentum:my-library", JSON.stringify(summaries));
  let copied;
  const hashes = [initialHash];
  let index = 0;
  const location = {
    protocol: "file:", hostname: "",
    get hash() { return hashes[index]; },
    set hash(value) {
      if (hashes[index] === value) return;
      hashes.splice(++index, hashes.length, value);
      queueMicrotask(() => context.windowListeners.hashchange());
    }
  };
  const history = {
    replaceState(state, title, hash) { hashes[index] = hash; },
    back() { if (index > 0) { index--; context.windowListeners.hashchange(); } },
    forward() { if (index + 1 < hashes.length) { index++; context.windowListeners.hashchange(); } }
  };
  const context = vm.createContext({ AI_SEARCH_ENABLED: aiEnabled, document: doc, location, history, URL, URLSearchParams, Blob, AbortController,
    Intl, TextEncoder, console, fetch, setTimeout: () => 1, clearTimeout() {},
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  });
  vm.runInContext('window = globalThis; windowListeners = {}; window.addEventListener = (type, fn) => { windowListeners[type] = fn; };', context);
  for (const name of ["config.js", "sample-topic.js", "map-data.js", "search-presets.js", "places.js", "query-parser.js", "map-feedback.js", "app.js"]) vm.runInContext(source(name), context);
  return { context, stored, navigate(hash) { context.location.hash = hash; }, get: doc.getElementById, copied: () => copied,
    submit() { doc.getElementById("search-form").listeners.submit({ preventDefault() {} }); },
    click(dataset) { const button = { dataset, setAttribute() {} }; doc.listeners.click({ target: { closest: () => button } }); }
  };
}

function report(app) {
  return { ...JSON.parse(JSON.stringify(app.context.SAMPLE_TOPIC)), name: "fixture topic", id: "fixture topic", countries: [], subtopics: [], regionalCounts: { uae: 0, gcc: 12 } };
}

function libraryFixture() {
  const parent = { id: "zeta moss logic|moon circuits", name: "zeta moss logic", synonyms: ["moon circuits"],
    field: "Computer Science", momentum: "Accelerating", growth: .4, total: 1, updated: "2026-10-01", parent: null,
    children: ["zeta moss logic|moon circuits|primary_topic:T123"], spark: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  return [parent,
    { id: "alpha spore mapping", name: "alpha spore mapping", synonyms: [], field: "Biology", momentum: "Growing", growth: .1,
      total: 2, updated: "2026-10-29", parent: null, children: [] },
    { id: parent.children[0], name: "Orbital processors", synonyms: ["moon circuits"], field: parent.field, momentum: "Stable", growth: .01,
      total: 1, updated: parent.updated, parent: parent.id, children: [], subtopicId: "T123", searchTerms: { name: parent.name, synonyms: parent.synonyms } }
  ];
}

const libraryLinks = (app) => [...app.get("library-cards").innerHTML.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));

test("More options stays collapsed on restoration, preserves manual opening and reveals invalid hidden inputs", async () => {
  const app = setup(() => assert.fail("No request expected"));
  assert.equal(app.get("search-options").open, false);
  app.get("search-options").open = true;
  app.click({ rangePreset: "2024" });
  assert.equal(app.get("search-options").open, true);
  assert.equal(app.get("to-input").value, "");
  app.get("search-options").open = false;
  app.get("from-input").value = "1999";
  app.submit(); await settle();
  assert.equal(app.get("search-options").open, true);
  for (const extra of [{ synonyms: ["alternate"] }, { includeTerms: ["child"] }, { from: 2023, to: null }, { from: 2010, to: 2020 }]) {
    const saved = { ...report(app), synonyms: [], ...extra };
    const restored = setup(() => assert.fail("Restore must stay offline"), JSON.stringify(saved));
    assert.equal(restored.get("search-options").open, false);
  }
});

test("Refine bar applies subfields, regions and synonyms, retaining undo, saved links, history and CSV", async () => {
  const { normaliseQuery, buildQueries, shapeTopic, presentReport } = await import("../worker/lib.js");
  const fixture = id => JSON.parse(readFileSync(__dirname + `/../worker/fixtures/${id}.json`, "utf8"));
  const calls = [];
  const fetch = async url => {
    const params = new URL(url).searchParams; calls.push(params);
    const query = normaliseQuery(params.get("q"), params.get("syn"), params.get("subtopic") || "", ["include", "include2", "include3"].map(key => (params.get(key) || "").split(",")), params.get("from"), params.get("to") || "", 2026, params.get("subfield") || "");
    if (params.has("subtopic")) query.subtopicName = params.get("subtopicName");
    const responses = Object.fromEntries(buildQueries(query, 2026).map(({ id }) => [id, fixture(id)]));
    const data = presentReport(shapeTopic(query, responses, new Date("2026-10-31")));
    return { ok: true, json: async () => data };
  };
  const app = setup(fetch);
  assert.equal(app.get("refine-bar").hidden, true);
  app.get("topic-input").value = "inheritance law";
  app.submit(); await settle(); await settle();
  const original = app.context.location.hash;
  assert.equal(app.get("refine-bar").hidden, false);
  assert.match(app.get("refine-chips").innerHTML, /Only Law · 62%/);
  assert.equal((app.get("refine-chips").innerHTML.match(/data-refine=/g) || []).length, 5);
  app.click({ refine: "0" }); await settle(); await settle();
  assert.equal(calls.at(-1).get("subfield"), "3308");
  assert.equal(app.get("topic-name").textContent, "Inheritance law, Law papers");
  assert.match(app.get("headline").textContent, /within Law/);
  assert(!app.get("refine-chips").innerHTML.includes("Only Law"));
  assert.equal(app.get("back-parent").href, original);
  assert.equal(app.get("back-parent").textContent, "Back to Inheritance law");
  const selected = app.context.location.hash;
  assert.equal(new URLSearchParams(selected.slice(1)).get("subfield"), "3308");
  const count = calls.length;
  app.context.history.back(); await settle();
  assert.equal(app.context.location.hash, original);
  app.context.history.forward(); await settle();
  assert.equal(app.context.location.hash, selected);
  assert.equal(calls.length, count);
  const restored = setup(() => assert.fail("Local restoration stays offline"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("topic-name").textContent, "Inheritance law, Law papers");
  assert.equal(restored.get("back-parent").href, original);
  assert.equal(restored.get("search-options").open, false);
  const summaries = JSON.parse(app.stored.get("topic-momentum:my-library"));
  const saved = summaries.find(item => item.id.includes("|subfield:"));
  assert.equal(saved.subfieldId, "3308");
  app.navigate("#library"); await settle();
  const selectedLink = libraryLinks(app).find(link => new URLSearchParams(link.slice(1)).get("subfield") === "3308");
  assert(selectedLink);
  app.navigate(selectedLink); await settle(); await settle();
  assert.equal(calls.at(-1).get("cache"), "only");
  assert.equal(calls.at(-1).get("subfield"), "3308");
  assert.equal(app.get("back-parent").href, original);
  let blob;
  app.context.URL = class extends URL { static createObjectURL(value) { blob = value; return "blob:fixture"; } static revokeObjectURL() {} };
  app.get("export-csv").listeners.click();
  const csv = await blob.text();
  assert(csv.startsWith("sample_data,range,year,papers,subfield_id,subfield\r\n"));
  assert.match(csv, /,3308,"Law"\r\n/);
  app.get("from-input").value = "2020"; app.get("to-input").value = "2025";
  app.submit(); await settle(); await settle();
  assert.equal(calls.at(-1).get("subfield"), "3308");
  app.click({ subtopic: "T123", title: "Measured area" }); await settle(); await settle();
  assert.equal(calls.at(-1).get("subfield"), "3308");
  assert.match(app.get("topic-name").textContent, /Measured area, Law papers/);
  app.navigate(original); await settle();
  app.click({ refine: "2" }); await settle(); await settle();
  assert.equal(calls.at(-1).get("include"), app.context.TMM_SEARCH_PRESETS.gcc.terms.join(","));
  assert.equal(app.get("back-parent").href, original);
  assert.equal(app.get("search-options").open, false);
  app.navigate(original); await settle();
  app.click({ refine: "4" }); await settle(); await settle();
  assert(calls.at(-1).get("syn"));
  assert.equal(app.get("back-parent").href, original);
  app.get("topic-input").value = "different topic";
  app.get("topic-input").listeners.input();
  app.submit(); await settle(); await settle();
  assert.equal(calls.at(-1).get("subfield"), null);
});

test("Refine chips retain full accessible names, ignore repeated activation and hide empty suggestions", async () => {
  let data, release, count = 0;
  const app = setup(async () => {
    count++;
    if (count > 1) await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => data };
  });
  data = { ...report(app), refinements: [{ kind: "subfield", id: "3312", name: "Sociology and Political Science", label: "Only Sociology and Pol… · 62%" }] };
  app.submit(); await settle();
  assert.match(app.get("refine-chips").innerHTML, /title="Only Sociology and Political Science/);
  assert.match(app.get("refine-chips").innerHTML, /aria-label="Only Sociology and Political Science/);
  app.click({ refine: "0" }); app.click({ refine: "0" });
  assert.equal(count, 2);
  data = { ...data, id: "fixture topic|subfield:3312", subfieldId: "3312", selectedSubfield: { id: "3312", name: "Sociology and Political Science" }, refinements: [] };
  release(); await settle(); await settle();
  assert.equal(app.get("refine-bar").hidden, false);
  assert.equal(app.get("refine-chips").hidden, true);
  assert.match(source("styles.css"), /\.refine-chips\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
  assert(source("app.html").indexOf('id="refine-bar"') < source("app.html").indexOf('id="report-content"'));
});

test("a failed refinement leaves the displayed report and next ordinary search unrestricted", async () => {
  const calls = []; let data;
  const app = setup(async url => {
    const params = new URL(url).searchParams; calls.push(params);
    if (params.has("subfield")) return { ok: false, json: async () => ({ message: "Daily limit reached. Try again tomorrow or browse the Library." }) };
    return { ok: true, json: async () => data };
  });
  data = { ...report(app), refinements: [{ kind: "subfield", id: "3308", name: "Law", label: "Only Law · 62%" }] };
  app.submit(); await settle();
  const original = app.context.location.hash;
  app.click({ refine: "0" }); await settle();
  assert.equal(app.context.location.hash, original);
  assert.match(app.get("status").textContent, /Daily limit reached/);
  app.submit(); await settle();
  assert.equal(calls.at(-1).get("subfield"), null);
});

test("expert and country expansion reveals every record in place without another request", async () => {
  let data, calls = 0;
  const app = setup(async () => { calls++; return { ok: true, json: async () => data }; });
  data = { ...report(app), papersKind:"checked", evidence:{version:3,accepted:8,candidates:10,notices:[]},understanding:{mode:"ai",check:{matched:20,total:20}} };
  data.experts = Array.from({ length: 8 }, (_, i) => ({ name: "Expert " + i, count: 20 - i, openalexUrl: "https://openalex.org/A" + (100 + i) }));
  data.countries = Array.from({ length: 9 }, (_, i) => ({ name: "Country " + i, count: 30 - i, code: "ZZ", gcc: false }));
  app.submit(); await settle();
  const hash = app.context.location.hash;
  assert.equal((app.get("experts").innerHTML.match(/<li>/g) || []).length, 5);
  assert.equal((app.get("countries").innerHTML.match(/class="country-row"/g) || []).length, 5);
  app.get("experts-toggle").listeners.click();
  app.get("countries-toggle").listeners.click();
  assert.equal((app.get("experts").innerHTML.match(/<li>/g) || []).length, 8);
  assert.equal((app.get("countries").innerHTML.match(/class="country-row"/g) || []).length, 9);
  assert.equal(app.get("experts-toggle").textContent, "Show less");
  assert.equal(app.context.location.hash, hash);
  assert.equal(calls, 1);
  app.get("experts-toggle").listeners.click();
  assert.equal((app.get("experts").innerHTML.match(/<li>/g) || []).length, 5);
  assert.equal(data.experts.length, 8);
  assert.equal(data.countries.length, 9);
});

test("Save to My library is idempotent, restores a removed report and reports storage failures truthfully", () => {
  const initial = setup(() => assert.fail("Sample stays offline"));
  const data = report(initial);
  const app = setup(() => assert.fail("Saving must stay offline"), JSON.stringify(data));
  assert.equal(app.get("save-report").textContent, "Save to My library");
  app.get("save-report").listeners.click();
  app.get("save-report").listeners.click();
  assert.equal(JSON.parse(app.stored.get("topic-momentum:my-library")).length, 1);
  assert.equal(app.get("save-report").textContent, "Saved");
  app.click({ removeReport: data.id });
  assert.equal(app.get("save-report").textContent, "Save to My library");
  app.context.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  app.get("save-report").listeners.click();
  assert.equal(app.get("save-report").textContent, "Save to My library");
  assert.match(app.get("status").textContent, /could not be saved/);
});

test("line chart marks only the current year as partial and preserves all exact counts", async () => {
  let data;
  const year = new Date().getFullYear();
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = { ...report(app), from: year - 2, to: null, years: [{ year: year - 2, count: 17 }, { year: year - 1, count: 24 }, { year, count: 6 }] };
  app.submit(); await settle();
  const chart = app.get("year-chart").innerHTML;
  assert.equal((chart.match(/class="chart-line partial-year"/g) || []).length, 1);
  assert.match(chart, new RegExp(year + ": 6 papers \\(year to date\\)"));
  assert(chart.includes((year - 1) + ": 24 papers"));
  assert(!chart.includes("<rect"));
  assert.equal((app.get("kpis").innerHTML.match(/class="kpi"/g) || []).length, 3);
  data = { ...data, to: year - 1 };
  app.submit(); await settle();
  assert(!app.get("year-chart").innerHTML.includes('class="chart-line partial-year"'));
  assert(!app.get("year-chart").innerHTML.includes("year to date)</title>"));
});

test("open ranges survive combined searches, sub-topics, exploration, cache-only cards, reload and history", async () => {
  const { normaliseQuery, shapeTopic } = await import("../worker/lib.js");
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field", "subfields"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const calls = [];
  const fetch = async (url) => {
    const params = new URL(url).searchParams;
    calls.push(params);
    if (new URL(url).pathname === "/api/library") return { ok: true, json: async () => [] };
    const query = normaliseQuery(params.get("q"), params.get("syn") || "", params.get("subtopic") || "", params.get("include") || "", params.get("from") || params.get("period") || 2010, params.get("to") || "");
    if (query.subtopicId) Object.assign(query, { subtopicName: params.get("subtopicName"), parent: normaliseQuery(params.get("q"), params.get("syn") || "", "", params.get("include") || "", query.from, query.to).id });
    return { ok: true, json: async () => shapeTopic(query, responses, new Date("2026-11-01T12:00:00Z")) };
  };
  const app = setup(fetch);
  app.get("topic-input").value = "moss";
  app.get("include-input").value = "child,children";
  app.get("from-input").value = "2023";
  app.submit(); await settle();
  const mainHash = app.context.location.hash;
  assert.equal(calls[0].get("from"), "2023");
  assert.equal(app.get("topic-name").textContent, "Moss + child / children");
  assert.match(app.get("headline").textContent, /since 2023/);
  assert.match(app.get("kpis").innerHTML, /Average yearly increase in papers since 2023/);
  assert(!app.get("year-chart").innerHTML.includes("2022:"));
  assert(app.get("year-chart").innerHTML.includes("2023:"));
  assert.equal(app.get("subtopics-note").textContent, "Research areas inside this topic. Growth compares the second half of the period with the first. Click a row to open it. Rows with an arrow had fewer than 20 papers in the earlier half or growth above 300%, so we show the earlier and later counts instead of a growth percentage.");
  assert.equal(app.get("experts-note").textContent, "Authors with the most papers on this topic since 2023. A starting point for speakers, not a ranking of quality. Only papers in journals on the Leiden Ranking core list are counted.");
  app.click({ subtopic: "T123", title: "Orbital logic" }); await settle();
  assert.equal(calls.at(-1).get("from"), "2023");
  assert.equal(calls.at(-1).get("include"), "child,children");
  assert.equal(new URLSearchParams(app.get("back-parent").href.slice(1)).get("from"), "2023");
  app.click({ nextTerm: "genetics" }); await settle();
  assert.equal(calls.at(-1).get("from"), "2023");
  assert.equal(calls.at(-1).get("include"), "child,children");
  app.context.history.back(); await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic + child / children");
  app.context.history.back(); await settle();
  assert.equal(app.context.location.hash, mainHash);
  app.get("from-input").value = "2025";
  app.submit(); await settle();
  assert.equal(app.get("subtopics-heading").textContent, "Sub-topics");
  assert.equal(app.get("subtopics-metric").textContent, "Growth");
  assert(!app.get("subtopics").innerHTML.includes("%"));
  assert(!app.get("subtopics").innerHTML.includes("New"));
  assert.equal(app.get("subtopics").innerHTML.includes("Growth unavailable"), true);
  const restored = setup(() => assert.fail("Restoring stays offline"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("from-input").value, "2025");
  app.navigate("#library"); await settle();
  const links = libraryLinks(app);
  assert(links.some((link) => new URLSearchParams(link.slice(1)).get("from") === "2025"));
  const child = links.find((link) => new URLSearchParams(link.slice(1)).has("sub"));
  const reopened = setup(fetch, null, child);
  await settle();
  assert.equal(calls.at(-1).get("cache"), "only");
  assert.equal(calls.at(-1).get("from"), "2023");
  assert.equal(calls.at(-1).get("include"), "child,children");
  assert.equal(reopened.get("topic-name").textContent, "Orbital logic + child / children");
});

test("quick-fill years clear To without searching and invalid ranges show plain errors", async () => {
  const app = setup(() => assert.fail("Quick-fill and validation must not request data"));
  assert.equal(app.get("from-input").value, "2010");
  assert.equal(app.get("to-input").value, "");
  for (const year of [2010, 2020, 2023, 2024, 2025]) {
    app.get("to-input").value = "2025";
    app.click({ rangePreset: String(year) });
    assert.equal(app.get("from-input").value, String(year));
    assert.equal(app.get("to-input").value, "");
  }
  const currentYear = new Date().getFullYear();
  for (const [from, to, message] of [["", "", "From year"], ["1999", "", "From year"], [String(currentYear + 1), "", "From year"], ["2020", "bad", "To year"], ["2020", String(currentYear + 1), "To year"], ["2025", "2020", "The From year must be"]]) {
    app.get("from-input").value = from;
    app.get("to-input").value = to;
    app.submit(); await settle();
    assert(app.get("status").textContent.includes(message));
    assert.equal(app.get("from-input").disabled, false);
  }
  assert(source("app.html").includes('data-range-preset="2024"'));
});

test("bounded ranges keep both years across report links, exploration, My library, restoration and CSV", async () => {
  const { normaliseQuery, shapeTopic } = await import("../worker/lib.js");
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field", "subfields"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const calls = [];
  const fetch = async (url) => {
    const params = new URL(url).searchParams;
    if (new URL(url).pathname === "/api/library") return { ok: true, json: async () => [] };
    calls.push(params);
    const q = normaliseQuery(params.get("q"), params.get("syn") || "", params.get("subtopic") || "", params.get("include") || "", params.get("from") || 2010, params.get("to") || "", 2026);
    if (q.subtopicId) Object.assign(q, { subtopicName: "Orbital logic", parent: normaliseQuery(params.get("q"), "", "", "child", 2015, 2020).id });
    return { ok: true, json: async () => shapeTopic(q, responses, new Date("2026-11-01T12:00:00Z")) };
  };
  const app = setup(fetch);
  app.get("topic-input").value = "moss";
  app.get("include-input").value = "child";
  app.get("from-input").value = "2015";
  app.get("to-input").value = "2020";
  app.submit(); await settle();
  assert.equal(app.get("topic-name").textContent, "Moss + child");
  assert.match(app.get("headline").textContent, /Research on moss mentioning child is a new topic:/);
  assert.match(app.get("kpis").innerHTML, /Average yearly increase in papers between 2015 and 2020/);
  assert.equal(app.get("experts-heading").textContent, "Leading experts");
  assert.equal(app.get("experts-note").textContent, "Authors with the most papers on this topic between 2015 and 2020. A starting point for speakers, not a ranking of quality. Only papers in journals on the Leiden Ranking core list are counted.");
  assert(!app.get("year-chart").innerHTML.includes("2021:"));
  assert(!app.get("year-chart").innerHTML.includes("2014:"));
  assert(app.get("year-chart").innerHTML.includes("2015:"));
  app.click({ subtopic: "T123", title: "Orbital logic" }); await settle();
  assert.equal(calls.at(-1).get("to"), "2020");
  const back = new URLSearchParams(app.get("back-parent").href.slice(1));
  assert.equal(back.get("from"), "2015");
  assert.equal(back.get("to"), "2020");
  app.click({ nextTerm: "genetics" }); await settle();
  assert.equal(calls.at(-1).get("from"), "2015");
  assert.equal(calls.at(-1).get("to"), "2020");
  assert.equal(calls.at(-1).get("include"), "child");
  const restored = setup(() => assert.fail("Restore stays offline"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("to-input").value, "2020");
  let blob;
  restored.context.URL = { createObjectURL(value) { blob = value; return "blob:fixture"; }, revokeObjectURL() {} };
  restored.get("export-csv").listeners.click();
  const csv = await blob.text();
  assert(csv.includes("2015–2020,2015,"));
  assert(!csv.includes(",2021,"));
  assert(!csv.includes(",2014,"));
  app.navigate("#library"); await settle();
  const link = libraryLinks(app).find((href) => new URLSearchParams(href.slice(1)).has("sub"));
  const reopened = setup(fetch, null, link); await settle();
  assert.equal(calls.at(-1).get("cache"), "only");
  assert.equal(calls.at(-1).get("to"), "2020");
  assert.equal(reopened.get("topic-name").textContent, "Orbital logic + child");
});

test("CSV exports the chosen period and only its displayed years", async () => {
  let data;
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = { ...report(app), period: 2025, years: [{ year: 2020, count: 10 }, { year: 2025, count: 4 }, { year: 2026, count: 2 }] };
  app.get("from-input").value = "2025";
  app.submit(); await settle();
  let blob;
  app.context.URL = { createObjectURL(value) { blob = value; return "blob:fixture"; }, revokeObjectURL() {} };
  app.get("export-csv").listeners.click();
  assert.equal(await blob.text(), "sample_data,range,year,papers\r\nfalse,Since 2025,2025,4\r\nfalse,Since 2025,2026,2\r\n");
});

test("legacy saved reports keep truthful aggregate labels without fetching or rewriting cached figures", () => {
  const initial = setup(() => assert.fail("Sample stays offline"));
  const saved = report(initial);
  const restored = setup(() => assert.fail("Legacy restoration stays offline"), JSON.stringify(saved));
  assert.equal(restored.get("from-input").value, "2010");
  assert.equal(restored.get("experts-heading").textContent, "Leading experts");
  assert.equal(restored.get("journals-note").textContent, "Journals that published the most papers on this topic. Preprint servers are excluded.");
  assert.equal(restored.get("papers-period").textContent, "The papers other researchers cite most, published since 2022.");
  assert.equal(JSON.parse(restored.stored.get("topic-momentum:last-topic")).kpis.total, saved.kpis.total);
});

test("restored reports use compact labels and hide suggestions already in any search group", () => {
  const initial = setup(async () => assert.fail("No request needed"));
  const saved = { ...report(initial), name: "epigenetics + (children OR infant)", includeTerms: ["children", "infant"],
    searchTerms: { name: "epigenetics", synonyms: ["neural implant"] }, synonyms: ["neural implant"],
    headline: "Research on epigenetics + (children OR infant) is growing.",
    suggestedSynonyms: ["Children", "epigenetics", "neural implant", "infant", "brain signals"] };
  const app = setup(async () => assert.fail("Restoration must stay offline"), JSON.stringify(saved));
  assert.equal(app.get("topic-name").textContent, "Epigenetics + children / infant");
  assert.equal(app.get("headline").textContent, "Research on epigenetics mentioning children or infant is growing.");
  const chips = app.get("suggested-synonyms").innerHTML;
  assert(chips.includes("brain signals"));
  for (const term of ["Children", "epigenetics", "neural implant", "infant"]) assert(!chips.includes(`data-suggest="${term}"`));
});

test("include quick-fill, searches, suggestions, sub-topics, reload and history retain the filter", async () => {
  const calls = [];
  const app = setup(async (url) => {
    calls.push(new URL(url));
    const params = new URL(url).searchParams;
    const includeTerms = params.get("include").split(",").map((term) => term.trim()).sort();
    const name = (params.get("subtopicName") || params.get("q")) + ` + (${includeTerms.join(" OR ")})`;
    return { ok: true, json: async () => ({ ...report(app), name, includeTerms, id: name,
      ...(params.has("subtopic") ? { subtopicId: params.get("subtopic"), parent: "filtered-parent" } : {}) }) };
  });
  app.get("topic-input").value = "neurotechnology";
  app.get("synonyms-input").value = "neural implant";
  app.get("children-preset").listeners.click();
  const preset = "children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood";
  assert.equal(app.get("include-input").value, preset);
  assert.equal(calls.length, 0);
  app.submit();
  await settle();
  assert.equal(calls[0].searchParams.get("include"), preset.split(", ").join(","));
  assert.equal(app.get("topic-name").textContent, "Neurotechnology + Children 0–9");
  assert(new URLSearchParams(app.context.location.hash.slice(1)).has("include"));
  app.click({ suggest: "brain interface" });
  await settle();
  assert(calls[1].searchParams.get("include").includes("children"));
  app.click({ subtopic: "T123", title: "Orbital processors" });
  await settle();
  assert(calls[2].searchParams.get("include").includes("children"));
  const hash = app.context.location.hash;
  assert.equal(new URLSearchParams(hash.slice(1)).get("title"), "Orbital processors");
  const reloadedCalls = [];
  setup(async (url) => { reloadedCalls.push(new URL(url)); return { ok: false, json: async () => ({ message: "Fixture stop." }) }; }, null, hash + "&cache=only");
  await settle();
  assert(reloadedCalls[0].searchParams.get("include").includes("children"));
  assert.equal(reloadedCalls[0].searchParams.get("cache"), "only");
  app.context.history.back();
  await settle();
  assert(app.get("include-input").value.includes("children"));
  assert.equal(calls.length, 3);
});

test("My library persists compact summaries, opens variants cache-only, and removes only locally", async () => {
  let data;
  const calls = [];
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => new URL(url).pathname === "/api/library" ? [] : data }; });
  data = { ...report(app), id: 'neurotechnology|include:["child","children"]', name: "neurotechnology + child / children", includeTerms: ["child", "children"], parent: "neurotechnology" };
  app.get("topic-input").value = "neurotechnology";
  app.get("include-input").value = "child,children";
  app.submit(); await settle();
  const summaries = JSON.parse(app.stored.get("topic-momentum:my-library"));
  assert.deepEqual(Object.keys(summaries[0]).sort(), ["id", "name", "parent", "field", "momentum", "growth", "total", "spark", "updated", "from", "to", "sparkStartYear", "growthLabel", "growthStartCount", "growthEndCount", "growthStartYear", "growthEndYear"].sort());
  assert.equal(summaries[0].spark.length, 16);
  assert.equal(summaries[0].sparkStartYear, 2010);
  const restored = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => new URL(url).pathname === "/api/library" ? [] : data }; }, null, "#library", summaries);
  await settle();
  assert(restored.get("library-cards").innerHTML.includes("Must also include: child / children"));
  const link = libraryLinks(restored)[0];
  const params = new URLSearchParams(link.slice(1));
  assert.equal(params.get("include"), "child,children");
  assert.equal(params.get("cache"), "only");
  restored.navigate(link); await settle();
  assert.equal(calls.at(-1).searchParams.get("cache"), "only");
  restored.navigate("#library"); await settle();
  restored.click({ removeReport: data.id });
  assert.equal(restored.stored.get("topic-momentum:my-library"), "[]");
  assert.equal(restored.get("library-empty").textContent, "Your library is empty. Search for a topic and it will appear here.");
  const reloaded = setup(() => assert.fail("Reloading the last report stays offline"), restored.stored.get("topic-momentum:last-topic"), link, []);
  assert.equal(reloaded.stored.get("topic-momentum:my-library"), "[]");
  restored.navigate(link); await settle();
  assert.equal(JSON.parse(restored.stored.get("topic-momentum:my-library")).length, 1);
  assert.equal(calls.filter((url) => url.pathname === "/api/topic").length, 2);
});

test("live library browses with one request, renders stored spark only, and filters and sorts locally", async () => {
  const calls = [];
  let release;
  const app = setup(async (url) => { calls.push(new URL(url)); return new Promise((resolve) => { release = resolve; }); }, null, "#library");
  app.get("all-topics-tab").listeners.click();
  assert.equal(app.get("library-count").textContent, "Loading library…");
  assert.equal(app.get("library-empty").hidden, true);
  release({ ok: true, json: async () => libraryFixture() });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/library");
  assert.equal(app.get("library-count").textContent, "2 topics, 1 sub-topic, 0 saved versions");
  const cards = app.get("library-cards").innerHTML;
  assert.equal((cards.match(/<article /g) || []).length, 2);
  assert.equal((cards.match(/class="mini-chart"/g) || []).length, 1);
  assert.match(cards, /2016: 0 papers/);
  assert.match(cards, /2025: 9 papers/);
  assert(!cards.includes("2026:"));
  assert.match(cards, /Accelerating, 1 paper since 2010\. Updated 1 Oct 2026\./);
  assert(!cards.includes("Sample data"));
  assert.match(app.get("fields").innerHTML, /Computer Science<\/span><span class="number">2<\/span>/);
  app.get("all-topics-tab").listeners.click();
  const links = libraryLinks(app);
  assert(links.every((href) => new URLSearchParams(href.slice(1)).get("cache") === "only"));
  const child = links.map((href) => new URLSearchParams(href.slice(1))).find((params) => params.has("sub"));
  assert.equal(child.get("sub"), "T123");
  assert.equal(child.get("topic"), "zeta moss logic");
  assert.equal(child.get("syn"), "moon circuits");
  app.get("library-sort").value = "name";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("alpha spore mapping") < app.get("library-cards").innerHTML.indexOf("zeta moss logic"));
  app.get("library-sort").value = "updated";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("alpha spore mapping") < app.get("library-cards").innerHTML.indexOf("zeta moss logic"));
  app.get("library-sort").value = "momentum";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("zeta moss logic") < app.get("library-cards").innerHTML.indexOf("alpha spore mapping"));
  app.click({ field: "Biology" });
  assert.equal(app.get("library-count").textContent, "1 topic, 0 sub-topics, 0 saved versions");
  assert(!app.get("library-cards").innerHTML.includes("zeta moss logic"));
  app.click({ field: "All fields" });
  for (const text of ["MOON CIRCUITS", "orbital processors"]) {
    app.get("library-search").value = text;
    app.get("library-search").listeners.input();
    assert.equal(app.get("library-count").textContent, "1 topic, 1 sub-topic, 0 saved versions");
  }
  app.get("library-search").value = "no matches";
  app.get("library-search").listeners.input();
  assert.equal(app.get("library-empty").hidden, false);
  assert.match(app.get("library-empty").textContent, /No topics match/);
  app.navigate("#search");
  await settle();
  app.navigate("#library");
  await settle();
  assert.equal(calls.length, 1);
});

test("library empty and error states use live data, with an explicit retry", async () => {
  let calls = 0;
  let fail = true;
  const app = setup(async () => {
    calls++;
    return fail ? { ok: false, json: async () => ({ message: "Topic storage is unavailable. Try again later." }) } : { ok: true, json: async () => [] };
  }, null, "#library");
  await settle();
  assert.equal(app.get("library-error").textContent, "Topic storage is unavailable. Try again later.");
  assert.equal(app.get("library-error").hidden, false);
  assert.equal(app.get("library-retry").hidden, false);
  assert.equal(app.get("library-cards").innerHTML, "");
  fail = false;
  app.get("library-retry").listeners.click();
  await settle();
  assert.equal(calls, 2);
  assert.equal(app.get("library-error").hidden, true);
  assert.equal(app.get("library-empty").hidden, false);
  assert.equal(app.get("library-empty").textContent, "Your library is empty. Search for a topic and it will appear here.");
  const disconnected = setup(async () => { throw new TypeError("Failed to fetch"); }, null, "#library");
  await settle();
  assert.equal(disconnected.get("library-error").textContent, "Can’t reach the data service. Check your connection and try again.");
});

test("a search completed during an older library request refreshes the index on the next visit", async () => {
  let release;
  let libraryCalls = 0;
  let data;
  const app = setup(async (url) => {
    if (new URL(url).pathname === "/api/library") {
      libraryCalls++;
      if (libraryCalls === 1) return new Promise((resolve) => { release = resolve; });
      return { ok: true, json: async () => libraryFixture() };
    }
    return { ok: true, json: async () => data };
  }, null, "#library");
  app.navigate("#search");
  await settle();
  data = report(app);
  app.submit();
  await settle();
  release({ ok: true, json: async () => [] });
  await settle();
  app.navigate("#library");
  await settle();
  app.get("all-topics-tab").listeners.click();
  assert.equal(libraryCalls, 2);
  assert.equal(app.get("library-count").textContent, "2 topics, 1 sub-topic, 0 saved versions");
});

test("saved report links and reloads preserve dates and surface Worker failures without a second request", async () => {
  let data;
  const calls = [];
  const hash = "#topic=fixture+topic&cache=only";
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; }, null, hash);
  data = { ...report(app), cached: true, stale: true, updated: "2026-09-01" };
  await settle();
  assert.match(app.get("report-freshness").textContent, /Saved on 1 Sept 2026/);
  assert.match(app.get("report-freshness").textContent, /may be out of date/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("cache"), "only");
  const restored = setup(() => assert.fail("Restoring a report must not fetch"), app.stored.get("topic-momentum:last-topic"), hash);
  assert.equal(restored.get("topic-name").textContent, "Fixture topic");
  const missingCalls = [];
  const missing = setup(async (url) => {
    missingCalls.push(new URL(url));
    return { ok: false, json: async () => ({ message: "Daily limit reached. Try again tomorrow or browse the Library." }) };
  }, null, hash);
  await settle();
  assert.equal(missingCalls.length, 1);
  assert.equal(missingCalls[0].searchParams.get("cache"), "only");
  assert.match(missing.get("status").textContent, /Daily limit reached/);
});

test("opening a Library card backed only by v1 rebuilds through its saved request and refreshes the index", async () => {
  const { createWorker } = await import("../worker/worker.js");
  const { normaliseQuery, shapeTopic, buildQueries, updateLibrary } = await import("../worker/lib.js");
  const { MemoryKV } = await import("../worker/kv-fixture.js");
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field", "subfields"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const q = normaliseQuery("lunar moss computing");
  const date = new Date("2026-11-01T12:00:00Z");
  const old = { ...shapeTopic(q, responses, new Date("2026-10-01T12:00:00Z")), name: "Legacy title" };
  const original = JSON.stringify({ savedAt: date.getTime(), topic: old });
  const kv = new MemoryKV([["topic:" + old.id, original], ["library", JSON.stringify(updateLibrary([], old))]]);
  let sourceCalls = 0;
  const worker = createWorker(async (url) => {
    sourceCalls++;
    const descriptor = [...buildQueries(q, 2026), ...buildQueries(q, 2026, false)].find(({ params }) => Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value));
    assert(descriptor);
    return Response.json(responses[descriptor.id]);
  }, () => date);
  const requests = [];
  const app = setup(async (url) => {
    requests.push(new URL(url));
    return worker.fetch(new Request(url), { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" });
  }, null, "#library");
  await settle();
  app.get("all-topics-tab").listeners.click();
  app.navigate(libraryLinks(app)[0]); await settle();
  assert.equal(requests[1].searchParams.get("cache"), "only");
  assert.equal(sourceCalls, 14);
  assert.equal(app.get("topic-name").textContent, "Lunar moss computing");
  assert.match(app.get("report-freshness").textContent, /Updated 1 Nov 2026/);
  assert.equal(kv.values.get("topic:" + old.id), original);
  assert(kv.values.has("v3:topic:" + old.id));
  app.navigate("#library"); await settle();
  assert.equal(requests.filter((url) => url.pathname === "/api/library").length, 2);
});

test("library and child links open real Worker cache records without any OpenAlex calls or counter changes", async () => {
  const { createWorker } = await import("../worker/worker.js");
  const { normaliseQuery, shapeTopic, updateLibrary } = await import("../worker/lib.js");
  const { MemoryKV } = await import("../worker/kv-fixture.js");
  const names = ["years", "experts", "early", "late", "countries", "journals", "papers", "keywords", "field", "subfields", "uae", "gcc"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const saved = new Date("2026-10-31T12:00:00Z");
  const parent = shapeTopic(normaliseQuery("lunar moss computing", "moon circuits"), responses, saved);
  const child = shapeTopic({ ...normaliseQuery("lunar moss computing", "moon circuits", "T123"), subtopicName: "Orbital logic", parent: parent.id }, responses, saved);
  const kv = new MemoryKV();
  kv.values.set("library", JSON.stringify(updateLibrary(updateLibrary([], parent), child)));
  for (const topic of [parent, child]) kv.values.set("v3:topic:" + topic.id, JSON.stringify({ savedAt: saved.getTime(), topic }));
  const worker = createWorker(() => assert.fail("Library navigation must never call OpenAlex"), () => new Date("2026-11-08T12:00:00Z"));
  const calls = [];
  const app = setup(async (url) => { calls.push(new URL(url)); return worker.fetch(new Request(url), { TMM: kv }); }, null, "#library");
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(kv.reads, ["library"]);
  app.get("all-topics-tab").listeners.click();
  const links = libraryLinks(app);
  const childLink = links.find((href) => new URLSearchParams(href.slice(1)).has("sub"));
  app.navigate(childLink);
  await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic");
  assert.equal(app.get("topic-input").value, "lunar moss computing");
  assert.match(app.get("report-freshness").textContent, /Part of lunar moss computing/);
  assert.match(app.get("report-freshness").textContent, /may be out of date/);
  assert.equal(calls[1].searchParams.get("subtopic"), "T123");
  assert.equal(calls[1].searchParams.get("cache"), "only");
  const backLink = app.get("back-parent").href;
  assert.equal(new URLSearchParams(backLink.slice(1)).get("cache"), "only");
  app.navigate(backLink);
  await settle();
  assert.equal(app.get("topic-name").textContent, "Lunar moss computing");
  app.context.history.back();
  await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic");
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, "#library");
  assert.equal(calls.length, 3);
  assert.equal(kv.writes.length, 0);
  assert.deepEqual(kv.reads, ["library", "v3:topic:" + child.id, "v3:topic:" + parent.id]);
});

test("site searches, adds synonyms, sends explore parent, and restores the last successful topic", async () => {
  const calls = [];
  let data;
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; });
  data = report(app);
  app.get("topic-input").value = "fixture topic";
  app.get("synonyms-input").value = "alternate, alternate";
  app.submit();
  assert.equal(app.get("status").textContent, "Loading research data…");
  await settle();
  assert.equal(calls[0].origin, app.context.WORKER_URL);
  assert.equal(calls[0].searchParams.get("syn"), "alternate");
  assert.match(app.get("regional-counts").textContent, /UAE: 0 papers\. GCC: 12 papers/);
  assert.equal(app.get("kpis").innerHTML.match(/class="kpi"/g).length, 3);
  app.click({ suggest: "extra term" });
  await settle();
  assert(calls[1].searchParams.get("syn").includes("extra term"));
  app.click({ subtopic: "https://openalex.org/T123", title: "next topic" });
  await settle();
  assert.equal(calls[2].searchParams.get("q"), "fixture topic");
  assert.equal(calls[2].searchParams.get("parent"), "fixture topic");
  assert.equal(calls[2].searchParams.get("syn"), "alternate,extra term");
  assert.equal(calls[2].searchParams.get("subtopic"), "T123");
  assert.equal(calls[2].searchParams.get("subtopicName"), "next topic");
  await app.get("copy-headline").listeners.click();
  assert.equal(app.copied(), app.get("headline").textContent);
  const restored = setup(() => assert.fail("Restoring must not call the network"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("topic-name").textContent, "Fixture topic");
  assert.equal(restored.get("report-source").textContent, "");
});

test("site keeps the sample on network failure and shows the required message", async () => {
  const app = setup(async () => { throw new TypeError("Failed to fetch"); }, "invalid JSON");
  app.submit();
  await settle();
  assert.equal(app.get("status").textContent, "Can’t reach the data service. Check your connection and try again.");
  assert.equal(app.get("report-source").textContent, "Sample data");
  assert.equal(app.get("topic-input").disabled, false);
});

test("site explains daily limits and upstream failure", async () => {
  for (const [error, message] of [
    ["daily_limit", "Daily limit reached. Try again tomorrow or browse the Library."],
    ["source_unavailable", "The research data source is unavailable. Try again later."]
  ]) {
    const app = setup(async () => ({ ok: false, json: async () => ({ error, message }) }));
    app.submit();
    await settle();
    assert.equal(app.get("status").textContent, message);
  }
});


test("zero results hide report sections, and a later successful search restores them", async () => {
  let data;
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = report(app);
  data.kpis.total = 0;
  app.submit();
  await settle();
  assert.equal(app.get("no-results").hidden, false);
  assert.equal(app.get("report-content").hidden, true);
  assert.equal(app.get("status").hidden, true);
  assert(source("app.html").includes("No papers found for this search. Try a broader topic or remove a detail."));
  data.kpis.total = 1;
  app.submit();
  await settle();
  assert.equal(app.get("no-results").hidden, true);
  assert.equal(app.get("report-content").hidden, false);
});

test("sub-topic titles retain parent input terms; typing a new topic clears synonyms and filter", async () => {
  const calls = [];
  let data;
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; });
  data = report(app);
  app.get("topic-input").value = "Parent Topic";
  app.get("synonyms-input").value = "first, second";
  app.submit();
  await settle();
  assert.equal(app.get("topic-input").value, "Parent Topic");
  assert.equal(app.get("synonyms-input").value, "first, second");
  data = { ...data, name: "A long sub-topic title", subtopicId: "T123", parent: "fixture topic", parentName: "Parent Topic" };
  app.click({ subtopic: "T123", title: "A long sub-topic title" });
  await settle();
  assert.equal(app.get("topic-name").textContent, "A long sub-topic title");
  assert.match(app.get("report-freshness").textContent, /Part of Parent Topic/);
  assert.equal(app.get("topic-input").value, "Parent Topic");
  assert.equal(app.get("synonyms-input").value, "first, second");
  const restored = setup(() => assert.fail("No network on restore"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("topic-input").value, "Parent Topic");
  assert.equal(restored.get("topic-name").textContent, "A long sub-topic title");
  app.get("topic-input").value = "New topic";
  app.get("topic-input").listeners.input();
  assert.equal(app.get("synonyms-input").value, "");
  app.submit();
  await settle();
  assert.equal(calls[2].searchParams.get("q"), "New topic");
  assert.equal(calls[2].searchParams.has("subtopic"), false);
  assert.equal(calls[2].searchParams.has("parent"), false);
});

test("HTTP errors display the Worker's own message for 400, 429 and 502", async () => {
  for (const status of [400, 429, 502]) {
    const message = "Worker response " + status + ". Please try a different topic.";
    const app = setup(async () => ({ ok: false, status, json: async () => ({ message }) }));
    app.submit();
    await settle();
    assert.equal(app.get("status").textContent, message);
  }
});


test("report hashes support parent links, browser Back/Forward, and parent form searches", async () => {
  const calls = [];
  let data;
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; });
  data = report(app);
  app.get("topic-input").value = "Parent Topic";
  app.get("synonyms-input").value = "alternate";
  app.submit();
  await settle();
  const parentHash = app.context.location.hash;
  assert(parentHash.startsWith("#topic=Parent+Topic"));
  assert(parentHash.includes("syn=alternate"));
  data = { ...data, name: "Child title", subtopicId: "T123", parent: data.id, parentName: "Incorrect child label", countries: [{ name: "Test country", count: 1 }] };
  app.click({ subtopic: "T123", title: "Child title" });
  await settle();
  const childHash = app.context.location.hash;
  assert(childHash.includes("sub=T123"));
  assert.notEqual(childHash, parentHash);
  assert.equal(app.get("back-parent").textContent, "Back to Parent Topic");
  assert.equal(app.get("back-parent").href, parentHash);
  assert.equal(app.get("back-parent").hidden, false);
  assert.match(app.get("report-freshness").textContent, /Part of Parent Topic/);
  assert.equal(app.get("subtopics-panel").hidden, true);
  assert.equal(app.get("countries").innerHTML.includes("Test country"), true);
  assert.match(app.get("countries").innerHTML, /Test country/);
  assert(!app.get("kpis").innerHTML.includes("FASTEST-GROWING"));
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, parentHash);
  assert.equal(app.get("topic-name").textContent, "Fixture topic");
  assert.equal(app.get("back-parent").hidden, true);
  assert.equal(app.get("subtopics-panel").hidden, false);
  assert.equal(calls.length, 2);
  app.context.history.forward();
  await settle();
  assert.equal(app.get("topic-name").textContent, "Child title");
  data = report(app);
  app.submit();
  await settle();
  assert.equal(calls[2].searchParams.get("q"), "Parent Topic");
  assert.equal(calls[2].searchParams.get("syn"), "alternate");
  assert.equal(calls[2].searchParams.has("subtopic"), false);
  assert.equal(calls[2].searchParams.has("parent"), false);
  assert.equal(app.context.location.hash, parentHash);
});

test("direct child report links load filters and the back link loads the parent", async () => {
  let data;
  const calls = [];
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; }, null, "#topic=parent&sub=T123&title=Child");
  data = { ...report(app), name: "Child", subtopicId: "T123", parentName: "parent" };
  await settle();
  assert.equal(calls[0].searchParams.get("q"), "parent");
  assert.equal(calls[0].searchParams.get("subtopic"), "T123");
  assert.equal(app.get("topic-name").textContent, "Child");
  data = report(app);
  app.navigate(app.get("back-parent").href);
  await settle();
  assert.equal(calls[1].searchParams.get("q"), "parent");
  assert.equal(calls[1].searchParams.has("subtopic"), false);
  assert.equal(app.get("back-parent").hidden, true);
});

test("suggested terms remain in More options and legacy exploration keeps parent filters", async () => {
  const calls = [];
  let data;
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; });
  data = { ...report(app), name: "Child", subtopicId: "T123", suggestedSynonyms: ["genetics"] };
  app.get("topic-input").value = "Parent Topic";
  app.submit();
  await settle();
  assert.match(app.get("suggested-synonyms").innerHTML, /data-suggest="genetics"/);
  assert(!source("app.html").includes('id="explore-next"'));
  app.click({ nextTerm: "genetics" });
  await settle();
  assert.equal(calls[1].searchParams.get("q"), "Parent Topic genetics");
  assert.equal(calls[1].searchParams.get("syn"), "");
  assert.equal(calls[1].searchParams.has("subtopic"), false);
  data.suggestedSynonyms = [];
  app.submit();
  await settle();
  assert.equal(app.get("topics-section").hidden, true);
  data = { ...report(app), exploreNext: [] };
  app.submit();
  await settle();
  assert.equal(app.get("topics-section").hidden, true);
});

test("paper and citation counts use singular and plural wording", async () => {
  let data;
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = { ...report(app), papersKind:"checked", evidence:{version:3,accepted:8,candidates:10,notices:[]},understanding:{mode:"ai",check:{matched:20,total:20}} };
  data.years = [{ year: 2025, count: 1 }, { year: 2026, count: 2 }];
  data.subtopics = [{ name: "One", late: 1, growth: 0 }, { name: "Two", late: 2, growth: 0 }];
  data.regionalCounts = { uae: 1, gcc: 2 };
  data.papers[0].citations = 1;
  app.submit();
  await settle();
  assert.match(app.get("year-chart").innerHTML, /2025: 1 paper</);
  assert.match(app.get("year-chart").innerHTML, /2026: 2 papers/);
  assert.match(app.get("subtopics").innerHTML, /Paper count: 1/);
  assert.match(app.get("subtopics").innerHTML, /Paper count: 2/);
  assert.match(app.get("regional-counts").textContent, /UAE: 1 paper\. GCC: 2 papers/);
  assert.match(app.get("papers").innerHTML, /1 citation</);
});


test("Back during a pending search preserves the restored report when the old response arrives", async () => {
  let data;
  let release;
  let delay = false;
  const app = setup(async () => {
    if (delay) return new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => data };
  });
  data = report(app);
  app.get("topic-input").value = "Parent Topic";
  app.submit();
  await settle();
  const parentHash = app.context.location.hash;
  data = { ...data, name: "Child", subtopicId: "T123" };
  app.click({ subtopic: "T123", title: "Child" });
  await settle();
  delay = true;
  app.click({ nextTerm: "extra" });
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, parentHash);
  assert.equal(app.get("topic-name").textContent, "Fixture topic");
  release({ ok: true, json: async () => ({ ...data, name: "Stale report" }) });
  await settle();
  assert.equal(app.get("topic-name").textContent, "Fixture topic");
  assert.equal(app.context.location.hash, parentHash);
  assert.equal(app.get("topic-input").disabled, false);
});

test("new browsers default to an empty personal library and public browsing excludes variants", async () => {
  const entries = libraryFixture();
  entries.push({ ...entries[0], id: 'main|include:["private"]', name: "Private variant", variant: true });
  const app = setup(async () => ({ ok: true, json: async () => entries }), null, "#library");
  await settle();
  assert.equal(app.get("library-empty").textContent, "Your library is empty. Search for a topic and it will appear here.");
  assert.equal(app.get("library-cards").innerHTML, "");
  app.get("all-topics-tab").listeners.click();
  assert.match(app.get("library-cards").innerHTML, /zeta moss logic/);
  assert(!app.get("library-cards").innerHTML.includes("Private variant"));
  assert(!app.get("library-cards").innerHTML.includes("Remove from my library"));
});

test("personal main topics and sub-topics remain independent cards after removal and reload", async () => {
  const entries = libraryFixture();
  const summaries = entries.map(({ synonyms, children, subtopicId, searchTerms, ...summary }) => summary);
  const fetch = async () => ({ ok: true, json: async () => entries });
  const app = setup(fetch, null, "#library", summaries);
  await settle();
  assert.equal((app.get("library-cards").innerHTML.match(/class="remove-report"/g) || []).length, 3);
  const child = libraryLinks(app).find((link) => new URLSearchParams(link.slice(1)).has("sub"));
  const params = new URLSearchParams(child.slice(1));
  assert.equal(params.get("sub"), "T123");
  assert.equal(params.get("topic"), entries[0].name);
  app.click({ removeReport: entries[0].id });
  const restored = setup(fetch, null, "#library", JSON.parse(app.stored.get("topic-momentum:my-library")));
  await settle();
  assert.equal((restored.get("library-cards").innerHTML.match(/class="remove-report"/g) || []).length, 2);
  assert.match(restored.get("library-cards").innerHTML, /Orbital processors/);
});

test("all four ranked lists default to five and expand without changing the report", async () => {
  let data;
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = { ...report(app), papersKind:"checked", evidence:{version:3,accepted:8,candidates:10,notices:[]},understanding:{mode:"ai",check:{matched:20,total:20}} };
  data.journals = Array.from({length: 7}, (_, i) => ({name: "Journal " + i, count: 10-i}));
  data.papers = Array.from({length: 7}, (_, i) => ({title: "Paper " + i, citations: 100-i, authors: "Author A", journal: "Journal A", year: 2025, url: ""}));
  app.submit(); await settle();
  for (const [id, pattern] of [["journals", /<li>/g], ["papers", /class="paper"/g]]) {
    assert.equal([...app.get(id).innerHTML.matchAll(pattern)].length, 5);
    app.get(id+"-toggle").listeners.click();
    assert.equal([...app.get(id).innerHTML.matchAll(pattern)].length, 7);
    assert.equal(app.get(id+"-toggle").textContent, "Show less");
    app.get(id+"-toggle").listeners.click();
    assert.equal([...app.get(id).innerHTML.matchAll(pattern)].length, 5);
  }
  assert.match(app.get("papers").innerHTML, /class="paper-heading"><h3>Paper 0<\/h3><span class="number citations">100 citations<\/span><\/div><p class="paper-meta">Author A, Journal A, 2025<\/p>/);
});

test("sub-topic table uses only this report's measured rows with uniform styles", async () => {
  let data;
  const app = setup(async () => ({ok:true,json:async()=>data}));
  data = {...report(app), subtopics: [
    {id:"T1",name:"Measured",late:70,growth:.5},
    {id:"T2",name:"New signal",late:30,growth:null},
    {id:"T3",name:"Missing count",growth:.2},
    {id:"T4",name:"Missing growth",late:40}],
    exploreNext:[{id:"T5",name:"Previously explored"}]};
  app.submit(); await settle();
  const rows=app.get("subtopics").innerHTML;
  assert.equal((rows.match(/class="topic-row"/g)||[]).length,2);
  assert.match(rows,/Measured/); assert.match(rows,/New signal/);
  assert(!/Previously explored|Missing count|Missing growth|is-fastest|<strong/.test(rows));
  data.subtopicWindow={countsOnly:true};
  app.submit(); await settle();
  assert(!app.get("subtopics").innerHTML.includes('Growth: New'));
});

test("personal library groups sub-topics and combined range variants, counts actual reports and retains orphans", async () => {
  const parent={...libraryFixture()[0],from:2010,to:null,sparkStartYear:2010,spark:Array.from({length:16},(_,i)=>i),growthLabel:"Growth 2010–2025"};
  const sub={...libraryFixture()[2]};
  const short={...parent,id:parent.id+"|since:2025",parent:parent.id,name:parent.name+" · since 2025",from:2025,sparkStartYear:2025,spark:[17],growthLabel:"5-year growth"};
  const include={...parent,id:parent.id+'|include:["child"]|range:2015-2020',parent:parent.id,name:parent.name+" + child · 2015–2020",from:2015,to:2020,sparkStartYear:2015,spark:[1,2,3,4,5,6]};
  const orphan={...sub,id:"orphan|primary_topic:T88",parent:"orphan",name:"Unsaved parent child"};
  const app=setup(async()=>({ok:true,json:async()=>[]}),null,"#library",[parent,sub,short,include,orphan]);
  await settle();
  const rows=app.get("library-cards").innerHTML;
  assert.equal((rows.match(/class="library-card"/g)||[]).length,2);
  assert.equal((rows.match(/data-report-id=/g)||[]).length,5);
  assert.equal(app.get("library-count").textContent,"1 topic, 2 sub-topics, 2 saved versions");
  assert.match(rows,/Parent topic not saved/);
  assert.match(rows,/Must also include: child/);
  assert.match(rows,/Since 2025/);
  assert.match(rows,/class="growth-basis"[^>]*>5y/);
  assert.match(rows,/Papers per year, 2015 to 2020/);
  assert.match(rows,/2025: 17 papers/);
  assert(!rows.includes("help-trigger"));
  assert.equal((rows.match(/data-remove-report=/g)||[]).length,5);
  app.get("library-search").value="Unsaved parent child";
  app.get("library-search").listeners.input();
  assert.equal(app.get("library-count").textContent,"0 topics, 1 sub-topic, 0 saved versions");
  app.get("library-search").value="";app.get("library-search").listeners.input();
  app.click({removeReport:parent.id});
  assert.equal(app.get("library-count").textContent,"0 topics, 2 sub-topics, 2 saved versions");
  assert.equal(JSON.parse(app.stored.get("topic-momentum:my-library")).length,4);
});

test("saving bounded reports stores only their complete-year spark and its year bounds", async () => {
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}));
  data={...report(app),id:"fixture topic|range:2024-2025",from:2024,to:2025};
  app.submit();await settle();
  const [saved]=JSON.parse(app.stored.get("topic-momentum:my-library"));
  assert.deepEqual(saved.spark,[570,760]);
  assert.equal(saved.sparkStartYear,2024);
  assert.equal(saved.from,2024);assert.equal(saved.to,2025);
  assert.equal(saved.growthLabel,"5-year growth");
});

test("tooltips use the approved exact copy and natural period phrases", async () => {
  const html=source('app.html');
  for(const text of [
    'Write what you\'re looking for in plain words, like a question to a colleague. For example: \"epigenetics in pregnant women since 2020\" or \"inheritance law for children in the GCC\". We pick out the topic, who it\'s about (children, pregnancy, women, teenagers, students, older adults), places (GCC, Middle East or a country) and years (\"since 2020\", \"last 5 years\"). The chips under the box show what we understood: remove a wrong one with ×. Put an exact phrase in \"quotes\". Places and people match words in titles and abstracts, not where authors work.',
    'Other words for the same topic. Papers that use any of them are counted too.',
    'Each group must match. Within a group, any term can match. For example, inheritance + GCC + children. Terms can appear anywhere in the title or abstract; multi-word terms stay together as phrases.',
    'Leave empty to include papers up to today.',
    'Accelerating means 20% or more a year. Growing is 8 to 20%, Stable is 0 to 8%, Cooling means fewer papers each year.',
    'Find a saved topic by name or synonym.'
  ]) assert(html.includes(text),text);
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}));
  for(const [from,to,phrase,expertPhrase]of [[2020,null,'since 2020','since 2020'],[2015,2020,'between 2015 and 2020','between 2015 and 2020'],[2010,null,'since 2010','since 2020']]) {
    data={...report(app),from,to};app.submit();await settle();
    const kpis=app.get('kpis').innerHTML;
    assert(kpis.includes(`Papers on this topic ${phrase}.`));
    assert(kpis.includes(`Average yearly increase in papers ${phrase}. With fewer than three full years, we use the last five complete years instead.`));
    assert(kpis.includes('Papers published in the last complete year.'));
    assert.equal(app.get('experts-note').textContent,`Authors with the most papers on this topic ${expertPhrase}. A starting point for speakers, not a ranking of quality.`);
    assert.equal(app.get('papers-period').textContent,`The papers other researchers cite most, published ${phrase}.`);
    assert.equal(app.get('countries-note').textContent,'Where the authors work. A paper with authors in two countries counts for both.');
    assert.equal(app.get('journals-note').textContent,'Journals that published the most papers on this topic. Preprint servers are excluded.');
    assert(!kpis.includes('in since'));
  }
  const currentYear=new Date().getFullYear();
  data={...report(app),from:currentYear,to:null,subtopicWindow:{countsOnly:true}};
  app.submit();await settle();
  assert(app.get('kpis').innerHTML.includes('Papers published this year to date.'));
  assert.equal(app.get('subtopics-note').textContent,'Research areas inside this topic, ranked by number of papers. Click a row to open it.');
});

test("New topic uses the actual range or five-year baseline, persists in summaries and suppresses headline rates", async () => {
  let data;
  const app=setup(async(url)=>({ok:true,json:async()=>new URL(url).pathname==='/api/library'?[]:data}));
  for(const [from,to,baseline,count,newTopic]of [[2020,null,2020,19,true],[2020,null,2020,20,false],[2025,null,2020,19,true],[2025,null,2020,20,false],[2015,2020,2015,0,true]]) {
    data={...report(app),id:`fixture topic|range:${from}-${to||2026}`,from,to,kpis:{...report(app).kpis,growth:.5,growthLabel:from===2025?'5-year growth':`Growth ${from}–${to||2025}`},headline:'Since 2020, research on fixture topic has been accelerating (+50.0% a year).'};
    data.years=data.years.map(item=>item.year===baseline?{...item,count}:item);
    app.submit();await settle();
    const kpis=app.get('kpis').innerHTML;
    assert.equal(kpis.includes('>New topic<span class="help"'),newTopic);
    assert.equal(app.get('headline').textContent.includes('+50%'),!newTopic);
    const entry=JSON.parse(app.stored.get('topic-momentum:my-library')).find(e=>e.id===data.id);
    assert.equal(entry.growthStartCount,count);
    app.navigate('#library');await settle();
    const row=app.get('library-cards').innerHTML.split('data-report-id="'+data.id+'"')[1].split('</div></article>')[0];
    assert.equal(row.includes('New topic'),newTopic);
    app.navigate('#search');await settle();
  }
});

test("help opens on mouse hover, keyboard focus and touch tap, closes on exit and Escape", () => {
  const app=setup(()=>assert.fail('Tooltips stay offline'));
  const doc=app.context.document,tip=app.get('experts-note');
  const button={dataset:{help:'experts-note'},setAttribute(){}};
  const target={closest:()=>button};
  tip.hidden=true;
  doc.listeners.pointerover({pointerType:'mouse',target});assert.equal(tip.hidden,false);
  doc.listeners.keydown({key:'Escape'});assert.equal(tip.hidden,true);
  doc.listeners.focusin({target});assert.equal(tip.hidden,false);
  doc.listeners.focusin({target:{closest:()=>null}});assert.equal(tip.hidden,true);
  doc.listeners.pointerover({pointerType:'touch',target});assert.equal(tip.hidden,true);
  app.click({help:'experts-note'});assert.equal(tip.hidden,false);
  doc.listeners.pointerout({target:{closest:()=>({contains:()=>false})},relatedTarget:null});assert.equal(tip.hidden,true);
});

test("tiny-base thresholds are strict and retain the real endpoint counts", async () => {
  let data;
  const app=setup(async(url)=>({ok:true,json:async()=>new URL(url).pathname==='/api/library'?[]:data}));
  app.get('topic-input').value='fixture topic';
  for(const [start,end,expected]of [[19,100,true],[20,100,false],[20,1001,true],[20,1000,false],[100,10000,true],[200,10000,false]]) {
    data={...report(app),id:'fixture topic|since:2020',from:2020,to:null,kpis:{...report(app).kpis,growth:1,momentum:'Accelerating',growthLabel:'Growth 2020–2025'},years:[{year:2020,count:start},{year:2025,count:end}],headline:'Since 2020, research on fixture topic has been accelerating (+100.0% a year).'};
    app.submit();await settle();
    const kpis=app.get('kpis').innerHTML;
    assert.equal(kpis.includes('>New topic<span class="help"'),expected);
    if(expected){assert(kpis.includes(`${start} papers in 2020 → ${new Intl.NumberFormat('en-US').format(end)} in 2025`));assert.equal(app.get('headline').textContent,`Research on fixture topic is a new topic: from ${start} papers in 2020 to ${new Intl.NumberFormat('en-US').format(end)} in 2025. Only 12 papers published since 2020 come from the GCC, none from the UAE.`);}
    assert(app.get('momentum-segments').innerHTML.includes('aria-current="true">Accelerating'));
    app.navigate('#library');await settle();assert.equal(app.get('library-cards').innerHTML.includes('New topic'),expected);app.navigate('#search');await settle();
  }
});

test("sub-topic tiny earlier halves show counts, retain percentages at twenty, and suppress both in count-only ranges", async()=>{
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 data={...report(app),subtopics:[{id:'T1',name:'Nineteen',early:19,late:190,growth:9},{id:'T2',name:'Twenty',early:20,late:200,growth:9},{id:'T3',name:'Cached without early',late:100,growth:99}]};app.submit();await settle();
 const rows=app.get('subtopics').innerHTML;
 assert.equal((rows.match(/Earlier half:/g)||[]).length,3);assert(rows.includes('19 → 190'));assert(rows.includes('1 → 100'));assert.equal((rows.match(/Growth: \+900%/g)||[]).length,0);
 data.subtopicWindow={countsOnly:true};app.submit();await settle();assert(!app.get('subtopics').innerHTML.includes('Growth: New'));assert(!app.get('subtopics').innerHTML.includes('%'));
});

test("core and fallback notes and tooltips describe each list independently",async()=>{
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 for(const quality of [{experts:'core',journals:'core'},{experts:'all',journals:'core'},{experts:'core',journals:'all'},{experts:'all',journals:'all'}]){
  data={...report(app),sourceQuality:quality};app.submit();await settle();
  for(const id of ['experts','journals']){assert.equal(app.get(id+'-source-note').hidden,quality[id]==='core');assert.equal(app.get(id+'-source-note').textContent,'Includes non-core sources');}
  assert.equal(app.get('experts-note').textContent,'Authors with the most papers on this topic since 2020. A starting point for speakers, not a ranking of quality.'+(quality.experts==='core'?' Only papers in journals on the Leiden Ranking core list are counted.':''));
  assert.equal(app.get('journals-note').textContent,quality.journals==='core'?'Journals that published the most papers on this topic. Only journals on the Leiden Ranking core list are counted.':'Journals that published the most papers on this topic. Preprint servers are excluded.');
 }
});

test("dynamic proofreading examples match rendered counts, tooltips, metadata and validation",async()=>{
 const examples=JSON.parse(readFileSync(__dirname+'/../worker/fixtures/copy-catalogue.json','utf8')).dynamic;
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 app.get('topic-input').value='epigenetics';
 for(const bounded of [false,true])for(const core of [false,true]){
  data={...report(app),name:'epigenetics',id:'epigenetics',from:bounded?2015:2020,to:bounded?2020:null,sourceQuality:{experts:core?'core':'all',journals:core?'core':'all'},years:[{year:2015,count:100},{year:2020,count:200},{year:2025,count:2571}],kpis:{...report(app).kpis,growthLabel:bounded?'Growth 2015–2020':'Growth 2020–2025'}};
  app.submit();await settle();
  const phrase=bounded?'between 2015 and 2020':'since 2020';
  assert(app.get('kpis').innerHTML.includes(`Papers on this topic ${phrase}.`));
  assert(app.get('kpis').innerHTML.includes(`Average yearly increase in papers ${phrase}. With fewer than three full years, we use the last five complete years instead.`));
  assert.equal(app.get('experts-note').textContent,`Authors with the most papers on this topic ${phrase}. A starting point for speakers, not a ranking of quality.${core?' Only papers in journals on the Leiden Ranking core list are counted.':''}`);
  assert.equal(app.get('papers-period').textContent,`The papers other researchers cite most, published ${phrase}.`);
 }
 const expectedFrom=examples.find(e=>e.label==='From error').example.replace('2026',new Date().getFullYear());
 app.get('from-input').value='1999';app.submit();await settle();assert.equal(app.get('status').textContent,expectedFrom);
 app.get('from-input').value='2020';app.get('to-input').value='1999';app.submit();await settle();assert.equal(app.get('status').textContent,examples.find(e=>e.label==='To error').example.replace('2026',new Date().getFullYear()));
});

test("connection errors describe the chosen Worker rather than the page hostname",async()=>{
 for(const [worker,message]of [['https://topic-momentum-meter.example','Can’t reach the data service. Check your connection and try again.'],['http://127.0.0.1:8787','Can’t reach the data service. Start the Worker and try again.']]){
  const app=setup(async()=>{throw new TypeError('Failed to fetch')});app.context.WORKER_URL=worker;
  app.submit();await settle();assert.equal(app.get('status').textContent,message);
  app.navigate('#library');await settle();assert.equal(app.get('library-error').textContent,message);
 }
});

test("display dates, stale child copy, titles and library metadata use the approved formats",async()=>{
 let data;const app=setup(async url=>({ok:true,json:async()=>new URL(url).pathname==='/api/library'?[]:data}));
 app.get('topic-input').value='epigenetics';
 data={...report(app),id:'epigenetics|since:2020',name:'epigenetics · since 2020',from:2020,to:null,updated:'2026-11-01',kpis:{...report(app).kpis,total:2571,momentum:'Growing'},sourceQuality:{experts:'core',journals:'core'}};
 app.submit();await settle();assert.equal(app.get('topic-name').textContent,'Epigenetics');assert.equal(app.get('topic-meta').textContent,'Computer Science, since 2020');assert.equal(app.get('report-freshness').textContent,'Updated 1 Nov 2026.');assert.equal(app.get('data-notice').textContent,'Data from OpenAlex. Searches are cached anonymously to keep the tool free.');
 app.navigate('#library');await settle();assert(app.get('library-cards').innerHTML.includes('Growing, 2,571 papers since 2020. Updated 1 Nov 2026.'));assert.equal(app.get('library-count').textContent,'0 topics, 0 sub-topics, 1 saved version');
 const saved={...data,name:'Child',subtopicId:'T1',stale:true,updated:'2026-10-01',searchTerms:{name:'epigenetics',synonyms:[]}};
 const restored=setup(()=>assert.fail('No network on restore'),JSON.stringify(saved));assert.equal(restored.get('report-freshness').textContent,'Saved on 1 Oct 2026, may be out of date. Part of epigenetics.');
 const empty=setup(async()=>({ok:true,json:async()=>[]}),null,'#library');await settle();empty.get('all-topics-tab').listeners.click();assert.equal(empty.get('library-empty').textContent,'No shared topics yet.');
});

test("New topic and chart help use exact approved text and remain independently accessible",async()=>{
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 data={...report(app),from:2020,to:null,kpis:{...report(app).kpis,growth:.3,growthLabel:'Growth 2020–2025'},years:[{year:2020,count:12},{year:2025,count:2571}]};app.submit();await settle();
 const kpis=app.get('kpis').innerHTML;
 assert(kpis.includes('aria-label="About New topic"'));assert(kpis.includes('This topic started from very few papers, so a yearly percentage would be misleading. We show the real counts instead.'));assert(kpis.includes('With fewer than three full years, we use the last five complete years instead.'));
 assert(source('app.html').includes('Papers published each year. The current year isn’t over, so its line is dashed.'));
});

test("restored bounded reports repair the fallback, headline and existing personal summary",async()=>{
 const init=setup(()=>assert.fail('Initial sample stays offline'));
 const data={...report(init),id:'epigenetics|range:2018-2019',name:'epigenetics',from:2018,to:2019,kpis:{...report(init).kpis,growth:9,growth5y:9,momentum:'Accelerating',growthLabel:'5-year growth'},years:[{year:2014,count:100},{year:2018,count:150},{year:2019,count:200},{year:2025,count:10000}],sourceQuality:{experts:'core',journals:'core'}};
 const oldSummary={id:data.id,name:data.name,from:2018,to:2019,field:data.field,updated:data.updated,growth:9,growthStartYear:2020,growthEndYear:2025};
 const app=setup(()=>assert.fail('Saved endpoints allow offline repair'),JSON.stringify(data),'#search',[oldSummary]);
 assert(app.get('kpis').innerHTML.includes('+15%'));assert(app.get('headline').textContent.includes('+15% a year over 2014–2019'));assert(!app.get('headline').textContent.includes('2025'));
 const [summary]=JSON.parse(app.stored.get('topic-momentum:my-library'));assert.equal(summary.growth,2**.2-1);assert.equal(summary.growthStartYear,2014);assert.equal(summary.growthEndYear,2019);
});

test("parent navigation capitalises only the initial letter and preserves typed acronyms",async()=>{
 for(const [name,expected]of [['epigenetics','Back to Epigenetics'],['DNA sequencing','Back to DNA sequencing'],['CRISPR','Back to CRISPR']]){
  const init=setup(()=>assert.fail('Sample stays offline'));const saved={...report(init),subtopicId:'T1',parentName:name,searchTerms:{name,synonyms:[]}};
  const app=setup(()=>assert.fail('Restore stays offline'),JSON.stringify(saved));assert.equal(app.get('back-parent').textContent,expected);
 }
});

test("restored reports missing the anchored baseline request one automatic rebuild",async()=>{
 const init=setup(()=>assert.fail('Initial sample stays offline'));
 const complete={...report(init),id:'epigenetics|range:2012-2013',name:'epigenetics',from:2012,to:2013,searchTerms:{name:'epigenetics',synonyms:[]},kpis:{...report(init).kpis,growth:9,growth5y:9,momentum:'Accelerating',growthLabel:'5-year growth'},years:[{year:2008,count:100},{year:2012,count:150},{year:2013,count:200},{year:2025,count:10000}]};
 const old={...complete,years:complete.years.filter(item=>item.year>=2010),_cacheOnlyView:true};const calls=[];
 const app=setup(async url=>{calls.push(new URL(url));return {ok:true,json:async()=>complete}},JSON.stringify(old));
 await settle();assert.equal(calls.length,1);assert.equal(calls[0].searchParams.get('cache'),'only');assert.equal(calls[0].searchParams.get('from'),'2012');assert.equal(calls[0].searchParams.get('to'),'2013');assert(app.get('headline').textContent.includes('over 2008–2013'));assert(!app.get('headline').textContent.includes('900%'));
});

test("sub-topic navigation retains the parent acronym casing in its request and back label",async()=>{
 let data;const calls=[];const app=setup(async url=>{calls.push(new URL(url));return {ok:true,json:async()=>data}});
 data={...report(app),id:'dna sequencing',name:'dna sequencing',headlineName:'DNA sequencing',searchTerms:{name:'dna sequencing',synonyms:[]}};
 app.get('topic-input').value='DNA sequencing';app.submit();await settle();
 data={...report(app),id:'dna sequencing|primary_topic:T1',subtopicId:'T1',name:'Child',parentName:'DNA sequencing',searchTerms:{name:'dna sequencing',synonyms:[]}};
 app.click({subtopic:'T1',title:'Child'});await settle();assert.equal(calls.at(-1).searchParams.get('parentName'),'DNA sequencing');assert.equal(app.get('back-parent').textContent,'Back to DNA sequencing');
});

test("sub-topic arrow counts explain tiny bases only in the card tooltip",async()=>{
 const base='Research areas inside this topic. Growth compares the second half of the period with the first. Click a row to open it.';
 const explanation='Rows with an arrow had fewer than 20 papers in the earlier half or growth above 300%, so we show the earlier and later counts instead of a growth percentage.';
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 data={...report(app),subtopics:[{id:'T1',name:'Small base',early:2,late:320,growth:159},{id:'T2',name:'Zero base',early:0,late:1000,growth:null},{id:'T3',name:'Established',early:20,late:400,growth:19}]};
 app.submit();await settle();let rows=app.get('subtopics').innerHTML;
 assert(rows.includes('2 → 320'));assert(rows.includes('0 → 1,000'));assert(rows.includes('20 → 400'));
 assert(rows.includes('aria-label="Earlier half: 2 papers. Later half: 320 papers."'));
 assert(!rows.includes('data-help'));assert(!rows.includes('>New<'));assert.equal(app.get('subtopics-note').textContent,base+' '+explanation);
 assert.equal(data.subtopics[0].growth,159);
 data.subtopics=[{...data.subtopics[2],late:80,growth:3},{id:'T4',name:'No current count',early:2,growth:159}];app.submit();await settle();
 assert(!app.get('subtopics').innerHTML.includes('→'));assert.equal(app.get('subtopics-note').textContent,base);
 data.subtopics=[{id:'T5',name:'One earlier paper',early:1,late:12,growth:11}];app.submit();await settle();
 assert(app.get('subtopics').innerHTML.includes('1 → 12'));assert(app.get('subtopics').innerHTML.includes('Earlier half: 1 paper. Later half: 12 papers.'));
 data.subtopicWindow={countsOnly:true};app.submit();await settle();
 assert(!app.get('subtopics').innerHTML.includes('→'));assert.equal(app.get('subtopics-note').textContent,'Research areas inside this topic, ranked by number of papers. Click a row to open it.');
});

test('loading copy changes only when the normalized query has more than five Boolean operators',async()=>{
 for(const [syn,include,complex]of [['','a,b,c,d,e',false],['','a,b,c,d,e,f',true],['alias','a,b,c,d,e',true],['alias,ALIAS,topic','a,A',false]]){
  let finish;const app=setup(()=>new Promise(resolve=>{finish=resolve}));app.get('topic-input').value='topic';app.get('synonyms-input').value=syn;app.get('include-input').value=include;app.submit();
  assert.equal(app.get('status').textContent,complex?'This search is more complex, so it takes a little longer…':'Loading research data…');
  finish({ok:true,json:async()=>report(app)});await settle();assert.equal(app.get('status').textContent,'Research data loaded.');
 }
});

test('sub-topic counts also replace growth strictly above three hundred percent',async()=>{
 let data;const app=setup(async()=>({ok:true,json:async()=>data}));
 data={...report(app),subtopics:[{id:'T1',name:'Fast increase',early:105,late:1850,growth:1850/105-1},{id:'T2',name:'At the threshold',early:100,late:400,growth:3}]};app.submit();await settle();
 const rows=app.get('subtopics').innerHTML;assert(rows.includes('105 → 1,850'));assert(rows.includes('Growth: +300%'));assert.equal((rows.match(/Earlier half:/g)||[]).length,1);
 assert.equal(app.get('subtopics-note').textContent,'Research areas inside this topic. Growth compares the second half of the period with the first. Click a row to open it. Rows with an arrow had fewer than 20 papers in the earlier half or growth above 300%, so we show the earlier and later counts instead of a growth percentage.');
});

test('restored Library titles use sentence case with natural include context and typed acronyms',()=>{
 const init=setup(()=>assert.fail('Sample stays offline'));
 for(const [name,original,terms,expected]of [['Neurotechnology','Neurotechnology',['child','infant'],'Research on neurotechnology mentioning child or infant'],['Crispr','CRISPR',[],'Research on CRISPR'],["Alzheimer’s Disease","Alzheimer’s Disease",[],"Research on Alzheimer’s disease"]]){
  const data={...report(init),name,headlineName:original,from:2010,to:null,searchTerms:{name,synonyms:[]},includeTerms:terms,years:[{year:2010,count:1},{year:2025,count:27}],kpis:{...report(init).kpis,growth:1,growthLabel:'Growth 2010–2025'}};
  const restored=setup(()=>assert.fail('Restoring stays offline'),JSON.stringify(data));assert(restored.get('headline').textContent.startsWith(expected+' is a new topic:'));assert(restored.get('headline').textContent.endsWith('Only 12 papers published since 2010 come from the GCC, none from the UAE.'));
 }
});


test("dashboard map plots only measured countries and scales marker area with exact counts", async () => {
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}));
  data={...report(app),countries:[{code:"US",name:"United States",count:100},{code:"CN",name:"China",count:25},{code:"ZZ",name:"Unmapped country",count:50},{code:"AE",name:"United Arab Emirates",count:0}]};
  app.submit();await settle();
  const map=app.get("country-map").innerHTML;
  assert.equal((map.match(/class="map-marker"/g)||[]).length,2);
  assert.match(map,/United States: 100 papers/);
  assert.match(map,/China: 25 papers/);
  const radii=[...map.matchAll(/class="map-count"[^>]* r="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.equal(radii[0]**2/radii[1]**2,4);
  assert(!map.includes("Unmapped country:"));
  assert(!map.includes("United Arab Emirates:"));
  assert.match(app.get("countries").innerHTML,/Unmapped country/);
  assert.match(app.get("countries").innerHTML,/United Arab Emirates/);
});

test("dashboard gauge preserves growth thresholds and leaves unavailable and tiny-base rates without a needle", async () => {
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}));
  data={...report(app),from:2020,to:null,years:[{year:2020,count:100},{year:2025,count:200}],kpis:{...report(app).kpis,growth:.08,momentum:"Growing"}};
  app.submit();await settle();
  assert.match(app.get("momentum-gauge").innerHTML,/data-angle="270"/);
  assert.match(app.get("momentum-gauge").innerHTML,/\+8.0%/);
  data={...data,kpis:{...data.kpis,growth:-.5,momentum:"Cooling"}};
  app.submit();await settle();
  assert.match(app.get("momentum-gauge").innerHTML,/data-angle="202.5"/);
  data={...data,kpis:{...data.kpis,growth:2,momentum:"Accelerating"}};
  app.submit();await settle();
  assert.match(app.get("momentum-gauge").innerHTML,/data-angle="360"/);
  assert.match(app.get("momentum-gauge").innerHTML,/\+200% beyond scale/);
  data={...data,kpis:{...data.kpis,growth:null,momentum:"Not enough data"}};
  app.submit();await settle();
  assert(!app.get("momentum-gauge").innerHTML.includes('class="gauge-needle"'));
  assert.match(app.get("momentum-gauge").innerHTML,/Not enough data/);
  data={...data,years:[{year:2020,count:2},{year:2025,count:200}],kpis:{...data.kpis,growth:2,momentum:"Accelerating"}};
  app.submit();await settle();
  assert(!app.get("momentum-gauge").innerHTML.includes('class="gauge-needle"'));
  assert.match(app.get("momentum-gauge").innerHTML,/New topic/);
});

test("sub-topic comparison bars use only measured baselines and disappear for count-only windows", async () => {
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}));
  data={...report(app),subtopics:[{id:"T1",name:"Measured comparison",early:20,late:80,growth:3},{id:"T2",name:"Missing baseline",late:80,growth:1}]};
  app.submit();await settle();
  let rows=app.get("subtopics").innerHTML;
  assert.equal((rows.match(/class="comparison-bars"/g)||[]).length,1);
  assert.match(rows,/comparison-fill earlier" style="width:25%/);
  assert.match(rows,/comparison-fill later" style="width:100%/);
  assert.match(rows,/\+300%/);
  data={...data,subtopicWindow:{countsOnly:true}};
  app.submit();await settle();
  rows=app.get("subtopics").innerHTML;
  assert(!rows.includes('class="comparison-bars"'));
  assert(!rows.includes("+300%"));
});


async function preciseResponse(app, url, trace = []) {
  const lib = await import("../worker/lib.js");
  const params = new URL(url).searchParams;
  trace.push(params);
  if (new URL(url).pathname === "/api/library") return {ok:true,json:async()=>[]};
  const groups = ["include","include2","include3"].map(key => (params.get(key)||"").split(","));
  const query = lib.normaliseQuery(params.get("q"),params.get("syn")||"",params.get("subtopic")||"",groups,params.get("from")||2010,params.get("to")||"",new Date().getFullYear(),params.get("subfield")||"",lib.SEARCH_PRESETS,{placeIds:params.get("places")?.split(",") || [],placeMode:params.get("placeMode") || "authored",authoredCodes:params.get("authored")?.split(",") || []});
  const effective = lib.includeGroupsOf(query);
  const parent = query.subtopicId ? lib.normaliseQuery(query.name,query.synonyms.join(","),"",effective,query.from,query.to).id : effective.length ? lib.normaliseQuery(query.name,query.synonyms.join(",")).id : null;
  return {ok:true,json:async()=>({...report(app),...query,parent,
    ...(query.subfieldId ? {selectedSubfield:{id:query.subfieldId,name:"Law"}} : {}),
    name:lib.reportLabel(query.subtopicId?params.get("subtopicName"):params.get("q"),effective,query),
    parentName:params.get("parentName")||params.get("q"),
    headlineName:params.get("q"),
    searchTerms:{name:params.get("q"),synonyms:query.synonyms,...lib.includeFields(effective)}
  })};
}

test("sentence previews never fetch and submit the exact existing query fields for every saved parser fixture", async () => {
  const fixtures = JSON.parse(source("query-parser-fixtures.json"));
  const { normaliseQuery } = await import("../worker/lib.js");
  for (const row of fixtures) {
    const calls = []; let app;
    app = setup(url => preciseResponse(app, url, calls));
    app.get("topic-input").value = row.sentence;
    app.get("topic-input").listeners.input();
    assert.equal(calls.length, 0);
    assert.match(app.get("understood-chips").innerHTML, new RegExp("Topic: " + row.topic));
    assert.equal(app.get("search-options").open, false);
    app.submit(); await settle(); await settle();
    const params = calls[0];
    assert.equal(calls.length, 1);
    assert.equal(params.get("q"), row.topic);
    assert.equal(params.get("syn"), "");
    const relative = row.sentence.match(/last (\d+) years/);
    const expectedFrom = relative ? new Date().getFullYear() - Number(relative[1]) : row.from;
    assert.equal(params.get("from"), String(expectedFrom));
    assert.equal(params.get("to"), row.to === null ? null : String(row.to));
    const actualGroups = ["include", "include2", "include3"].filter(key => params.has(key)).map(key => params.get(key).split(","));
    const place=app.context.TMM_PLACES.resolve(row.sentence);
    const expectedGroups=row.groups.filter(group=>!app.context.TMM_PLACES.resolve(group.join(" ")).matches.length || app.context.TMM_PLACES.resolve(group.join(" ")).withoutPlaces.trim());
    const expected = normaliseQuery(row.topic, "", "", expectedGroups, expectedFrom, row.to ?? "",2026,"",undefined,{placeIds:Array.from(place.ids),placeMode:place.mode});
    assert.deepEqual(actualGroups, expectedGroups.length > 1 ? expected.includeGroups : expectedGroups);
    assert(app.stored.has("topic-momentum:last-topic"),row.sentence+": "+app.get("status").textContent);
    assert.equal(JSON.parse(app.stored.get("topic-momentum:last-topic")).id, expected.id);
  }
});

test("understood removals and Advanced edits change the draft without reparsing the unchanged sentence", async () => {
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls));
  app.get("topic-input").value = "research and development in the UAE since 2020";
  app.get("topic-input").listeners.input();
  assert.match(app.get("understood-chips").innerHTML, /Authors based in: UAE \(1 country\)/);
  app.click({ draftRemove: "place" });
  assert(!app.get("understood-chips").innerHTML.includes("Authors based in: UAE"));
  app.click({ draftRemove: "from" });
  assert(!app.get("understood-chips").innerHTML.includes("Since 2020"));
  app.get("search-options").open = true;
  app.get("synonyms-input").value = "innovation"; app.get("synonyms-input").listeners.input();
  app.get("from-input").value = "2018"; app.get("from-input").listeners.input();
  app.get("include-input").value = "school, classroom"; app.get("include-input").listeners.input();
  assert.match(app.get("understood-chips").innerHTML, /Also searches: innovation/);
  assert.match(app.get("understood-chips").innerHTML, /About: school or classroom/);
  assert.equal(calls.length, 0);
  app.submit(); await settle(); await settle();
  assert.equal(calls[0].get("q"), "research and development");
  assert.equal(calls[0].get("syn"), "innovation");
  assert.equal(calls[0].get("include"), "school,classroom");
  assert.equal(calls[0].get("from"), "2018");
  app.click({ draftRemove: "synonym:0" });
  assert.equal(app.get("synonyms-input").value, "");
  app.click({ draftRemove: "topic" });
  app.submit(); await settle();
  assert.equal(calls.length, 1);
  assert.match(app.get("status").textContent, /Add a research topic/);
  let requested;
  app.context.fetch = async url => {
    requested = new URL(url).searchParams;
    return { ok: true, json: async () => report(app) };
  };
  app.get("topic-input").value = "fixture topic";
  app.get("topic-input").listeners.input();
  app.submit(); await settle(); await settle();
  assert.equal(requested.get("q"), "fixture topic");
  assert.equal(requested.get("include"), null);
  assert.equal(app.get("report-stage").hidden, false);
});

test("old structured reports and links are hydrated without reparsing words that look like sentence syntax", async () => {
  const initial = setup(() => assert.fail("Sample stays local"));
  const data = { ...report(initial), name: "law and economics since 2018", id: "law and economics since 2018|estate|include:[\"school\"]|subfield:3308",
    synonyms: ["estate"], searchTerms: { name: "law and economics since 2018", synonyms: ["estate"], includeTerms: ["school"] }, includeTerms: ["school"],
    from: 2010, to: null, subfieldId: "3308", selectedSubfield: { id: "3308", name: "Law" } };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(data));
  assert.equal(calls.length, 0);
  assert.equal(app.get("topic-input").value, "law and economics since 2018");
  assert.equal(app.get("from-input").value, "2010");
  assert.match(app.get("understood-chips").innerHTML, /Topic: law and economics since 2018/);
  assert.match(app.get("understood-chips").innerHTML, /Also searches: estate/);
  assert.match(app.get("understood-chips").innerHTML, /Only: Law/);
  assert.equal(app.get("search-options").open, false);
  const savedHash = app.context.location.hash;
  app.submit(); await settle(); await settle();
  assert.equal(calls[0].get("q"), "law and economics since 2018");
  assert.equal(calls[0].get("from"), "2010");
  assert.equal(calls[0].get("include"), "school");
  assert.equal(calls[0].get("subfield"), "3308");
  assert.equal(app.context.location.hash, savedHash);
  app.click({ draftRemove: "subfield" });
  app.submit(); await settle(); await settle();
  assert.equal(calls.at(-1).get("subfield"), null);
});

test("Narrow down merges groups and ranges with a subfield/sub-topic and Back restores the exact report", async () => {
  const seed = setup(() => assert.fail("Sample stays offline"));
  const { normaliseQuery } = await import("../worker/lib.js");
  const query = normaliseQuery("inheritance", "estate", "T123", ["school"], 2015, 2025, 2026, "3308");
  const saved = { ...report(seed), ...query, name: "Measured area + school, Law papers · 2015–2025", parentName: "inheritance",
    selectedSubfield: { id: "3308", name: "Law" }, searchTerms: { name: "inheritance", synonyms: ["estate"], includeTerms: ["school"] }, refinements: [] };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(saved));
  const original = app.context.location.hash;
  assert.equal(app.get("refine-bar").hidden, false);
  assert.equal(app.get("refine-chips").hidden, true);
  app.get("narrow-input").value = "in Qatar for women since 2020";
  app.get("narrow-input").listeners.input();
  assert.equal(calls.length, 0);
  assert.match(app.get("narrow-understood").innerHTML, /Mentions: Qatar/);
  assert.match(app.get("narrow-understood").innerHTML, /About: Women/);
  app.get("narrow-form").listeners.submit({ preventDefault() {} }); await settle(); await settle();
  assert.equal(calls.length, 1);
  const params = calls[0];
  assert.equal(params.get("q"), "inheritance"); assert.equal(params.get("syn"), "estate");
  assert.equal(params.get("subtopic"), "T123"); assert.equal(params.get("subfield"), "3308");
  assert.equal(params.get("include"), "school"); assert.equal(params.get("include2"), "qatar,qatari");
  assert.equal(params.get("include3"), "woman,women");
  assert.equal(params.get("from"), "2020"); assert.equal(params.get("to"), "2025");
  assert.equal(app.get("back-parent").href, original);
  const refined = app.context.location.hash;
  app.navigate(original); await settle();
  assert.equal(app.get("from-input").value, "2015");
  assert.equal(calls.length, 1);
  app.navigate(refined); await settle();
  assert.equal(app.get("back-parent").href, original);
  const restored = setup(() => assert.fail("Restoration stays offline"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("back-parent").href, original);
});

test("Narrow down no-ops, non-overlapping ranges and removed preview details never spend a search", async () => {
  const seed = setup(() => assert.fail("Sample stays offline"));
  const saved = { ...report(seed), from: 2015, to: 2020, includeTerms: ["school"], searchTerms: { name: "sensor", synonyms: [] } };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(saved));
  const apply = () => app.get("narrow-form").listeners.submit({ preventDefault() {} });
  for (const text of ["school", "since 2010", ""]) {
    app.get("narrow-input").value = text; app.get("narrow-input").listeners.input(); apply(); await settle();
    assert.match(app.get("narrow-note").textContent, /already included/);
  }
  app.get("narrow-input").value = "after 2020"; app.get("narrow-input").listeners.input(); apply();
  assert.match(app.get("narrow-note").textContent, /do not overlap/);
  assert.equal(calls.length, 0);
  app.get("narrow-input").value = "in Qatar since 2018"; app.get("narrow-input").listeners.input();
  app.click({ narrowRemove: "group:0" }); app.click({ narrowRemove: "years" });
  apply(); assert.equal(calls.length, 0);
  app.get("narrow-input").value = "law and economics"; app.get("narrow-input").listeners.input();
  app.click({ narrowRemove: "topic" }); apply(); assert.equal(calls.length, 0);
});

test("group overflow is explained; oversized custom identities and invalid years stop before a request", async () => {
  const app = setup(() => assert.fail("Validation stays local"));
  app.get("topic-input").value = "AI in Qatar for women among students in children among older adults";
  app.get("topic-input").listeners.input();
  assert.match(app.get("query-note").textContent, /Not added: Older adults/);
  assert(!app.get("understood-chips").innerHTML.includes("Older adults"));
  app.get("topic-input").value = "inheritance in " + "x".repeat(480) + " among children since 2020";
  app.get("topic-input").listeners.input(); app.submit();
  assert.match(app.get("include-error").textContent, /too many terms/);
  for (const text of [`AI after ${new Date().getFullYear()}`, "AI since 2018 from 2020", "AI last 0 years"]) {
    app.get("topic-input").value = text; app.get("topic-input").listeners.input(); app.submit();
    assert.equal(app.get("status").hidden, false);
    assert(app.get("query-note").textContent);
  }
});

test("sentence controls have accessible removals and flow layout; all five rotating placeholders are exact", () => {
  const html = source("app.html"), css = source("styles.css"), script = source("app.js");
  assert(html.includes('<summary>Advanced</summary>'));
  assert(!html.includes('<summary>More options</summary>'));
  assert(html.indexOf('id="understood-chips"') < html.indexOf('id="search-options"'));
  assert(html.indexOf('id="narrow-form"') < html.indexOf('class="report-heading"'), "Narrow down sits above the report title");
  assert(html.indexOf('class="report-heading"') < html.indexOf('id="report-content"'));
  assert(html.indexOf('id="narrow-form"') < html.indexOf('id="refine-chips"'));
  assert(html.indexOf('id="refine-chips"') < html.indexOf('id="report-content"'));
  assert.match(css, /\.t-skel-content>\.report-heading\{position:static;[^}]*height:auto;[^}]*overflow:visible/);
  assert.match(css, /\.refine-bar\{display:block;position:static/);
  assert.match(css, /\.understood-chips\{display:flex;flex-wrap:wrap/);
  for (const text of ["epigenetics in children since 2020", "inheritance law in the GCC", "AI and its impact on jobs, wages and productivity", "neurotechnology in the UAE, last 5 years", "screen time and sleep in teenagers"]) assert(script.includes('"' + text + '"'));
  const app = setup(() => assert.fail("No request expected"));
  app.get("topic-input").value = "AI in Qatar"; app.get("topic-input").listeners.input();
  assert.match(app.get("understood-chips").innerHTML, /type="button"[^>]*aria-label="Remove place restriction"/);
});

test("Narrow down prevents duplicate submissions and retains the current report and draft on failure", async () => {
  const seed = setup(() => assert.fail("Sample stays local"));
  const saved = { ...report(seed), searchTerms: { name: "sensor", synonyms: [] }, from: 2020, to: 2025 };
  let release; const calls = [];
  const app = setup(url => {
    calls.push(new URL(url));
    return new Promise(resolve => { release = () => resolve({ ok: false, json: async () => ({ message: "Daily limit reached. Try again tomorrow or browse the Library." }) }); });
  }, JSON.stringify(saved));
  const original = app.context.location.hash;
  const title = app.get("topic-name").textContent;
  app.get("narrow-input").value = "in Qatar";
  app.get("narrow-input").listeners.input();
  const apply = () => app.get("narrow-form").listeners.submit({ preventDefault() {} });
  app.get("narrow-apply");
  apply(); apply();
  assert.equal(calls.length, 1);
  assert.equal(app.get("narrow-input").disabled, true);
  assert.equal(app.get("narrow-apply").disabled, true);
  release(); await settle();
  assert.equal(app.get("narrow-input").disabled, false);
  assert.equal(app.get("narrow-apply").disabled, false);
  assert.equal(app.context.location.hash, original);
  assert.equal(app.get("topic-name").textContent, title);
  assert.equal(app.get("narrow-input").value, "in Qatar");
  assert.match(app.get("narrow-understood").innerHTML, /Mentions: Qatar/);
  assert.match(app.get("status").textContent, /Daily limit reached/);
});

test("Narrow down reports ignored fourth groups and applies only a changed range without replacing groups", async () => {
  const seed = setup(() => assert.fail("Sample stays local"));
  const saved = { ...report(seed), searchTerms: { name: "sensor", synonyms: [] }, includeGroups: [["one"], ["two"], ["three"]], from: 2015, to: 2025 };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(saved));
  const apply = () => app.get("narrow-form").listeners.submit({ preventDefault() {} });
  app.get("narrow-input").value = "in Qatar"; app.get("narrow-input").listeners.input();
  assert.match(app.get("narrow-note").textContent, /Not added: Qatar/);
  apply(); assert.equal(calls.length, 0);
  app.get("narrow-input").value = "in Qatar since 2020"; app.get("narrow-input").listeners.input();
  apply(); await settle(); await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(["include", "include2", "include3"].map(key => calls[0].get(key)), ["one", "two", "three"]);
  assert.equal(calls[0].get("from"), "2020"); assert.equal(calls[0].get("to"), "2025");
});

test("AI sentence submissions show the checked readout and switch place mode with the cached question", async () => {
  const lib = await import("../worker/lib.js");
  const ai = JSON.parse(readFileSync(__dirname + "/../worker/fixtures/ai-search.json", "utf8"));
  const fixture = id => JSON.parse(readFileSync(__dirname + `/../worker/fixtures/${id}.json`, "utf8"));
  const calls = [], key = "ai:search:v1:" + "a".repeat(64);
  let newUnderstandings = 0;
  const initial = lib.compileAIPlan(ai.plan, 2026);
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url); calls.push({ url: parsed, options });
    if (parsed.pathname === "/api/library") return { ok: true, json: async () => [] };
    let query, place, fresh = false;
    if (options.method === "POST") {
      const input = JSON.parse(options.body);
      if (!input.mode) newUnderstandings++;
      const result = lib.compileAIPlan(ai.plan, 2026, input.mode || ai.plan.place.mode, input.current);
      query = result.query; place = result.place; fresh = !input.mode;
      assert.equal(input.sentence, ai.sentence);
    } else {
      const p = parsed.searchParams;
      query = lib.normaliseQuery(p.get("q"), p.get("syn"), p.get("subtopic") || "", ["include", "include2", "include3"].map(k => (p.get(k) || "").split(",")), p.get("from"), p.get("to") || "", 2026, p.get("subfield") || "", lib.SEARCH_PRESETS, { excludeTerms: JSON.parse(p.get("exclude") || "[]"), authoredCodes: p.get("authored") ? p.get("authored").split(",") : [] });
      place = { ...initial.place, mode: query.authoredCodes?.length ? "authored" : "mentions" };
    }
    const responses = Object.fromEntries(lib.buildQueries(query, 2026).map(({ id }) => [id, fixture(id)]));
    const report = lib.shapeTopic(query, responses, new Date("2026-11-02"));
    return { ok: true, json: async () => ({ ...report, papersKind: fresh ? "checked" : "cited", evidence: fresh ? { version:3, accepted: 5, candidates: 10, notices: [] } : undefined, understanding: { mode: "ai", key, sentence: ai.sentence, place, check: query.id === initial.query.id ? { matched: 23, total: 25 } : null, changed: query.id !== initial.query.id } }) };
  };
  const app = setup(fetch, null, "#search", null, true);
  app.get("topic-input").value = ai.sentence; app.get("topic-input").listeners.input();
  app.submit(); await settle(); await settle();
  assert.equal(calls[0].url.pathname, "/api/search"); assert.equal(calls[0].url.search, "");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { sentence: ai.sentence,placeMode:"authored" });
  assert.match(app.get("understanding-line").textContent, /Checked: 23 of 25 sample papers on-topic/);
  assert.match(app.get("understanding-line").textContent, /written in GCC/);
  assert.match(app.get("understood-chips").innerHTML, /Written in GCC/);
  assert.equal(app.get("papers-heading").textContent, "Key papers");
  const original = app.context.location.hash;
  assert.equal(new URLSearchParams(original.slice(1)).get("understanding"), key);
  assert.equal(new URLSearchParams(original.slice(1)).get("authored"), "AE,BH,KW,OM,QA,SA");
  const saved = JSON.parse(app.stored.get("topic-momentum:my-library"))[0];
  assert.equal(saved.understandingKey, key); assert.equal(saved.authoredCodes.length, 6);
  let blob;
  app.context.URL = class extends URL { static createObjectURL(value) { blob = value; return "blob:fixture"; } static revokeObjectURL() {} };
  app.get("export-csv").listeners.click();
  const csv = await blob.text();
  assert(csv.startsWith("sample_data,range,year,papers,exclude_terms,authored_codes\r\n"));
  assert(csv.includes('""middle east respiratory syndrome""')); assert(csv.includes('""AE""'));
  app.click({ placeToggle: "true" }); await settle(); await settle();
  assert.equal(newUnderstandings, 1);
  const switched = JSON.parse(calls.at(-1).options.body);
  assert.equal(switched.mode, "mentions");
  assert.equal(switched.current.from, 2020);
  assert.match(app.get("understood-chips").innerHTML, /Mentions GCC/);
  assert.match(app.get("understanding-line").textContent, /Search changed; not checked/);
  assert.equal(new URLSearchParams(app.context.location.hash.slice(1)).get("authored"), null);
  assert.equal(app.get("back-parent").href, original);
  app.click({ draftRemove: "exclude:0" }); app.submit(); await settle(); await settle();
  assert.equal(calls.at(-1).url.pathname, "/api/topic");
  assert.equal(calls.at(-1).url.searchParams.get("exclude"), null);
  assert.equal(calls.at(-1).url.searchParams.get("understanding"), key);
  assert(!app.get("understanding-line").textContent.includes("Checked: 23"));
  const restored = setup(() => assert.fail("Local restoration is offline"), app.stored.get("topic-momentum:last-topic"), "#search", null, true);
  assert.match(restored.get("understood-chips").innerHTML, /Mentions GCC/);
  const posts = calls.filter(call => call.options.method === "POST").length;
  app.navigate("#library"); await settle();
  const link = libraryLinks(app).find(link => new URLSearchParams(link.slice(1)).get("authored"));
  assert(link); app.navigate(link); await settle(); await settle();
  assert.equal(calls.filter(call => call.options.method === "POST").length, posts);
});

test("legacy unverified data shows no unchecked lists or Quick-mode UI", async () => {
  let seed;
  const app = setup(async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/search");
    assert.equal(options.method, "POST");
    return { ok: true, json: async () => ({ ...seed, searchTerms: { name: "gene editing", synonyms: [] }, understanding: { mode: "quick" } }) };
  }, null, "#search", null, true);
  seed = report(app);
  app.get("topic-input").value = "Tell me about gene editing"; app.get("topic-input").listeners.input(); app.submit();
  await settle();
  assert.match(app.get("understanding-line").textContent, /AI checks unavailable/);
  assert(!app.get("understanding-line").textContent.includes("Checked:"));
  assert(!app.get("understood-chips").innerHTML.includes("data-place-toggle"));
  assert.equal(app.get("papers-heading").textContent, "Key papers");
});

test("Narrow down suppresses repeated topic plurals in both the readout and the submitted search", async () => {
  const seed = setup(() => assert.fail("Sample stays local"));
  const saved = { ...report(seed), name: "neurotechnology", id: "neurotechnology", synonyms: [], searchTerms: { name: "neurotechnology", synonyms: [] }, from: 2010, to: null };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(saved));
  app.get("narrow-input").value = "neurotechnologies"; app.get("narrow-input").listeners.input();
  assert.equal(app.get("narrow-understood").innerHTML, "");
  app.get("narrow-form").listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 0);
  app.get("narrow-input").value = "I am looking for neurotechnologies regarding children aged 0–9, living in the GCC";
  app.get("narrow-input").listeners.input();
  const preview = app.get("narrow-understood").innerHTML;
  assert.match(preview, /About: Children 0–9/); assert.match(preview, /Mentions: GCC/);
  assert(!preview.includes("neurotechnologies")); assert(!preview.includes("Since"));
  app.get("narrow-form").listeners.submit({ preventDefault() {} }); await settle(); await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("q"), "neurotechnology");
  assert.deepEqual(calls[0].get("include").split(",").sort(), Array.from(app.context.TMM_SEARCH_PRESETS.children.terms).sort());
  assert.deepEqual(calls[0].get("include2").split(",").sort(), Array.from(app.context.TMM_SEARCH_PRESETS.gcc.terms).sort());
  assert.equal(calls[0].get("include3"), null); assert.equal(calls[0].get("from"), "2010");
});

test("the exact Middle East sentence previews and submits exactly two full preset groups with a compact ID", async () => {
  const seed = setup(() => assert.fail("Sample stays local"));
  const saved = { ...report(seed), name: "neurotechnology", id: "neurotechnology", synonyms: [], searchTerms: { name: "neurotechnology", synonyms: [] }, from: 2010, to: null };
  const calls = []; let app;
  app = setup(url => preciseResponse(app, url, calls), JSON.stringify(saved));
  app.get("narrow-input").value = "I am looking for neurotechnologies regarding children from 0 to 9, born in all the countries of the Middle East";
  app.get("narrow-input").listeners.input();
  const preview = app.get("narrow-understood").innerHTML;
  assert.equal((preview.match(/data-narrow-remove=/g) || []).length, 2);
  assert.match(preview, /About: Children 0–9/); assert.match(preview, /Mentions: Middle East/);
  assert(!preview.includes("neurotechnologies")); assert(!preview.includes("Since"));
  app.get("narrow-form").listeners.submit({ preventDefault() {} });
  await settle(); await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("q"), "neurotechnology");
  assert.deepEqual(calls[0].get("include").split(",").sort(), Array.from(app.context.TMM_SEARCH_PRESETS.children.terms).sort());
  assert.deepEqual(calls[0].get("include2").split(",").sort(), Array.from(app.context.TMM_SEARCH_PRESETS.middleEast.terms).sort());
  assert.equal(calls[0].get("include3"), null);
  const data = JSON.parse(app.stored.get("topic-momentum:last-topic"));
  assert.equal(data.id, 'neurotechnology|includeGroups:["preset:children@1","preset:middleEast@1"]');
  assert.equal(data.includeGroups.length, 2);
  assert.equal(data.searchTerms.includeGroups[1].length, app.context.TMM_SEARCH_PRESETS.middleEast.terms.length);
  assert.match(app.get("topic-name").textContent, /Children 0–9 \+ Middle East/);
  assert(!app.get("topic-name").textContent.includes("preset:"));
  assert.match(app.get("headline").textContent, /neurotechnology in children in the Middle East/);
  let blob;
  app.context.URL = { createObjectURL(value) { blob = value; return "blob:fixture"; }, revokeObjectURL() {} };
  app.get("export-csv").listeners.click();
  const csv = await blob.text();
  assert(csv.includes('""middle east""'));
  assert(!csv.includes("preset:"));
  const restored = setup(() => assert.fail("Restored full terms stay offline"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("include-input").value.split(", ").length, app.context.TMM_SEARCH_PRESETS.children.terms.length);
  assert.equal(restored.get("include-input-2").value.split(", ").length, app.context.TMM_SEARCH_PRESETS.middleEast.terms.length);
});

test("a compact cached response can retain its original full group order after a reordered request", async () => {
  const seed = setup(() => assert.fail("Sample stays local"));
  const { normaliseQuery } = await import("../worker/lib.js");
  const children = Array.from(seed.context.TMM_SEARCH_PRESETS.children.terms), middleEast = Array.from(seed.context.TMM_SEARCH_PRESETS.middleEast.terms);
  const query = normaliseQuery("neurotechnology", "", "", [children, middleEast]);
  const data = { ...report(seed), ...query, searchTerms: { name: "neurotechnology", synonyms: [], includeGroups: query.includeGroups } };
  const calls = [];
  const app = setup(async url => { calls.push(new URL(url)); return { ok: true, json: async () => ({ ...data, cached: true }) }; }, JSON.stringify(data));
  app.get("include-input").value = middleEast.join(", ");
  app.get("include-input-2").value = children.join(", ");
  app.submit(); await settle(); await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].searchParams.get("include").split(",").sort(), [...middleEast].sort());
  assert(!app.get("status").textContent.includes("did not retain"));
  assert.equal(JSON.parse(app.stored.get("topic-momentum:last-topic")).id, query.id);
  assert.equal(app.get("include-input").value.split(", ").length, children.length);
});

test("Library links expand compact tokens and prefer saved full terms over the current preset registry", async () => {
  const { normaliseQuery } = await import("../worker/lib.js");
  const seed = setup(() => assert.fail("Sample stays local"));
  const children = Array.from(seed.context.TMM_SEARCH_PRESETS.children.terms);
  const groups = [children, ["classroom", "school"]];
  const query = normaliseQuery("neurotechnology", "", "", groups);
  const summary = { id: query.id, name: "Neurotechnology", field: "Neuroscience", updated: "2026-10-31", synonyms: [], parent: "neurotechnology", total: 1, growth: null, momentum: "Not enough data", spark: [], from: 2010, to: null };
  for (const entry of [summary, { ...summary, id: summary.id.replace("children@1", "children@99"), includeGroups: groups }]) {
    const app = setup(() => assert.fail("Local Library stays offline"), null, "#library", [entry]);
    await settle();
    const links = libraryLinks(app);
    assert.equal(links.length, 1);
    const params = new URLSearchParams(links[0].slice(1));
    assert.equal(params.get("topic"), "neurotechnology");
    assert.equal(params.get("syn"), null);
    assert.equal(params.get("cache"), "only");
    assert.deepEqual(params.get("include").split(",").sort(), [...children].sort());
    assert.equal(params.get("include2"), "classroom,school");
    assert(!links[0].includes("preset%3A"));
  }
});

test("three include groups retain every predicate through sub-topics, back links, ranges, restore and Library links", async()=>{
  const calls=[];let app;
  const fetch=url=>preciseResponse(app,url,calls);
  app=setup(fetch);
  app.get("topic-input").value="inheritance";
  app.get("include-input").value="gulf states, emirati";
  app.get("add-include-group").listeners.click();
  app.get("include-input-2").value="children, child";
  app.get("add-include-group").listeners.click();
  app.get("include-input-3").value="school policy, education";
  app.get("from-input").value="2020";
  app.get("to-input").value="2025";
  assert.equal(app.get("add-include-group").disabled,true);
  app.submit();await settle();await settle();
  const parentHash=app.context.location.hash;
  const expected=[["emirati","gulf states"],["child","children"],["education","school policy"]];
  assert.deepEqual(["include","include2","include3"].map(key=>calls.at(-1).get(key)),expected.map(group=>group.join(",")));
  assert(app.get("topic-name").textContent.includes("emirati / gulf states + child / children + education / school policy"));
  assert(app.get("headline").textContent.includes("matching one of emirati or gulf states and one of child or children and one of education or school policy"));
  const stored=JSON.parse(app.stored.get("topic-momentum:my-library"))[0];
  assert.deepEqual(stored.includeGroups,expected);
  assert.deepEqual(stored.searchTerms.includeGroups,expected);
  const unfiltered=new URLSearchParams(app.get("back-parent").href.slice(1));
  assert(!unfiltered.has("include"));assert(!unfiltered.has("include2"));assert(!unfiltered.has("include3"));
  app.click({subtopic:"T123",title:"Measured sub-topic"});await settle();await settle();
  assert.equal(calls.at(-1).get("include3"),"education,school policy");
  assert.equal(calls.at(-1).get("from"),"2020");assert.equal(calls.at(-1).get("to"),"2025");
  const childBack=new URLSearchParams(app.get("back-parent").href.slice(1));
  assert.equal(childBack.get("include2"),"child,children");
  assert.equal(childBack.get("include3"),"education,school policy");
  app.context.history.back();await settle();
  assert.equal(app.context.location.hash,parentHash);
  assert.equal(app.get("include-input-3").value,"education, school policy");
  app.context.history.forward();await settle();
  assert.equal(app.get("include-input-2").value,"child, children");
  const restored=setup(()=>assert.fail("Restored reports stay offline"),app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("include-input-3").value,"education, school policy");
  assert.equal(restored.get("include-group-3").hidden,false);
  assert.equal(restored.get("search-options").open,false);
  app.navigate("#library");await settle();
  assert.match(app.get("library-count").textContent,/1 sub-topic, 1 saved version/);
  const links=libraryLinks(app);
  assert.equal(links.length,2);
  for(const href of links){const params=new URLSearchParams(href.slice(1));assert.equal(params.get("include3"),"education,school policy");assert.equal(params.get("cache"),"only");}
  const reopened=setup(url=>preciseResponse(app,url,calls),null,links[0]);await settle();await settle();
  assert.equal(calls.at(-1).get("cache"),"only");
  assert.equal(reopened.get("include-input-3").value,"education, school policy");
});

test("region chips append without submitting, remove groups compactly and never alter the Children preset",()=>{
  let calls=0;const app=setup(()=>{calls++;assert.fail("Presets must not submit");});
  app.get("topic-input").value="inheritance";
  app.get("children-preset").listeners.click();
  const children=app.get("include-input").value;
  app.get("gcc-preset").listeners.click();
  assert.equal(app.get("include-input").value,children);
  const gcc=app.get("include-input-2").value;
  assert.equal(gcc,app.context.TMM_SEARCH_PRESETS.gcc.terms.join(", "));
  assert(!gcc.split(", ").includes("gcc"));
  app.get("gcc-preset").listeners.click();
  assert.equal(app.get("include-group-3").hidden,true,"Repeated presets focus their existing group");
  app.get("middle-east-preset").listeners.click();
  const middleEast=app.get("include-input-3").value;
  assert(middleEast.includes("türkiye"));
  for(const term of ["jordan","turkey","cyprus","cypriot"])assert(!middleEast.split(", ").includes(term));
  assert.equal(app.get("add-include-group").disabled,true);
  app.get("children-preset").listeners.click();
  assert.equal(app.get("include-input-2").value,gcc);
  assert.equal(app.get("include-input-3").value,middleEast);
  app.get("remove-include-2").listeners.click();
  assert.equal(app.get("include-input-2").value,middleEast);
  assert.equal(app.get("include-group-3").hidden,true);
  app.get("remove-include-1").listeners.click();
  assert.equal(app.get("include-input").value,middleEast);
  app.get("remove-include-1").listeners.click();
  assert.equal(app.get("include-input").value,"");
  assert.equal(app.get("include-group-2").hidden,true);
  assert.equal(calls,0);
});

test("named groups keep compact titles, full RFC-4180 CSV groups and suggestion exclusions",async()=>{
  let app;const calls=[];
  app=setup(url=>preciseResponse(app,url,calls));
  app.get("topic-input").value="inheritance";
  app.get("gcc-preset").listeners.click();
  app.get("add-include-group").listeners.click();
  app.get("include-input-2").value=app.context.TMM_SEARCH_PRESETS.children.terms.join(", ");
  app.submit();await settle();await settle();
  assert.equal(app.get("topic-name").textContent,"Inheritance + GCC + Children 0–9");
  assert(app.get("headline").textContent.includes("inheritance in children in the GCC"));
  const record=JSON.parse(app.stored.get("topic-momentum:last-topic"));
  const expected=record.includeGroups;
  let blob;
  app.context.URL={createObjectURL(value){blob=value;return "blob:fixture";},revokeObjectURL(){}};
  app.get("export-csv").listeners.click();
  const lines=(await blob.text()).trim().split("\r\n");
  assert.equal(lines[0],"sample_data,range,year,papers,include_groups");
  for(const line of lines.slice(1)){
    const fields=line.match(/^(false),([^,]+),(\d{4}),(\d+),"(.*)"$/);
    assert(fields,"Each CSV row retains its original columns and an escaped JSON field");
    assert.deepEqual(JSON.parse(fields[5].replaceAll('""','"')),expected);
    assert.equal(Number(fields[4]),record.years.find(item=>item.year===Number(fields[3])).count);
  }
});

test("invalid or unsupported group requests never silently broaden searches",async()=>{
  let calls=0;
  const blocked=setup(()=>{calls++;assert.fail("Over-limit searches stay offline");});
  blocked.get("include-input").value="ü".repeat(240);
  blocked.get("add-include-group").listeners.click();
  blocked.get("include-input-2").value="education";
  blocked.submit();await settle();
  assert.equal(blocked.get("status").textContent,"This search has too many terms. Remove some synonyms or additional terms and try again.");
  assert.equal(blocked.get("topic-input").disabled,false);
  assert.equal(calls,0);
  const invalid=setup(()=>{calls++;assert.fail("Unsupported group slots stay offline");},null,"#topic=inheritance&include=child&include4=school");
  await settle();assert.match(invalid.get("status").textContent,/three include groups/);
  let app;
  app=setup(async()=>({ok:true,json:async()=>({...report(app),includeTerms:["child"]})}));
  app.get("include-input").value="child";
  app.get("add-include-group").listeners.click();
  app.get("include-input-2").value="education";
  app.submit();await settle();
  assert.equal(app.get("status").textContent,"The data service did not retain every include group. Update the Worker and try again.");
  assert.equal(app.get("report-source").textContent,"Sample data");
});


test("multi-group complexity switches loading copy at six joins and suggestions exclude every group",async()=>{
  let app;
  app=setup(async url=>{
    const response=await preciseResponse(app,url);
    const data=await response.json();
    return {ok:true,json:async()=>({...data,suggestedSynonyms:["children","gulf states","Neural weave"]})};
  });
  app.get("topic-input").value="inheritance";
  app.get("include-input").value="children, child, infant";
  app.get("add-include-group").listeners.click();
  app.get("include-input-2").value="gulf states, emirati";
  app.submit();
  assert.equal(app.get("status").textContent,"Loading research data…");
  await settle();await settle();
  assert(!app.get("suggested-synonyms").innerHTML.includes('data-suggest="children"'));
  assert(!app.get("suggested-synonyms").innerHTML.includes('data-suggest="gulf states"'));
  assert(app.get("suggested-synonyms").innerHTML.includes('data-suggest="Neural weave"'));
  app.get("include-input-2").value="gulf states, emirati, qatari";
  app.submit();
  assert.equal(app.get("status").textContent,"This search is more complex, so it takes a little longer…");
  await settle();await settle();
});

test("removing or editing an over-limit group clears its stale validation message",()=>{
  const app=setup(()=>assert.fail("Editing filters must not fetch"));
  app.get("include-input").value="ü".repeat(240);
  app.get("add-include-group").listeners.click();
  app.get("include-input-2").value="school";
  app.submit();
  assert.equal(app.get("include-error").hidden,false);
  app.get("include-input").value="child";
  app.get("include-input").listeners.input();
  assert.equal(app.get("include-error").hidden,true);
  assert.equal(app.get("status").hidden,true);
});

test("landing try buttons open an empty search without restoring filters or overwriting the saved report", async () => {
  const seed = setup(() => assert.fail("No request expected"));
  const saved = JSON.stringify({ ...report(seed), synonyms: ["alternate"], includeTerms: ["child"], from: 2023 });
  const app = setup(() => assert.fail("Fresh search must not request data"), saved, "#new");
  assert.equal(app.get("topic-input").value, "");
  assert.equal(app.get("synonyms-input").value, "");
  assert.equal(app.get("include-input").value, "");
  assert.equal(app.get("from-input").value, "2010");
  assert.equal(app.get("to-input").value, "");
  assert.equal(app.get("search-options").open, false);
  assert.equal(app.get("report-stage").hidden, true);
  assert.equal(app.context.location.hash, "#new");
  assert.equal(app.stored.get("topic-momentum:last-topic"), saved);
  app.submit(); await settle();
  assert.match(app.get("status").textContent, /Add a research topic/);
  const html = source("index.html");
  assert.match(html, /href="app.html#new">Try it out/);
  assert.match(html, /href="app.html#new">Now try your own question/);
});

test("checked evidence labels, low precision and trend warnings survive rendering and offline restoration", async () => {
  let data;
  const app=setup(async()=>({ok:true,json:async()=>data}),null,"#search",null,true);
  data={...report(app),papersKind:"checked",evidence:{version:3,accepted:2,candidates:6,notices:["Few papers match this question exactly","Many matching papers may be off-topic; narrow the search for reliable numbers","The trend may be distorted by off-topic papers."]},
    understanding:{mode:"ai",key:"ai:search:v1:"+"b".repeat(64),sentence:"social media, kids, attention",check:{matched:13,total:20,early:{matched:4,total:10},late:{matched:9,total:10},lowPrecision:true,trendDistorted:true}}};
  app.get("topic-input").value="social media, kids, attention";app.get("topic-input").listeners.input();app.submit();await settle();await settle();
  assert.equal(app.get("papers-heading").textContent,"Key papers");
  assert.equal(app.get("papers-source-note").textContent,"Checked by AI for this question · sorted by citations");
  assert.equal(app.get("experts-check-note").textContent,"Most active in this field · checked by AI");
  assert.match(app.get("understanding-line").textContent,/Checked: 13 of 20/);
  assert.match(app.get("understanding-line").textContent,/Earlier: 40%; later: 90%/);
  assert.equal(app.get("evidence-notice").hidden,false);
  assert.match(app.get("evidence-notice").textContent,/Few papers match/);assert.match(app.get("evidence-notice").textContent,/trend may be distorted/);
  assert.match(app.get("headline").textContent,/may be off-topic/);
  const restored=setup(()=>assert.fail("No network"),app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("papers-heading").textContent,"Key papers");assert.match(restored.get("headline").textContent,/may be off-topic/);
});

test("legacy semantic reports never show unverified papers or experts", () => {
  const seed=setup(()=>assert.fail("No network"));
  const legacy={...report(seed),papersKind:"semantic",understanding:{mode:"ai",check:{matched:23,total:25}}};
  const app=setup(()=>assert.fail("No network"),JSON.stringify(legacy));
  assert.equal(app.get("papers-heading").textContent,"Key papers");
  assert.equal(app.get("experts-check-note").textContent,"Run a question to check its experts.");
  assert(!app.get("understanding-line").textContent.includes("Checked:"));assert.equal(app.get("evidence-notice").hidden,true);
});

for(const question of ["social media, kids, attention","Is children’s mental health a growing field in the Middle East, and who’s leading it?","Does gamification help primary school pupils learn mathematics?","How is research on CRISPR for sickle cell disease growing?","What research links air pollution to asthma in children?","How does sleep affect memory in teenagers?","Which researchers study epigenetics during pregnancy?","How is research on battery recycling developing since 2020?"]) test("exact eval question shows the reset notice and no unchecked report when AI is unavailable: "+question,async()=>{
  const message="Today's AI checks are used up. They reset at 01:00 (Rome time). Saved reports and the Library still work.";
  const seed=setup(()=>assert.fail("No requests"));
  const app=setup(async()=>({ok:false,status:503,json:async()=>({error:"ai_unavailable",message,aiReason:"daily_ai_limit"})}),JSON.stringify(report(seed)),"#search",null,true);
  app.get("topic-input").value=question;app.get("topic-input").listeners.input();app.submit();await settle();await settle();
  assert.equal(app.get("status").textContent,message);assert.equal(app.get("report-stage").hidden,true);
  assert(!app.get("papers").innerHTML.includes('<article'));assert(!app.get("experts").innerHTML.includes('class="rank-name"'));
  assert(!app.get("understanding-line").textContent.includes("Quick mode"));
});


test("clarification shows one escaped question with native buttons, and submits only the stored choice",async()=>{
 const requests=[],question="solar energy in Georgia",key="ai:clarify:v1:11111111-1111-4111-8111-111111111111";
 const app=setup(async(_url,options)=>{
  requests.push(JSON.parse(options.body));
  return {ok:true,json:async()=>({clarification:{key,question:'Which Georgia <country>?',options:[{label:'The country & region'},{label:'The US state'}]},aiReason:"clarification"})};
 },null,"#search",null,true);
 app.get("topic-input").value=question;app.get("topic-input").listeners.input();app.submit();await settle();await settle();
 assert.equal(requests.length,1);assert.equal(app.get("search-clarification").hidden,false);assert.equal(app.get("report-stage").hidden,true);
 assert.match(app.get("search-clarification").innerHTML,/Which Georgia &lt;country&gt;/);assert.match(app.get("search-clarification").innerHTML,/type="button" data-clarify="0"/);assert.match(app.get("search-clarification").innerHTML,/The country &amp; region/);
 assert.equal(app.get("status").hidden,true);
 app.click({clarify:"1"});await settle();await settle();
 assert.deepEqual(requests[1],{sentence:question,placeMode:"authored",clarification:{key,option:1}});assert(!requests[1].plan);
 app.get("topic-input").value="a new topic";app.get("topic-input").listeners.input();assert.equal(app.get("search-clarification").hidden,true);
 const before=requests.length;app.click({clarify:"0"});await settle();assert.equal(requests.length,before);
 const html=source("app.html");assert.match(html,/id="search-clarification"[^>]*role="group"[^>]*aria-labelledby="clarification-question"/);
 const css=source("styles.css");assert.match(css,/search-clarification button\{min-height:44px/);assert.match(css,/search-clarification button:focus-visible/);
});
test("self-check advisory shows the returned plan persistently and hides old paper/expert lists",async()=>{
 const seed=setup(()=>assert.fail("No requests"));
 const message="Your search plan is ready, but its final AI self-check took too long.";
 const app=setup(async()=>({ok:true,json:async()=>({planOnly:true,message,plan:{topic:"screen time <safe>",includeGroups:[{terms:["language development"]},{preset:"children"}],place:{codes:[],mode:"mentions"},years:{from:2020,to:null},excludeTerms:[]}})}),JSON.stringify(report(seed)),"#search",null,true);
 app.get("topic-input").value="How is screen time research changing?";app.get("topic-input").listeners.input();app.submit();await settle();await settle();
 assert.equal(app.get("report-stage").hidden,true);assert.equal(app.get("status").hidden,false);
 assert.match(app.get("status").textContent,/Search plan: screen time <safe>/);assert.match(app.get("status").textContent,/language development/);assert.match(app.get("status").textContent,/self-check took too long/);
 assert.equal(app.get("papers").innerHTML,"");assert.equal(app.get("experts").innerHTML,"");assert.equal(app.get("search-clarification").hidden,true);
});
for(const [name,count] of [["Europe",49],["the Middle East",16],["MENA",20],["the Nordic countries",5]])test("region chip defaults to authors and switches only mode before inference: "+name,async()=>{
 const requests=[],question="autism in "+name;
 const app=setup(async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:false,json:async()=>({error:"ai_unavailable",message:"Offline fixture"})};},null,"#search",null,true);
 app.get("topic-input").value=question;app.get("topic-input").listeners.input();
 const resolved=app.context.TMM_PLACES.resolve(question);
 assert.match(app.get("understood-chips").innerHTML,/Authors based in:/);assert(app.get("understood-chips").innerHTML.includes("("+count+" countries)"));assert.equal(requests.length,0);
 app.click({placeToggle:"true"});assert.match(app.get("understood-chips").innerHTML,/Mentioned in title\/abstract:/);assert.equal(requests.length,0);
 assert.deepEqual(Array.from(app.context.TMM_PLACES.resolve(question,"mentions").codes),Array.from(resolved.codes));
 app.submit();await settle();await settle();assert.deepEqual(requests[0],{sentence:question,placeMode:"mentions"});
});
test("region removal changes the question, so a following AI search cannot restore it",async()=>{
 const requests=[],app=setup(async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:false,json:async()=>({error:"ai_unavailable",message:"Offline fixture"})};},null,"#search",null,true);
 app.get("topic-input").value="autism in Europe and the Middle East";app.get("topic-input").listeners.input();
 assert(app.get("understood-chips").innerHTML.includes("64 countries"));app.click({draftRemove:"place"});
 assert.equal(app.get("topic-input").value,"autism");assert(!app.get("understood-chips").innerHTML.includes("Authors based in:"));
 app.submit();await settle();await settle();assert.deepEqual(requests[0],{sentence:"autism"});
});
test("regional subject wording starts in mentions and still permits an author-location switch",()=>{
 const app=setup(()=>assert.fail("Preview stays offline"),null,"#search",null,true);
 app.get("topic-input").value="research about European policy";app.get("topic-input").listeners.input();
 assert.match(app.get("understood-chips").innerHTML,/Mentioned in title\/abstract: Europe/);
 app.click({placeToggle:"true"});assert.match(app.get("understood-chips").innerHTML,/Authors based in: Europe \(49 countries\)/);
});
