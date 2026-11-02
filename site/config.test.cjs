const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = readFileSync(__dirname + "/config.js", "utf8");

test("local and hosted pages default to the deployed Worker", () => {
  for (const url of ["file:///C:/site/index.html", "http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "https://michelegambino24-sudo.github.io/Topic-Momentum/"]) {
    const location = new URL(url);
    const context = { location, URLSearchParams, window: {} };
    vm.runInNewContext(source, context);
    if (location.hostname.endsWith("github.io")) {
      assert.match(context.window.WORKER_URL, /^https:\/\/topic-momentum-meter\.[a-z0-9-]+\.workers\.dev$/);
      assert.equal(new URL(context.window.WORKER_URL).origin, context.window.WORKER_URL);
    }
    assert.equal(context.window.WORKER_URL, source.match(/const deployedWorkerUrl = "([^"]+)"/)[1]);
  }
});

test("worker=local opts local previews in without changing hosted pages", () => {
  for (const url of ["http://localhost:8000/?worker=local", "http://127.0.0.1:8000/?worker=local", "file:///C:/site/index.html?worker=local", "https://sample.example/?worker=local", "http://localhost:8000/?worker=other"]) {
    const location = new URL(url);
    const context = { location, URLSearchParams, window: {} };
    vm.runInNewContext(source, context);
    assert.equal(context.window.WORKER_URL, (location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname)) && location.searchParams.get("worker") === "local" ? "http://127.0.0.1:8787" : source.match(/const deployedWorkerUrl = "([^"]+)"/)[1]);
  }
});
