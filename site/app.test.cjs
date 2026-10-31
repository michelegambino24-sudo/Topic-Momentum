const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = (name) => readFileSync(__dirname + "/" + name, "utf8");
const settle = () => new Promise(setImmediate);

function setup(fetch, saved = null) {
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
  const context = vm.createContext({ document: doc, location: { hash: "#search" }, URL, Blob, AbortController,
    Intl, console, fetch, setTimeout: () => 1, clearTimeout() {},
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  });
  vm.runInContext('window = globalThis; window.addEventListener = () => {};', context);
  for (const name of ["config.js", "sample-topic.js", "sample-library.js", "app.js"]) vm.runInContext(source(name), context);
  return { context, stored, get: doc.getElementById, copied: () => copied,
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
  app.click({ explore: "next topic" });
  await settle();
  assert.equal(calls[2].searchParams.get("q"), "next topic");
  assert.equal(calls[2].searchParams.get("parent"), "fixture topic");
  assert.equal(calls[2].searchParams.get("syn"), "");
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
    const app = setup(async () => ({ ok: false, json: async () => ({ error }) }));
    app.submit();
    await settle();
    assert.equal(app.get("status").textContent, message);
  }
});
