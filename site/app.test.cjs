const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = (name) => readFileSync(__dirname + "/" + name, "utf8");
const settle = () => new Promise(setImmediate);

function setup(fetch, saved = null, initialHash = "#search", summaries = null) {
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
  const context = vm.createContext({ document: doc, location, history, URL, URLSearchParams, Blob, AbortController,
    Intl, console, fetch, setTimeout: () => 1, clearTimeout() {},
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  });
  vm.runInContext('window = globalThis; windowListeners = {}; window.addEventListener = (type, fn) => { windowListeners[type] = fn; };', context);
  for (const name of ["config.js", "sample-topic.js", "app.js"]) vm.runInContext(source(name), context);
  return { context, stored, navigate(hash) { context.location.hash = hash; }, get: doc.getElementById, copied: () => copied,
    submit() { doc.getElementById("search-form").listeners.submit({ preventDefault() {} }); },
    click(dataset) { const button = { dataset }; doc.listeners.click({ target: { closest: () => button } }); }
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

test("open ranges survive combined searches, sub-topics, exploration, cache-only cards, reload and history", async () => {
  const { normaliseQuery, shapeTopic } = await import("../worker/lib.js");
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field"];
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
  assert.equal(app.get("topic-name").textContent, "moss + child / children · since 2023");
  assert.match(app.get("headline").textContent, /since 2023/);
  assert.match(app.get("kpis").innerHTML, /GROWTH 2023–2025/);
  assert(!app.get("year-chart").innerHTML.includes("2022:"));
  assert(app.get("year-chart").innerHTML.includes("2023:"));
  assert.equal(app.get("subtopics-note").textContent, "2024–2025 vs. 2023 · total change");
  assert.equal(app.get("experts-note").textContent, "Since 2023");
  app.click({ subtopic: "T123", title: "Orbital logic" }); await settle();
  assert.equal(calls.at(-1).get("from"), "2023");
  assert.equal(calls.at(-1).get("include"), "child,children");
  assert.equal(new URLSearchParams(app.get("back-parent").href.slice(1)).get("from"), "2023");
  app.click({ nextTerm: "genetics" }); await settle();
  assert.equal(calls.at(-1).get("from"), "2023");
  assert.equal(calls.at(-1).get("include"), "child,children");
  app.context.history.back(); await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic + child / children · since 2023");
  app.context.history.back(); await settle();
  assert.equal(app.context.location.hash, mainHash);
  app.get("from-input").value = "2025";
  app.submit(); await settle();
  assert.equal(app.get("subtopics-heading").textContent, "Sub-topics by paper count");
  assert.equal(app.get("subtopics-metric").textContent, "PAPERS");
  assert(!app.get("subtopics").innerHTML.includes("%"));
  assert(!app.get("subtopics").innerHTML.includes("New"));
  assert.match(app.get("kpis").innerHTML, /LARGEST SUB-TOPIC/);
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
  assert.equal(reopened.get("topic-name").textContent, "Orbital logic + child / children · since 2023");
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
  for (const [from, to, message] of [["", "", "From year"], ["1999", "", "From year"], [String(currentYear + 1), "", "From year"], ["2020", "bad", "To year"], ["2020", String(currentYear + 1), "To year"], ["2025", "2020", "From must be earlier"]]) {
    app.get("from-input").value = from;
    app.get("to-input").value = to;
    app.submit(); await settle();
    assert(app.get("status").textContent.includes(message));
    assert.equal(app.get("from-input").disabled, false);
  }
  assert(source("index.html").includes('data-range-preset="2024"'));
});

test("bounded ranges keep both years across report links, exploration, My library, restoration and CSV", async () => {
  const { normaliseQuery, shapeTopic } = await import("../worker/lib.js");
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field"];
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
  assert.equal(app.get("topic-name").textContent, "moss + child · 2015–2020");
  assert.match(app.get("headline").textContent, /2015–2020/);
  assert.match(app.get("kpis").innerHTML, /GROWTH 2015–2020/);
  assert.equal(app.get("experts-heading").textContent, "Leading experts");
  assert.equal(app.get("experts-note").textContent, "2015–2020");
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
  assert.equal(reopened.get("topic-name").textContent, "Orbital logic + child · 2015–2020");
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
  assert.equal(restored.get("experts-heading").textContent, "Active since 2020");
  assert.equal(restored.get("journals-note").textContent, "Since 2020");
  assert.equal(restored.get("papers-period").textContent, "Since 2022");
  assert.equal(JSON.parse(restored.stored.get("topic-momentum:last-topic")).kpis.total, saved.kpis.total);
});

test("restored reports use compact labels and hide suggestions already in any search group", () => {
  const initial = setup(async () => assert.fail("No request needed"));
  const saved = { ...report(initial), name: "epigenetics + (children OR infant)", includeTerms: ["children", "infant"],
    searchTerms: { name: "epigenetics", synonyms: ["neural implant"] }, synonyms: ["neural implant"],
    headline: "Research on epigenetics + (children OR infant) is growing.",
    suggestedSynonyms: ["Children", "epigenetics", "neural implant", "infant", "brain signals"] };
  const app = setup(async () => assert.fail("Restoration must stay offline"), JSON.stringify(saved));
  assert.equal(app.get("topic-name").textContent, "epigenetics + children / infant");
  assert.equal(app.get("headline").textContent, "Research on epigenetics + children / infant is growing.");
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
  assert.equal(app.get("topic-name").textContent, "neurotechnology + Children 0–9");
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
  assert.deepEqual(Object.keys(summaries[0]).sort(), ["id", "name", "parent", "field", "momentum", "growth", "total", "spark", "updated"].sort());
  assert.equal(summaries[0].spark.length, 10);
  const restored = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => new URL(url).pathname === "/api/library" ? [] : data }; }, null, "#library", summaries);
  await settle();
  assert(restored.get("library-cards").innerHTML.includes("neurotechnology + child / children"));
  const link = libraryLinks(restored)[0];
  const params = new URLSearchParams(link.slice(1));
  assert.equal(params.get("include"), "child,children");
  assert.equal(params.get("cache"), "only");
  restored.navigate(link); await settle();
  assert.equal(calls.at(-1).searchParams.get("cache"), "only");
  restored.navigate("#library"); await settle();
  restored.click({ removeReport: data.id });
  assert.equal(restored.stored.get("topic-momentum:my-library"), "[]");
  assert.equal(restored.get("library-empty").textContent, "Your library is empty. Search a topic and it will appear here.");
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
  assert.equal(app.get("library-count").textContent, "2 TOPICS · 1 SUB-TOPIC EXPLORED");
  const cards = app.get("library-cards").innerHTML;
  assert.equal((cards.match(/<article /g) || []).length, 2);
  assert.equal((cards.match(/class="mini-chart"/g) || []).length, 1);
  assert.match(cards, /2016: 0 papers/);
  assert.match(cards, /2025: 9 papers/);
  assert(!cards.includes("2026:"));
  assert.match(cards, /Updated 2026-10-01 · 1 paper</);
  assert(!cards.includes("Sample data"));
  assert.match(app.get("fields").innerHTML, /Computer Science<\/span><span class="number">1<\/span>/);
  app.get("all-topics-tab").listeners.click();
  const links = libraryLinks(app);
  assert(links.every((href) => new URLSearchParams(href.slice(1)).get("cache") === "only"));
  const child = links.map((href) => new URLSearchParams(href.slice(1))).find((params) => params.has("sub"));
  assert.equal(child.get("sub"), "T123");
  assert.equal(child.get("topic"), "zeta moss logic");
  assert.equal(child.get("syn"), "moon circuits");
  app.get("library-sort").value = "name";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("alpha spore mapping ↗") < app.get("library-cards").innerHTML.indexOf("zeta moss logic ↗"));
  app.get("library-sort").value = "updated";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("alpha spore mapping ↗") < app.get("library-cards").innerHTML.indexOf("zeta moss logic ↗"));
  app.get("library-sort").value = "momentum";
  app.get("library-sort").listeners.change();
  assert(app.get("library-cards").innerHTML.indexOf("zeta moss logic ↗") < app.get("library-cards").innerHTML.indexOf("alpha spore mapping ↗"));
  app.click({ field: "Biology" });
  assert.equal(app.get("library-count").textContent, "1 TOPIC · 0 SUB-TOPICS EXPLORED");
  assert(!app.get("library-cards").innerHTML.includes("zeta moss logic"));
  app.click({ field: "All fields" });
  for (const text of ["MOON CIRCUITS", "orbital processors"]) {
    app.get("library-search").value = text;
    app.get("library-search").listeners.input();
    assert.equal(app.get("library-count").textContent, "1 TOPIC · 1 SUB-TOPIC EXPLORED");
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
  assert.equal(app.get("library-empty").textContent, "Your library is empty. Search a topic and it will appear here.");
  const disconnected = setup(async () => { throw new TypeError("Failed to fetch"); }, null, "#library");
  await settle();
  assert.equal(disconnected.get("library-error").textContent, "Can’t reach the data service. Start the Worker and try again.");
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
  assert.equal(app.get("library-count").textContent, "2 TOPICS · 1 SUB-TOPIC EXPLORED");
});

