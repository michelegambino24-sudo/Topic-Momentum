const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
require("./search-presets.js");
require("./query-parser.js");
const { parse, merge, countries, people } = globalThis.TMM_QUERY_PARSER;
const fixtures = JSON.parse(readFileSync(__dirname + "/query-parser-fixtures.json", "utf8"));
const currentYear = 2026;
const refine = text => parse(text, currentYear, { refinement: true });
const base = () => ({ topic: "inheritance", synonyms: ["estate"], includeGroups: [["school"]], from: 2015, to: 2025, subfieldId: "3308", subtopicId: "T123" });

for (const row of fixtures) test("sentence fixture: " + row.sentence, () => {
  const result = parse(row.sentence, currentYear);
  assert.equal(result.topic, row.topic);
  assert.deepEqual(result.includeGroups, row.groups);
  assert.equal(result.from, row.from); assert.equal(result.to, row.to);
  assert.deepEqual(result.synonyms, []); assert.deepEqual(result.errors, []); assert.deepEqual(result.ignored, []);
  assert.deepEqual(parse(row.sentence, currentYear), result);
});

test("all approved people aliases use their exact arrays and longest phrase boundaries", () => {
  for (const item of people) for (const alias of item.aliases) {
    const result = parse("sensor research for " + alias, currentYear);
    assert.equal(result.topic, "sensor research"); assert.deepEqual(result.includeGroups, [item.terms]);
  }
  assert.equal(parse("childhood development", currentYear).topic, "childhood development");
  assert.deepEqual(parse("kidney research", currentYear).includeGroups, []);
  assert.deepEqual(parse("sensor research for women and students", currentYear).includeGroups, [["women", "woman", "student", "students"]]);
});

test("all country aliases need location context, apart from uppercase UAE and KSA", () => {
  for (const country of countries) for (const alias of country.terms) {
    const result = parse("sensor research in the " + alias, currentYear);
    assert.equal(result.topic, "sensor research"); assert.deepEqual(result.includeGroups, [country.terms]);
  }
  assert.deepEqual(parse("sensor research in Turkey", currentYear).includeGroups, [["türkiye", "turkish"]]);
  assert.deepEqual(parse("sensor research in Türkiye", currentYear).includeGroups, [["türkiye", "turkish"]]);
  assert.equal(parse("Jordan algebras", currentYear).topic, "Jordan algebras");
  assert.equal(parse("turkey farming", currentYear).topic, "turkey farming");
  assert.equal(parse("sensor UAE", currentYear).topic, "sensor");
  assert.equal(parse("sensor KSA", currentYear).topic, "sensor");
  assert.deepEqual(parse("sensor in Qatar and Kuwait", currentYear).includeGroups, [["qatar", "qatari", "kuwait", "kuwaiti"]]);
});

test("region aliases reuse presets and do not claim MENA or Arab world coverage", () => {
  for (const alias of ["GCC", "Gulf", "Gulf countries", "gulf cooperation council"]) assert.deepEqual(parse("sensor in " + alias, currentYear).includeGroups, [TMM_SEARCH_PRESETS.gcc.terms]);
  for (const alias of ["Middle East", "MENA", "Arab world"]) assert.deepEqual(parse("sensor in " + alias, currentYear).includeGroups, [TMM_SEARCH_PRESETS.middleEast.terms]);
  assert.match(parse("sensor in MENA", currentYear).note, /not a complete country list/);
  assert.match(parse("sensor in Arab world", currentYear).note, /not a complete country list/);
  assert.deepEqual(parse("gulfstream technology", currentYear).includeGroups, []);
});

