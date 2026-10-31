import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorker } from "./worker.js";
import { buildQueries, normaliseQuery } from "./lib.js";

const date = new Date("2026-10-31T12:00:00Z");
// A non-credential marker. No real API key is used by any test.
const env = { OPENALEX_KEY: "fixture-only-not-a-credential", ENVIRONMENT: "dev", ALLOWED_ORIGIN: "https://sample.example" };
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const request = (path = "/api/topic?q=lunar%20moss%20computing", origin, method = "GET", extra = {}) => new Request(`http://localhost:8787${path}`, { method, headers: { ...(origin === undefined ? {} : { Origin: origin }), ...extra } });
function fixtureFor(url) {
  const params = new URL(url).searchParams;
  const descriptor = buildQueries(normaliseQuery("lunar moss computing"), 2026).find(({ params: expected }) => Object.entries(expected).every(([key, value]) => params.get(key) === value));
  assert(descriptor, "Unexpected query descriptor");
  return fixture(descriptor.id);
}

test("topic endpoint launches all nine requests in parallel and returns the exact topic shape", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const worker = createWorker(async (url, options) => {
    calls.push(url);
    assert.equal(url.origin + url.pathname, "https://api.openalex.org/works");
    assert.equal(url.searchParams.get("api_key"), env.OPENALEX_KEY);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers, undefined);
    assert.equal(url.searchParams.getAll("api_key").length, 1);
    await gate;
    return Response.json(fixtureFor(url));
  }, () => date);
  const pending = worker.fetch(request(undefined, "null"), env);
  assert.equal(calls.length, 9);
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "null");
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const text = await response.text();
  assert(!text.includes(env.OPENALEX_KEY));
  assert(!text.includes("api.openalex.org"));
  const data = JSON.parse(text);
  assert.equal(data.name, "lunar moss computing");
  assert.equal(data.kpis.total, 1992);
  assert.equal(data.cached, false);
  assert.equal(data.papers[1].journal, "Unknown journal");
});

test("missing key gives the required message without any upstream call", async () => {
  const worker = createWorker(() => { assert.fail("Must not call the source"); });
  for (const value of [undefined, "", "   "]) {
    const response = await worker.fetch(request(), { OPENALEX_KEY: value });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "missing_key", message: "OPENALEX_KEY is not set. Add it to worker/.dev.vars." });
  }
});

test("disallowed origins, invalid queries, routes and methods fail before network access", async () => {
  const worker = createWorker(() => { assert.fail("Must not call the source"); });
  for (const [req, expected] of [
    [request(undefined, "https://untrusted.example"), 403],
    [request("/api/library"), 404], [request(undefined, undefined, "POST"), 405],
    [request("/api/topic"), 400], [request("/api/topic?q=%5B%5D%7C%22"), 400],
    [request(`/api/topic?q=${"a".repeat(201)}`), 400],
    [request(`/api/topic?q=moss&syn=${"a".repeat(1201)}`), 400]
  ]) assert.equal((await worker.fetch(req, env)).status, expected);
  const prod = { ...env, ENVIRONMENT: undefined };
  assert.equal((await worker.fetch(request(undefined, "null"), prod)).status, 403);
  assert.equal((await worker.fetch(request(undefined, "http://localhost:3000"), prod)).status, 403);
});

test("preflight reflects only an allowed origin and accepts GET without needing a key", async () => {
  const worker = createWorker(() => { assert.fail("Must not call the source"); });
  for (const origin of ["null", "http://localhost:3000", "https://sample.example"]) {
    const response = await worker.fetch(request(undefined, origin, "OPTIONS", { "Access-Control-Request-Method": "GET" }), { ...env, OPENALEX_KEY: undefined });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  }
  const denied = await worker.fetch(request(undefined, "https://untrusted.example", "OPTIONS"), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await worker.fetch(request(undefined, "null", "OPTIONS", { "Access-Control-Request-Method": "POST" }), env)).status, 405);
});