test("saved report links and reloads preserve dates and surface Worker failures without a second request", async () => {
  let data;
  const calls = [];
  const hash = "#topic=fixture+topic&cache=only";
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; }, null, hash);
  data = { ...report(app), cached: true, stale: true, updated: "2026-09-01" };
  await settle();
  assert.match(app.get("topic-meta").textContent, /Updated 2026-09-01/);
  assert.match(app.get("topic-meta").textContent, /older than 7 days/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("cache"), "only");
  const restored = setup(() => assert.fail("Restoring a report must not fetch"), app.stored.get("topic-momentum:last-topic"), hash);
  assert.equal(restored.get("topic-name").textContent, "fixture topic");
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
  const names = ["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const q = normaliseQuery("lunar moss computing");
  const date = new Date("2026-11-01T12:00:00Z");
  const old = { ...shapeTopic(q, responses, new Date("2026-10-01T12:00:00Z")), name: "Legacy title" };
  const original = JSON.stringify({ savedAt: date.getTime(), topic: old });
  const kv = new MemoryKV([["topic:" + old.id, original], ["library", JSON.stringify(updateLibrary([], old))]]);
  let sourceCalls = 0;
  const worker = createWorker(async (url) => {
    sourceCalls++;
    const descriptor = buildQueries(q, 2026).find(({ params }) => Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value));
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
  assert.equal(sourceCalls, 11);
  assert.equal(app.get("topic-name").textContent, "lunar moss computing · since 2010");
  assert.match(app.get("topic-meta").textContent, /Updated 2026-11-01/);
  assert.equal(kv.values.get("topic:" + old.id), original);
  assert(kv.values.has("v2:topic:" + old.id));
  app.navigate("#library"); await settle();
  assert.equal(requests.filter((url) => url.pathname === "/api/library").length, 2);
});

