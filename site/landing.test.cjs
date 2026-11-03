const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const source = (name) => readFileSync(__dirname + "/" + name, "utf8");

test("the landing page forwards old report and Library links to the tool", () => {
  const html = source("index.html");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [hash, expected] of [["#topic=epigenetics", "app.html#topic=epigenetics"], ["#library", "app.html#library"], ["#search", "app.html#search"], ["", null], ["#main", null]]) {
    let replaced = null;
    new Function("location", script)({ hash, search: "", replace: (url) => { replaced = url; } });
    assert.equal(replaced, expected, hash || "(no hash)");
  }
});

test("the landing page links to the tool and never calls the Worker or the AI", () => {
  const html = source("index.html"), script = source("landing.js");
  assert(html.includes('href="app.html"'));
  assert(!/fetch\(|XMLHttpRequest|WORKER_URL|\/api\//.test(script), "The demo must only use saved data");
  assert(!html.includes("config.js") && !html.includes("app.js"));
  assert(source("landing.css").includes("prefers-reduced-motion"));
});

test("demo numbers come only from saved real data", () => {
  const script = source("landing.js");
  assert(script.includes("window.TMM_DEMO") && script.includes("window.LANDING_EXAMPLES"));
  const example = source("landing-example.js");
  assert(/Real OpenAlex counts/.test(example));
});

// Exercise the real canvas controller with a local DOM/clock double; no network or browser.
function particleHarness(reduced = false) {
  const { runInNewContext } = require("node:vm");
  const callbacks = {}, frames = new Map();
  let serial = 0, time = 0, drawing = [];
  const brush = {
    clearRect() { drawing = []; }, setTransform() {}, fillRect() {},
    drawImage(_sprite, ...position) { drawing.push(position); },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  const element = () => ({
    style: {}, hidden: false, disabled: true, attributes: {}, events: {},
    getContext: () => brush,
    getBoundingClientRect: () => ({ width: 560, height: 560, left: 0, top: 0 }),
    addEventListener(name, fn) { this.events[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const html = source("index.html");
  const buttons = [...html.matchAll(/<button[^>]*data-shape="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match => ({ ...element(), dataset: { shape: match[1] }, textContent: match[2] }));
  const ids = Object.fromEntries(["hero-visual", "research-particles", "shape-caption", "particle-pause"].map(id => [id, element()]));
  ids["hero-visual"].querySelectorAll = () => buttons;
  const document = { hidden: false, documentElement: {}, getElementById: id => ids[id], createElement: element, addEventListener(name, fn) { callbacks[name] = fn; } };
  const media = { matches: reduced, addEventListener(_name, fn) { callbacks.motion = fn; } };
  const window = { addEventListener() {}, TMM_DEMO: { partialYear: 2026, years: [{year: 2024, count: 10}, {year: 2025, count: 20}, {year: 2026, count: 1}] } };
  const sandbox = {
    window, document, matchMedia: query => query.includes("reduced") ? media : { matches: false },
    getComputedStyle: () => ({ getPropertyValue: key => key === "--clear" ? "transparent" : "#C0D5A3" }),
    devicePixelRatio: 3,
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const marker = "// One persistent particle field:";
  runInNewContext(marker + source("landing.js").split(marker)[1], sandbox);
  const advance = duration => {
    for (let remaining = duration; remaining > 0;) {
      const delta = Math.min(64, remaining); remaining -= delta; time += delta;
      const queued = [...frames]; frames.clear(); queued.forEach(([, fn]) => fn(time));
    }
  };
  return { buttons, ids, frames, document, callbacks, media, advance,
    click: name => buttons.find(button => button.dataset.shape === name).events.click(),
    active: () => buttons.find(button => button.attributes["aria-pressed"] === "true")?.dataset.shape,
    picture: () => JSON.stringify(drawing)
  };
}

test("the four particle shapes follow the story and buttons interrupt, hold and resume the loop", () => {
  const h = particleHarness();
  assert.deepEqual(h.buttons.map(button => button.textContent), ["Search", "Growth", "Where", "Experts"]);
  assert(h.buttons.every(button => !button.disabled));
  assert.equal(h.active(), "search");
  h.advance(1600); assert.equal(h.active(), "growth");
  h.advance(1500); assert.equal(h.active(), "where");
  h.advance(1500); assert.equal(h.active(), "experts");
  h.advance(1500); assert.equal(h.active(), "search");
  h.click("growth"); h.advance(700);
  const interrupted = h.picture();
  h.click("experts");
  assert.equal(h.picture(), interrupted, "Retargeting must not jump to a previous shape");
  assert.equal(h.active(), "experts");
  h.advance(7900); assert.equal(h.active(), "experts");
  h.advance(200); assert.equal(h.active(), "search");
  h.ids["particle-pause"].events.click();
  assert.equal(h.frames.size, 0, "Pause freezes a morph immediately");
  assert.equal(h.ids["research-particles"].width, 1120, "Pixel ratio is capped at two");
});

test("reduced motion starts with a still globe and buttons switch all four shapes instantly", () => {
  const h = particleHarness(true);
  assert.equal(h.active(), "where");
  const globe = h.picture();
  h.advance(30000); assert.equal(h.picture(), globe); assert.equal(h.frames.size, 0);
  const pictures = new Set();
  for (const name of ["search", "growth", "where", "experts"]) {
    h.click(name); assert.equal(h.active(), name);
    pictures.add(h.picture()); const still = h.picture();
    h.advance(30000); assert.equal(h.picture(), still); assert.equal(h.frames.size, 0);
  }
  assert.equal(pictures.size, 4, "Every control must render a distinct shape");
  h.click("where"); assert.equal(h.picture(), globe);
  assert.equal(h.ids["shape-caption"].textContent, "See which countries publish most.");
  assert(!source("index.html").includes('id="expert-nodes"'));
});

test("particle visibility and a changed motion preference stop the animation clock", () => {
  const h = particleHarness();
  h.advance(4000); h.document.hidden = true; h.callbacks.visibilitychange();
  const still = h.picture(); h.advance(10000); assert.equal(h.picture(), still); assert.equal(h.frames.size, 0);
  h.document.hidden = false; h.callbacks.visibilitychange(); assert.equal(h.frames.size, 1);
  h.media.matches = true; h.callbacks.motion(); assert.equal(h.active(), "where"); assert.equal(h.frames.size, 0);
  h.click("search"); assert.equal(h.active(), "search"); assert.equal(h.frames.size, 0);
});

test("particle shapes stay gently in motion during a rest and the steps precede the demo", () => {
  const h = particleHarness();
  h.advance(250);
  const resting = h.picture();
  h.advance(500);
  assert.equal(h.active(), "search");
  assert.notEqual(h.picture(), resting);
  h.ids["particle-pause"].events.click();
  const paused = h.picture(); h.advance(1000); assert.equal(h.picture(), paused);
  const html = source("index.html");
  assert(html.indexOf('id="demo-steps"') < html.indexOf('id="demo-window"'));
});

test("the saved demo answers the regional question with matching filters and real evidence", () => {
  const { runInNewContext } = require("node:vm");
  const context = { window: {} };
  runInNewContext(source("demo-report.js"), context);
  const demo = context.window.TMM_DEMO;
  assert.equal(demo.question, "Is children’s mental health a growing field in the Middle East, and who’s leading it?");
  const params = new URLSearchParams(demo.open.split("#")[1]);
  assert.equal(params.get("topic"), "mental health");
  assert(params.get("include").split(",").includes("children"));
  assert(params.get("authored").split(",").includes("AE"));
  assert(params.get("authored").split(",").includes("EG"));
  assert(demo.chips.includes("Author affiliation: Middle East"));
  assert(demo.kpis.total > 0 && Number.isFinite(demo.kpis.growth));
  assert(demo.years.filter(item => item.year < demo.partialYear && item.count > 0).length >= 5);
  assert.equal(demo.countries.length, 8);
  assert.equal(demo.experts.length, 8);
  assert(demo.experts.every(item => item.name && item.count > 0));
  assert(demo.insights.some(item => item.label === "Leading country"));
});