test("lead-ins are anchored, apostrophes are accepted, and quoted spans stay literal", () => {
  for (const lead of ["I'm looking for", "I’m looking for", "I am looking for", "research on", "papers about", "show me", "studies on", "find"]) assert.equal(parse(lead + " neurotechnology", currentYear).topic, "neurotechnology");
  assert.equal(parse("finding research tools", currentYear).topic, "finding research tools");
  assert.equal(parse('research on "law in the UAE since 2020"', currentYear).topic, "law in the UAE since 2020");
  assert.deepEqual(parse('AI in "health and care", learning', currentYear).includeGroups, [["health and care", "learning"]]);
  assert.deepEqual(parse("AI in “women and students”", currentYear).includeGroups, [["women and students"]]);
  assert.equal(parse("research and development", currentYear).topic, "research and development");
});

test("focus constructions split alternatives only in the focus, retaining phrase terms", () => {
  for (const input of ["AI impact on jobs and wages", "AI effect on jobs and wages", "effects of AI on jobs and wages", "EFFECT OF AI ON jobs and wages", "AI and its impact on jobs and wages", "AI and their impact on jobs and wages", "AI for jobs and wages", "AI in jobs and wages"]) {
    const result = parse(input, currentYear);
    assert.equal(result.topic, "AI"); assert.deepEqual(result.includeGroups, [["jobs", "wages"]]);
  }
  assert.deepEqual(parse("AI in supply chain management and patient care", currentYear).includeGroups, [["supply chain management", "patient care"]]);
});

test("exclusive after, inclusive from/since, all year forms and injected relative years", () => {
  for (const prefix of ["since", "from"]) assert.equal(parse("AI " + prefix + " 2020", currentYear).from, 2020);
  assert.equal(parse("AI after 2020", currentYear).from, 2021);
  for (const range of ["2015 to 2020", "between 2015 and 2020"]) { const result = parse("AI " + range, currentYear); assert.equal(result.from, 2015); assert.equal(result.to, 2020); }
  assert.equal(parse("AI last 5 years", 2030).from, 2025);
  assert.equal(parse("AI last 1 year", currentYear).from, 2025);
  assert.equal(parse("AI", currentYear).explicitRange, false);
  assert.throws(() => parse("AI"), /current year/);
  for (const sentence of ["AI after 2026", "AI since 1999", "AI between 2022 and 2015", "AI last 0 years", "AI last -5 years", "AI last 1.5 years", "AI last 100 years"]) assert(parse(sentence, currentYear).errors.length, sentence);
  assert.match(parse("AI since 2020 from 2021", currentYear).errors.join(" "), /one year range/);
});

test("groups retain sentence order, collapse duplicates, and explicitly name fourth groups", () => {
  const result = parse("AI in Qatar for women in Bahrain among students", currentYear);
  assert.deepEqual(result.includeGroups, [["qatar", "qatari"], ["women", "woman"], ["bahrain", "bahraini"]]);
  assert.deepEqual(result.ignored, ["Students"]); assert.match(result.note, /Not added: Students/);
  const repeated = parse("AI in Qatar for women in Qatar", currentYear);
  assert.deepEqual(repeated.includeGroups, [["qatar", "qatari"], ["women", "woman"]]);
  assert.match(parse("in Qatar since 2020", currentYear).errors.join(" "), /Add a research topic/);
  assert.deepEqual(refine("in Qatar since 2020").errors, []);
  assert(result.spans.every(span => Number.isInteger(span.start) && span.end > span.start));
});

test("Narrow down appends without mutation and preserves all existing search restrictions", () => {
  const current = base(), before = JSON.stringify(current);
  const result = merge(current, refine("in Qatar for women since 2020"), currentYear);
  assert.equal(JSON.stringify(current), before);
  assert.equal(result.topic, "inheritance"); assert.deepEqual(result.synonyms, ["estate"]);
  assert.equal(result.subfieldId, "3308"); assert.equal(result.subtopicId, "T123");
  assert.deepEqual(result.includeGroups, [["school"], ["qatar", "qatari"], ["women", "woman"]]);
  assert.equal(result.from, 2020); assert.equal(result.to, 2025);
  assert.equal(result.noChange, false); assert.deepEqual(result.errors, []);
  assert.deepEqual(merge(current, refine("law and economics"), currentYear).includeGroups.at(-1), ["law and economics"]);
  assert.deepEqual(merge(current, refine("sleep, attention and learning"), currentYear).includeGroups.at(-1), ["sleep", "attention", "learning"]);
  const legacyPunctuation = { ...current, includeGroups: [["healthcare!"]] };
  const distinct = merge(legacyPunctuation, refine("healthcare"), currentYear);
  assert.equal(distinct.noChange, false);
  assert.deepEqual(distinct.includeGroups, [["healthcare!"], ["healthcare"]]);
});

