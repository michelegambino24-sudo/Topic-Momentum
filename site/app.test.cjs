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

test("cache-only report links and reloads preserve the original date and never retry a missing report as a search", async () => {
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
    return { ok: false, json: async () => ({ message: "This saved report is unavailable. Enter the topic and select Measure momentum to search again." }) };
  }, null, hash);
  await settle();
  assert.equal(missingCalls.length, 1);
  assert.equal(missingCalls[0].searchParams.get("cache"), "only");
  assert.match(missing.get("status").textContent, /This saved report is unavailable/);
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
  for (const topic of [parent, child]) kv.values.set("topic:" + topic.id, JSON.stringify({ savedAt: saved.getTime(), topic }));
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
  assert.match(app.get("topic-meta").textContent, /Under lunar moss computing/);
  assert.match(app.get("topic-meta").textContent, /older than 7 days/);
  assert.equal(calls[1].searchParams.get("subtopic"), "T123");
  assert.equal(calls[1].searchParams.get("cache"), "only");
  const backLink = app.get("back-parent").href;
  assert.equal(new URLSearchParams(backLink.slice(1)).get("cache"), "only");
  app.navigate(backLink);
  await settle();
  assert.equal(app.get("topic-name").textContent, "lunar moss computing");
  app.context.history.back();
  await settle();
  assert.equal(app.get("topic-name").textContent, "Orbital logic");
  app.context.history.back();
  await settle();
  assert.equal(app.context.location.hash, "#library");
  assert.equal(calls.length, 3);
  assert.equal(kv.writes.length, 0);
  assert.deepEqual(kv.reads, ["library", "topic:" + child.id, "topic:" + parent.id]);
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