test("library and child links open real Worker cache records without any OpenAlex calls or counter changes", async () => {
  const { createWorker } = await import("../worker/worker.js");
  const { normaliseQuery, shapeTopic, updateLibrary } = await import("../worker/lib.js");
  const { MemoryKV } = await import("../worker/kv-fixture.js");
  const names = ["years", "experts", "early", "late", "countries", "journals", "papers", "keywords", "field", "uae", "gcc"];
  const responses = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(__dirname + "/../worker/fixtures/" + name + ".json", "utf8"))]));
  const saved = new Date("2026-10-31T12:00:00Z");
  const parent = shapeTopic(normaliseQuery("lunar moss computing", "moon circuits"), responses, saved);
  const child = shapeTopic({ ...normaliseQuery("lunar moss computing", "moon circuits", "T123"), subtopicName: "Orbital logic", parent: parent.id }, responses, saved);
  const kv = new MemoryKV();
  kv.values.set("library", JSON.stringify(updateLibrary(updateLibrary([], parent), child)));
  for (const topic of [parent, child]) kv.values.set("v2:topic:" + topic.id, JSON.stringify({ savedAt: saved.getTime(), topic }));
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
  assert.equal(app.get("topic-name").textContent, "Orbital logic · since 2010");
  assert.equal(app.get("topic-input").value, "lunar moss computing");
  assert.match(app.get("topic-meta").textContent, /Under lunar moss computing/);
  assert.match(app.get("topic-meta").textContent, /older than 7 days/);
  assert.equal(calls[1].searchParams.get("subtopic"), "T123");
  assert.equal(calls[1].searchParams.get("cache"), "only");
  const backLink = app.get("back-parent").href;
  assert.equal(new URLSearchParams(backLink.slice(1)).get("cache"), "only");
  app.navigate(backLink);
  await settle();
  assert.equal(app.get("topic-name").textContent, "lunar moss computing · since 2010");
  app.context.history.back();
  await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic · since 2010");
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, "#library");
  assert.equal(calls.length, 3);
  assert.equal(kv.writes.length, 0);
  assert.deepEqual(kv.reads, ["library", "v2:topic:" + child.id, "v2:topic:" + parent.id]);
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
  assert.equal(calls[0].origin, "http://127.0.0.1:8787");
  assert.equal(calls[0].searchParams.get("syn"), "alternate");
  assert.match(app.get("regional-counts").textContent, /UAE: 0 papers · GCC: 12 papers/);
  assert.match(app.get("kpis").innerHTML, /Not enough data/);
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
  assert.equal(app.copied(), data.headline);
  const restored = setup(() => assert.fail("Restoring must not call the network"), app.stored.get("topic-momentum:last-topic"));
  assert.equal(restored.get("topic-name").textContent, "fixture topic");
  assert.equal(restored.get("report-source").textContent, "OPENALEX");
});

