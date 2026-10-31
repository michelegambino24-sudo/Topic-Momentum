const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = (name) => readFileSync(__dirname + "/" + name, "utf8");
const settle = () => new Promise(setImmediate);

function setup(fetch, saved = null, initialHash = "#search") {
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
  let copied;
  const hashes = [initialHash];
  let index = 0;
  const location = {
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
  for (const name of ["config.js", "sample-topic.js", "sample-library.js", "app.js"]) vm.runInContext(source(name), context);
  return { context, stored, navigate(hash) { context.location.hash = hash; }, get: doc.getElementById, copied: () => copied,
    submit() { doc.getElementById("search-form").listeners.submit({ preventDefault() {} }); },
    click(dataset) { const button = { dataset }; doc.listeners.click({ target: { closest: () => button } }); }
  };
}

function report(app) {
  return { ...JSON.parse(JSON.stringify(app.context.SAMPLE_TOPIC)), name: "fixture topic", id: "fixture topic", countries: [], subtopics: [], regionalCounts: { uae: 0, gcc: 12 } };
}

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
