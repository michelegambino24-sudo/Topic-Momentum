const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = readFileSync(__dirname + "/config.js", "utf8");

test("local pages use the local Worker; hosted pages use the deployed Worker", () => {
  for (const url of ["file:///C:/site/index.html", "http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "https://michelegambino24-sudo.github.io/Topic-Momentum/"]) {
    const location = new URL(url);
    const context = { location, window: {} };
    vm.runInNewContext(source, context);
    if (location.hostname.endsWith("github.io")) {
      assert.match(context.window.WORKER_URL, /^https:\/\/topic-momentum-meter\.[a-z0-9-]+\.workers\.dev$/);
      assert.equal(new URL(context.window.WORKER_URL).origin, context.window.WORKER_URL);
    }
    assert.equal(context.window.WORKER_URL, location.hostname.endsWith("github.io")
      ? source.match(/const deployedWorkerUrl = "([^"]+)"/)[1]
      : "http://127.0.0.1:8787");
  }
});