test("Narrow down intersects years, ignores extra whole groups and avoids no-op searches", () => {
  const current = base();
  assert.equal(merge(current, refine("since 2010"), currentYear).noChange, true);
  assert.equal(merge(current, refine("school"), currentYear).noChange, true);
  assert.equal(merge(current, refine(""), currentYear).noChange, true);
  assert.match(merge(current, refine("after 2025"), currentYear).errors.join(" "), /do not overlap/);
  const overlap = merge(current, refine("between 2010 and 2020"), currentYear);
  assert.equal(overlap.from, 2015); assert.equal(overlap.to, 2020);
  const full = { ...current, includeGroups: [["one"], ["two"], ["three"]] };
  const extra = merge(full, refine("in Qatar"), currentYear);
  assert.equal(extra.noChange, true); assert.deepEqual(extra.includeGroups, full.includeGroups);
  assert.deepEqual(extra.ignored, ["Qatar"]); assert.match(extra.note, /Not added: Qatar/);
});

test("Narrow down ignores repeated topic words and simple plurals in literal and focus spans", () => {
  const current = { ...base(), topic: "neurotechnology", includeGroups: [] };
  for (const text of ["neurotechnology", "neurotechnologies", "I am looking for neurotechnologies", "neurotechnologies regarding neurotechnology"]) {
    const parsed = parse(text, currentYear, { refinement: true, currentTopic: current.topic });
    assert.equal(parsed.topic, "");
    assert.deepEqual(parsed.includeGroups, []);
    assert.equal(merge(current, parsed, currentYear).noChange, true);
    // Merge also handles callers that have not supplied the current topic to parse.
    assert.equal(merge(current, refine(text), currentYear).noChange, true);
  }
  const parsed = parse("neurotechnologies concerning neurotechnology and brain interfaces", currentYear, { refinement: true, currentTopic: current.topic });
  assert.deepEqual(parsed.includeGroups, [["brain interfaces"]]);
  assert.deepEqual(merge(current, parsed, currentYear).includeGroups, [["brain interfaces"]]);
  assert.equal(merge({ ...current, topic: "sensor systems" }, refine("sensors system"), currentYear).noChange, true);
  assert.equal(merge(current, refine("neurotechnologist"), currentYear).noChange, false);
  assert.equal(parse("neurotechnologies", currentYear).topic, "neurotechnologies");
});

test("all new focus phrases extract literal lists and recognized people without changing topic conjunctions", () => {
  for (const phrase of ["regarding", "concerning", "about", "related to", "on"]) {
    const parsed = parse("law and economics " + phrase + " education and healthcare", currentYear);
    assert.equal(parsed.topic, "law and economics");
    assert.deepEqual(parsed.includeGroups, [["education", "healthcare"]]);
    const people = parse("neurotechnology " + phrase + " children", currentYear);
    assert.equal(people.topic, "neurotechnology");
    assert.deepEqual(people.includeGroups, [TMM_SEARCH_PRESETS.children.terms]);
  }
  assert.equal(parse("research on neurotechnology", currentYear).topic, "neurotechnology");
  assert.equal(parse('AI regarding "law and economics"', currentYear).includeGroups[0][0], "law and economics");
});

