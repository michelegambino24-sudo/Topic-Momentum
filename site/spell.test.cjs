const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs");

function load(vocabulary) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(__dirname + "/search-presets.js", "utf8"), context);
  vm.runInContext(`globalThis.TMM_VOCABULARY = ${JSON.stringify(vocabulary)};`, context);
  vm.runInContext(fs.readFileSync(__dirname + "/spell.js", "utf8"), context);
  return context.TMM_SPELL;
}

test("suggests the closest research word for typos and leaves real words alone", () => {
  const spell = load("epigenetics neurotechnology inheritance economics development methylation pregnancy genetics");
  assert.equal(spell.ready, true);
  const first = text => spell.suggest(text)[0]?.suggestion || null;
  assert.equal(first("epignetics"), "epigenetics");
  assert.equal(first("inheritence law"), "inheritance");
  assert.equal(first("neurotecnology"), "neurotechnology");
  for (const fine of ["epigenetics", "epigenetic", "neurotechnologies", "law and economics", "children", "pregnant", "\"epignetics\""]) assert.equal(first(fine), null, fine);
  assert.equal(spell.apply("Epignetics in children", "Epignetics", "epigenetics"), "Epigenetics in children");
});

test("stays silent without a vocabulary", () => {
  const spell = load("");
  assert.equal(spell.ready, false);
  assert.equal(spell.suggest("epignetics").length, 0);
});