test("site keeps the sample on network failure and shows the required message", async () => {
  const app = setup(async () => { throw new TypeError("Failed to fetch"); }, "invalid JSON");
  app.submit();
  await settle();
  assert.equal(app.get("status").textContent, "Can’t reach the data service. Start the Worker and try again.");
  assert.equal(app.get("report-source").textContent, "SAMPLE DATA");
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
  assert(source("index.html").includes("No papers found for this topic. Check the spelling or add synonyms."));
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
  assert.match(app.get("topic-meta").textContent, /Under Parent Topic/);
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
  assert.equal(app.get("back-parent").textContent, "← Back to Parent Topic");
  assert.equal(app.get("back-parent").href, parentHash);
  assert.equal(app.get("back-parent").hidden, false);
  assert.match(app.get("topic-meta").textContent, /Under Parent Topic/);
  assert.equal(app.get("subtopics-panel").hidden, true);
  assert.match(app.get("kpis").innerHTML, /TOP COUNTRY/);
  assert.match(app.get("kpis").innerHTML, /Test country/);
  assert(!app.get("kpis").innerHTML.includes("FASTEST-GROWING"));
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, parentHash);
  assert.equal(app.get("topic-name").textContent, "fixture topic");
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

test("child Explore next uses parent plus suggested term as an ordinary text search and hides when empty", async () => {
  const calls = [];
  let data;
  const app = setup(async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => data }; });
  data = { ...report(app), name: "Child", subtopicId: "T123", suggestedSynonyms: ["genetics"] };
  app.get("topic-input").value = "Parent Topic";
  app.submit();
  await settle();
  assert.match(app.get("explore-next").innerHTML, /data-next-term="genetics"/);
  assert.equal(app.get("explore-section").hidden, false);
  app.click({ nextTerm: "genetics" });
  await settle();
  assert.equal(calls[1].searchParams.get("q"), "Parent Topic genetics");
  assert.equal(calls[1].searchParams.get("syn"), "");
  assert.equal(calls[1].searchParams.has("subtopic"), false);
  data.suggestedSynonyms = [];
  app.submit();
  await settle();
  assert.equal(app.get("explore-section").hidden, true);
  data = { ...report(app), exploreNext: [] };
  app.submit();
  await settle();
  assert.equal(app.get("explore-section").hidden, true);
});

test("paper and citation counts use singular and plural wording", async () => {
  let data;
  const app = setup(async () => ({ ok: true, json: async () => data }));
  data = report(app);
  data.years = [{ year: 2025, count: 1 }, { year: 2026, count: 2 }];
  data.subtopics = [{ name: "One", late: 1, growth: 0 }, { name: "Two", late: 2, growth: 0 }];
  data.regionalCounts = { uae: 1, gcc: 2 };
  data.papers[0].citations = 1;
  app.submit();
  await settle();
  assert.match(app.get("year-chart").innerHTML, /2025: 1 paper</);
  assert.match(app.get("year-chart").innerHTML, /2026: 2 papers/);
  assert.match(app.get("subtopics").innerHTML, /1 paper in late period/);
  assert.match(app.get("subtopics").innerHTML, /2 papers in late period/);
  assert.match(app.get("regional-counts").textContent, /UAE: 1 paper · GCC: 2 papers/);
  assert.match(app.get("papers").innerHTML, /1 CITATION</);
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
  assert.equal(app.get("topic-name").textContent, "fixture topic");
  release({ ok: true, json: async () => ({ ...data, name: "Stale report" }) });
  await settle();
  assert.equal(app.get("topic-name").textContent, "fixture topic");
  assert.equal(app.context.location.hash, parentHash);
  assert.equal(app.get("topic-input").disabled, false);
});

test("new browsers default to an empty personal library and public browsing excludes variants", async () => {
  const entries = libraryFixture();
  entries.push({ ...entries[0], id: 'main|include:["private"]', name: "Private variant", variant: true });
  const app = setup(async () => ({ ok: true, json: async () => entries }), null, "#library");
  await settle();
  assert.equal(app.get("library-empty").textContent, "Your library is empty. Search a topic and it will appear here.");
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
  assert.equal((app.get("library-cards").innerHTML.match(/Remove from my library/g) || []).length, 3);
  const child = libraryLinks(app).find((link) => new URLSearchParams(link.slice(1)).has("sub"));
  const params = new URLSearchParams(child.slice(1));
  assert.equal(params.get("sub"), "T123");
  assert.equal(params.get("topic"), entries[0].name);
  app.click({ removeReport: entries[0].id });
  const restored = setup(fetch, null, "#library", JSON.parse(app.stored.get("topic-momentum:my-library")));
  await settle();
  assert.equal((restored.get("library-cards").innerHTML.match(/Remove from my library/g) || []).length, 2);
  assert.match(restored.get("library-cards").innerHTML, /Orbital processors/);
});