test("ages never become dates and all requested child/infant age forms use the unchanged preset", () => {
  for (const age of ["0 to 9", "aged 0–9", "0–9 years old", "under 5", "from 0 to 9", "aged 0-9", "aged 0—9"]) {
    for (const child of ["children", "kids", "infants"]) {
      const parsed = parse(`neurotechnology regarding ${child} ${age}`, currentYear);
      assert.equal(parsed.topic, "neurotechnology", `${child} ${age}`);
      assert.deepEqual(parsed.includeGroups, [TMM_SEARCH_PRESETS.children.terms]);
      assert.equal(parsed.from, 2010); assert.equal(parsed.to, null); assert.equal(parsed.explicitRange, false);
      assert.deepEqual(parsed.errors, []);
    }
    assert.equal(parse(`neurotechnology ${age}`, currentYear).explicitRange, false);
  }
  assert.equal(parse("AI aged 2015 to 2020", currentYear).explicitRange, false);
  const dated = parse("neurotechnology concerning infants under 5 since 2020", currentYear);
  assert.deepEqual(dated.includeGroups, [TMM_SEARCH_PRESETS.children.terms]);
  assert.equal(dated.from, 2020); assert.equal(dated.explicitRange, true);
  assert.deepEqual(parse('AI on "children aged 0–9"', currentYear).includeGroups, [["children aged 0–9"]]);
  assert.equal(parse("neurotechnology 2015 to 2020", currentYear).from, 2015);
});

test("region fillers are consumed only with a recognized place", () => {
  for (const prefix of ["all the countries of", "countries in", "born in", "living in", "from", "born in all the countries of", "living in countries in"]) {
    const parsed = parse(`neurotechnology ${prefix} the Middle East`, currentYear);
    assert.equal(parsed.topic, "neurotechnology", prefix);
    assert.deepEqual(parsed.includeGroups, [TMM_SEARCH_PRESETS.middleEast.terms]);
    assert.deepEqual(parsed.errors, []);
  }
  assert.equal(parse("countries of origin", currentYear).topic, "countries of origin");
  assert.deepEqual(parse("neurotechnology born in the UAE", currentYear).includeGroups, [["united arab emirates", "uae", "emirati"]]);
});

test("the exact neurotechnology refinement adds only Children 0–9 and Middle East, with no date change", () => {
  const text = "I am looking for neurotechnologies regarding children from 0 to 9, born in all the countries of the Middle East";
  const current = { ...base(), topic: "neurotechnology", includeGroups: [] };
  const parsed = parse(text, currentYear, { refinement: true, currentTopic: current.topic });
  assert.equal(parsed.topic, "");
  assert.deepEqual(parsed.includeGroups, [TMM_SEARCH_PRESETS.children.terms, TMM_SEARCH_PRESETS.middleEast.terms]);
  assert.deepEqual(parsed.groups.map(item => item.label), ["Children 0–9", "Middle East"]);
  assert.equal(parsed.explicitRange, false); assert.deepEqual(parsed.errors, []); assert.deepEqual(parsed.ignored, []);
  const merged = merge(current, parsed, currentYear);
  assert.equal(merged.topic, current.topic); assert.deepEqual(merged.synonyms, current.synonyms);
  assert.deepEqual(merged.includeGroups, parsed.includeGroups);
  assert.equal(merged.from, current.from); assert.equal(merged.to, current.to);
  assert.equal(merged.subfieldId, current.subfieldId); assert.equal(merged.subtopicId, current.subtopicId);
});