for (const failure of ["http", "network", "json", "shape"]) {
  test(`a single ${failure} failure rejects the entire topic without exposing upstream details`, async (t) => {
    t.mock.method(console, "error", () => {});
    let calls = 0;
    let signal;
    const worker = createWorker(async (url, options) => {
      calls++;
      signal = options.signal;
      if (url.searchParams.get("group_by") === "keywords.id") {
        if (failure === "http") return new Response("Upstream failure", { status: 429 });
        if (failure === "network") throw new Error(String(url));
        if (failure === "json") return new Response("not json");
        return Response.json({ error: "malformed" });
      }
      return Response.json(fixtureFor(url));
    }, () => date);
    const response = await worker.fetch(request(undefined, "null"), env);
    assert.equal(calls, 9);
    assert.equal(response.status, 502);
    const text = await response.text();
    assert(!text.includes(env.OPENALEX_KEY));
    assert(!text.includes("api.openalex.org"));
    assert.deepEqual(JSON.parse(text), { error: "source_unavailable", message: "The research data source is unavailable. Try again later." });
    // Shape validation happens after requests finish; all earlier failures cancel in-flight work.
    assert.equal(signal.aborted, true);
  });
}

test("successful empty responses return an empty report rather than an upstream error", async () => {
  const worker = createWorker(async (url) => Response.json(fixture(new URL(url).searchParams.has("sort") ? "empty-papers" : "empty-groups")), () => date);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  const data = await response.json();
  assert.equal(data.kpis.total, 0);
  assert.equal(data.kpis.growth5y, null);
});

test("dev logs every failed HTTP query with status and a sanitised, truncated message", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const worker = createWorker(async (url) => {
    const group = url.searchParams.get("group_by");
    if (group === "keywords.id" || group === "primary_topic.field.id") {
      // The second failure arrives later, after the first has been processed.
      if (group === "primary_topic.field.id") await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ error: "Invalid query", message: `Unsupported field. ${url} Key: ${env.OPENALEX_KEY}. ${"x".repeat(400)}` }, { status: 400 });
    }
    return Response.json(fixtureFor(url));
  }, () => date);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.deepEqual(logs.map((args) => args[1].query).sort(), ["field", "keywords"]);
  for (const [prefix, entry] of logs) {
    assert.equal(prefix, "[OpenAlex]");
    assert.equal(entry.status, 400);
    assert.equal(entry.message.length, 300);
    assert(entry.message.startsWith("Unsupported field. [URL removed] Key: [key removed]."));
    assert(!JSON.stringify(entry).includes(env.OPENALEX_KEY));
    assert(!JSON.stringify(entry).includes("api.openalex.org"));
  }
  assert.deepEqual(await response.json(), { error: "source_unavailable", message: "The research data source is unavailable. Try again later." });
});

test("production never logs source failures or reads their error bodies", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  let bodyReads = 0;
  const worker = createWorker(async () => ({ ok: false, status: 400, text() { bodyReads++; throw new Error("Must not read error body"); } }), () => date);
  for (const environment of [undefined, "production", "DEV"]) {
    const response = await worker.fetch(request(), { ...env, ENVIRONMENT: environment });
    assert.equal(response.status, 502);
  }
  assert.equal(logger.mock.callCount(), 0);
  assert.equal(bodyReads, 0);
});

test("dev uses safe messages for network, invalid JSON and unreadable error body failures", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args[1]));
  const worker = createWorker(async (url) => {
    const group = url.searchParams.get("group_by");
    if (group === "keywords.id") throw new Error(String(url));
    if (group === "primary_topic.field.id") return new Response("not json");
    if (group === "authorships.author.id") return { ok: false, status: 503, text() { throw new Error(String(url)); } };
    return Response.json(fixtureFor(url));
  }, () => date);
  assert.equal((await worker.fetch(request(), env)).status, 502);
  assert.equal(logs.length, 3);
  assert.equal(logs.find((entry) => entry.query === "keywords").status, "unavailable");
  assert.equal(logs.find((entry) => entry.query === "field").status, 200);
  assert.equal(logs.find((entry) => entry.query === "experts").status, 503);
  assert(!JSON.stringify(logs).includes(env.OPENALEX_KEY));
  assert(!JSON.stringify(logs).includes("api.openalex.org"));
});

