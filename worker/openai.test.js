import test from "node:test";
import assert from "node:assert/strict";
import { buildRequest, createOpenAI, openAIConfigured, ratesFor, unitsPerToken, DEFAULT_MODEL } from "./openai.js";
import { createWorker } from "./worker.js";

const KEY = "sk-test-FAKEKEY1234567890abcdef";
const params = { messages: [{ role: "user", content: "{}" }], max_tokens: 100, temperature: 0, response_format: { type: "json_schema", json_schema: { type: "object", properties: { a: { type: "string" } } } } };

test("the request is built only by the backend: fixed model, bounded tokens, no storage", () => {
  const body = buildRequest("anything", { ...params, max_tokens: 999999, tools: [{ x: 1 }], stream: true, user: "x" }, {});
  assert.equal(body.model, "anything");
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.store, false);
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "response_format", "store", "temperature"]);
  assert.equal(body.response_format.json_schema.name, "result");
  assert.equal(buildRequest("m", params, { OPENAI_MODEL: "gpt-4.1-mini" }).model, "gpt-4.1-mini");
  const reasoning = buildRequest("m", params, { OPENAI_MODEL: "gpt-5-mini" });
  assert(reasoning.max_completion_tokens > 0); assert(!("temperature" in reasoning)); assert(!("max_tokens" in reasoning));
  assert.throws(() => buildRequest("m", { ...params, messages: [] }, {}));
});

test("a missing or blank key fails safely without any network call", async () => {
  let calls = 0;
  for (const env of [{}, { OPENAI_API_KEY: "" }, { OPENAI_API_KEY: "   " }]) {
    assert.equal(openAIConfigured(env), false);
    await assert.rejects(createOpenAI(env, () => { calls++; }).run(DEFAULT_MODEL, params), /not configured/);
  }
  assert.equal(calls, 0);
});

test("the key is sent only to api.openai.com in the Authorization header and costs come from reported tokens", async () => {
  let seen;
  const ai = createOpenAI({ OPENAI_API_KEY: KEY }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":"b"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 });
  });
  const result = await ai.run(DEFAULT_MODEL, params);
  assert.equal(seen.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer " + KEY);
  assert(!seen.init.body.includes(KEY));
  assert.equal(seen.init.redirect, "manual"); // Workers do not support redirect "error"
  assert.equal(result.response, '{"a":"b"}');
  const rate = unitsPerToken({});
  assert.equal(result.usage.neurons, Math.ceil(1000 * rate.input + 100 * rate.output));
  assert(result.usage.neurons > 0 && result.usage.neurons < 100);
});

test("prices can be overridden and invalid prices fall back to the defaults", () => {
  assert.deepEqual(ratesFor({ OPENAI_INPUT_USD_PER_MTOK: "1", OPENAI_OUTPUT_USD_PER_MTOK: "4" }), { inputPerMTok: 1, outputPerMTok: 4 });
  assert.deepEqual(ratesFor({ OPENAI_INPUT_USD_PER_MTOK: "abc", OPENAI_OUTPUT_USD_PER_MTOK: "-1" }), ratesFor({}));
});

test("provider errors expose only the status, never the provider text that can echo the key", async () => {
  const ai = createOpenAI({ OPENAI_API_KEY: KEY }, async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: " + KEY } }), { status: 401 }));
  await assert.rejects(ai.run(DEFAULT_MODEL, params), error => { assert.match(error.message, /HTTP 401/); assert(!error.message.includes("sk-")); return true; });
  const down = createOpenAI({ OPENAI_API_KEY: KEY }, async () => { throw new Error("connect failed for " + KEY); });
  await assert.rejects(down.run(DEFAULT_MODEL, params), error => { assert(!error.message.includes(KEY)); assert.match(error.message, /\(Error\)/); return true; });
  const redirected = createOpenAI({ OPENAI_API_KEY: KEY }, async () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }));
  await assert.rejects(redirected.run(DEFAULT_MODEL, params), /HTTP 302/);
});

test("empty, truncated or unmeasured replies are handled", async () => {
  const reply = body => createOpenAI({ OPENAI_API_KEY: KEY }, async () => new Response(JSON.stringify(body), { status: 200 })).run(DEFAULT_MODEL, params);
  await assert.rejects(reply({ choices: [{ message: { content: null }, finish_reason: "stop" }] }), /empty or truncated/);
  await assert.rejects(reply({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }), /empty or truncated/);
  const unmeasured = await reply({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
  assert.equal(unmeasured.usage, undefined); // the AI service then charges its conservative upper bound
});

test("the Worker builds the OpenAI client only from the server-side secret", async () => {
  const worker = createWorker();
  const env = { TMM: { get: async () => null, put: async () => {} }, ALLOWED_ORIGIN: "https://example.github.io" };
  const response = await worker.fetch(new Request("https://w.example/api/search?phase=prepare", { method: "POST", headers: { Origin: "https://example.github.io", "Content-Type": "application/json" }, body: JSON.stringify({ sentence: "gut microbiome and depression" }) }), env);
  const text = await response.text();
  assert(!/sk-/.test(text));
  assert.notEqual(response.status, 500);
});