test("plain sentences drop framing words, keep phrases and recognise people", () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const context = vm.createContext({});
  for (const name of ["search-presets.js", "query-parser.js"]) vm.runInContext(fs.readFileSync(__dirname + "/" + name, "utf8"), context);
  const P = context.TMM_QUERY_PARSER, S = context.TMM_SEARCH_PRESETS;
  const label = group => Object.values(S).find(preset => JSON.stringify([...preset.terms].sort()) === JSON.stringify([...group].sort()))?.label || group.join("/");
  const read = (sentence, options) => { const parsed = P.parse(sentence, 2026, options); return [parsed.topic, parsed.includeGroups.map(label).join(" + "), parsed.from]; };
  const cases = [
    ["Epigenetics and the impact of this field on pregnant women", ["Epigenetics", "Pregnancy", 2010]],
    ["epigenetics and what is its impact on pregnant women", ["epigenetics", "Pregnancy", 2010]],
    ["how does screen time affect sleep in teenagers", ["screen time", "sleep + Adolescents", 2010]],
    ["AI and the role of this technology in education", ["AI", "education", 2010]],
    ["I'm looking for research on inheritance law in the Gulf", ["inheritance law", "GCC", 2010]],
    ["law and economics since 2018", ["law and economics", "", 2018]],
    ["research and development in the UAE", ["research and development", "united arab emirates/uae/emirati", 2010]],
    ["impact investing in the GCC", ["impact investing", "GCC", 2010]],
    ["effects of air pollution on children's lungs", ["air pollution", "lungs + Children 0–9", 2010]],
    ["neurotechnology for older adults in the GCC", ["neurotechnology", "Older adults + GCC", 2010]]
  ];
  for (const [sentence, expected] of cases) assert.deepEqual(read(sentence), expected, sentence);
  assert.deepEqual(read("I am looking for neurotechnologies regarding children from 0 to 9, born in all the countries of the Middle East", { refinement: true, currentTopic: "neurotechnology" }), ["", "Children 0–9 + Middle East", 2010]);
});

test("a people word directly before another noun stays part of the topic", () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const context = vm.createContext({});
  for (const name of ["search-presets.js", "query-parser.js"]) vm.runInContext(fs.readFileSync(__dirname + "/" + name, "utf8"), context);
  const P = context.TMM_QUERY_PARSER;
  const read = sentence => { const parsed = P.parse(sentence, 2026); return [parsed.topic, parsed.groups.map(group => group.label).join(" + ")]; };
  assert.deepEqual(read("child custody after divorce in the UAE"), ["child custody after divorce", "UAE"]);
  assert.deepEqual(read("child labour in the GCC"), ["child labour", "GCC"]);
  assert.deepEqual(read("women entrepreneurs in Saudi Arabia"), ["women entrepreneurs", "Saudi Arabia"]);
  assert.deepEqual(read("custody of children in the UAE"), ["custody", "Children 0–9 + UAE"]);
});

test("'or' in the topic becomes synonyms and 'or' between places makes one group", () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const context = vm.createContext({});
  for (const name of ["search-presets.js", "query-parser.js"]) vm.runInContext(fs.readFileSync(__dirname + "/" + name, "utf8"), context);
  const P = context.TMM_QUERY_PARSER;
  const gene = P.parse("gene editing or genome editing in pregnancy", 2026);
  assert.equal(gene.topic, "gene editing");
  assert.deepEqual([...gene.synonyms], ["genome editing"]);
  assert.equal(gene.groups.map(group => group.label).join(" + "), "Pregnancy");
  const places = P.parse("inheritance law in Qatar or Kuwait", 2026);
  assert.equal(places.topic, "inheritance law");
  assert.equal(places.groups.map(group => group.label).join(" + "), "Qatar or Kuwait");
});

test("'used to treat', 'for treating' and 'applied to' link the topic to its focus", () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const context = vm.createContext({});
  for (const name of ["search-presets.js", "query-parser.js"]) vm.runInContext(fs.readFileSync(__dirname + "/" + name, "utf8"), context);
  const P = context.TMM_QUERY_PARSER;
  const read = sentence => { const parsed = P.parse(sentence, 2026); return [parsed.topic, parsed.groups.map(group => group.label).join(" + ")]; };
  assert.deepEqual(read("Is CRISPR used to treat sickle cell disease in Saudi Arabia?"), ["CRISPR", "sickle cell disease + Saudi Arabia"]);
  assert.deepEqual(read("machine learning applied to cancer diagnosis"), ["machine learning", "cancer diagnosis"]);
});