test("manual mode rejects every redirect response without following its Location", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args[1]));
  for (const environment of ["dev", "production"]) {
    for (const status of [300, 301, 302, 303, 304, 305, 307, 308, 399]) {
      let calls = 0;
      const worker = createWorker(async (url, options) => {
        calls++;
        assert.equal(options.redirect, "manual");
        assert.equal(url.origin, "https://api.openalex.org");
        return new Response(null, { status, headers: { Location: "https://untrusted.example/private" } });
      }, () => date);
      const start = logs.length;
      const response = await worker.fetch(request(), { ...env, ENVIRONMENT: environment });
      assert.equal(response.status, 502);
      assert.equal(calls, 9);
      const entries = logs.slice(start);
      assert.equal(entries.length, environment === "dev" ? 9 : 0);
      for (const entry of entries) {
        assert.equal(entry.status, status);
        assert.equal(entry.stage, "http_response");
      }
    }
  }
  assert(!JSON.stringify(logs).includes("https://"));
});

test("dev logs the caught fetch error and cause, while production logs nothing", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args[1]));
  const worker = createWorker(async (url) => {
    const cause = new Error(`TLS connection failed for ${url}; marker ${env.OPENALEX_KEY}`);
    cause.code = "CERT_HAS_EXPIRED";
    throw new TypeError(`fetch failed ${url}`, { cause });
  }, () => date);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.equal(logs.length, 9);
  for (const entry of logs) {
    assert.equal(entry.stage, "fetch");
    assert.equal(entry.status, "unavailable");
    assert.equal(entry.error.name, "TypeError");
    assert.equal(entry.error.message, "fetch failed [URL removed]");
    assert.equal(entry.error.cause.code, "CERT_HAS_EXPIRED");
    assert(entry.error.cause.message.includes("[key removed]"));
  }
  assert(!JSON.stringify(logs).includes(env.OPENALEX_KEY));
  assert(!JSON.stringify(logs).includes("api.openalex.org"));
  assert(!JSON.stringify(logs).includes("stack"));
  assert(!JSON.stringify(await response.json()).includes("CERT_HAS_EXPIRED"));
  logs.length = 0;
  assert.equal((await worker.fetch(request(), { ...env, ENVIRONMENT: "production" })).status, 502);
  assert.equal(logs.length, 0);
});

test("dev catches URL parameter setup errors before fetch and labels their stage", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args[1]));
  const req = request();
  t.mock.method(URLSearchParams.prototype, "set", () => { throw new TypeError(`Parameter setup failed ${env.OPENALEX_KEY}`); });
  const worker = createWorker(() => { assert.fail("Fetch must not run after URL setup fails"); }, () => date);
  const response = await worker.fetch(req, env);
  assert.equal(response.status, 502);
  assert.equal(logs.length, 9);
  for (const entry of logs) {
    assert.equal(entry.stage, "url_setup");
    assert.equal(entry.status, "unavailable");
    assert.equal(entry.error.name, "TypeError");
    assert.equal(entry.error.message, "Parameter setup failed [key removed]");
    assert.equal(entry.error.cause, null);
  }
});

test("dev labels JSON parsing failures and includes the sanitised caught error", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args[1]));
  const worker = createWorker(async () => new Response("not json"), () => date);
  assert.equal((await worker.fetch(request(), env)).status, 502);
  assert.equal(logs.length, 9);
  for (const entry of logs) {
    assert.equal(entry.stage, "response_parsing");
    assert.equal(entry.status, 200);
    assert.equal(entry.error.name, "SyntaxError");
    assert.equal(typeof entry.error.message, "string");
  }
});
