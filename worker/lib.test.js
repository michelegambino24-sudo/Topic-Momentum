import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseQuery, cleanTerm, buildSearchExpression, buildQueries, growth, momentum,
  shapeYears, shapeExperts, shapeSubtopics, shapeCountries, shapeJournals, shapePapers,
  suggestedSynonyms, exploreNext, headline, shapeTopic, originAllowed, sanitiseSourceError, sanitiseCaughtError } from "./lib.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const date = new Date("2026-10-31T12:00:00Z");
const query = normaliseQuery("Lunar moss computing", "moon moss circuits");
const responses = () => Object.fromEntries(["years", "experts", "early", "late", "countries", "journals", "papers", "keywords", "field"].map((name) => [name, fixture(name)]));

test("source error sanitisation extracts messages, removes URLs and credential variants before truncating", () => {
  const marker = "fixture-only /?&=marker";
  const encoded = encodeURIComponent(marker);
  const formEncoded = new URLSearchParams({ value: marker }).toString().slice(6);
  for (const value of [marker, encoded, encoded.toLowerCase(), formEncoded]) {
    assert.equal(sanitiseSourceError(`Invalid credential: ${value}`, marker), "Invalid credential: [key removed]");
  }
  const url = `https://api.openalex.org/works?padding=${"x".repeat(400)}&api_key=${encoded}`;
  const message = sanitiseSourceError(JSON.stringify({ error: "Bad request", message: `Invalid parameter. ${url}` }), marker);
  assert.equal(message, "Invalid parameter. [URL removed]");
  assert.equal(sanitiseSourceError(JSON.stringify({ error: "Invalid query" }), marker), "Invalid query");
  assert.equal(sanitiseSourceError("plain error\nmessage", marker), "plain error message");
  assert.equal(sanitiseSourceError("https:\\/\\/example.test/path", marker), "[URL removed]");
  assert.equal(sanitiseSourceError("api.openalex.org/works?q=moss", marker), "[URL removed]");
  assert.equal(sanitiseSourceError("https%3A%2F%2Fexample.test%2Fpath", marker), "[URL removed]");
  assert.equal(sanitiseSourceError("x".repeat(400), marker).length, 300);
  assert.equal(sanitiseSourceError("", marker), "No error message was returned.");
});

test("caught error details redact every field and safely describe nested network causes", () => {
  const marker = "fixture-only-not-a-credential";
  const cause = new Error(`TLS failure ${marker} https://example.test/private`);
  cause.name = `TLS-${marker}`;
  cause.code = "CERT_HAS_EXPIRED";
  cause.errno = -1;
  cause.syscall = "connect";
  const error = new TypeError(`fetch failed https://api.openalex.org/works?api_key=${marker}`, { cause });
  error.stack = `Stack contains ${marker} but must never be included`;
  const details = sanitiseCaughtError(error, marker);
  assert.equal(details.name, "TypeError");
  assert.equal(details.message, "fetch failed [URL removed]");
  assert.deepEqual(details.cause, {
    name: "TLS-[key removed]", message: "TLS failure [key removed] [URL removed]",
    code: "CERT_HAS_EXPIRED", errno: "-1", syscall: "connect", cause: null
  });
  assert(!JSON.stringify(details).includes(marker));
  assert(!JSON.stringify(details).includes("https://"));
  assert(!JSON.stringify(details).includes("stack"));
  assert.equal(sanitiseCaughtError(new Error("No cause"), marker).cause, null);
  assert.equal(sanitiseCaughtError(new Error("Failed", { cause: `Reason ${marker}` }), marker).cause, "Reason [key removed]");
  cause.cause = cause;
  assert.equal(sanitiseCaughtError(cause, marker).cause, "[circular cause]");
  const deep = new Error("Level 1", { cause: new Error("Level 2", { cause: new Error("Level 3", { cause: new Error("Level 4", { cause: new Error("Level 5") }) }) }) });
  assert.equal(sanitiseCaughtError(deep, marker).cause.cause.cause.cause, "[cause depth limit]");
});

test("normalisation trims, folds case, removes duplicates and sorts synonyms", () => {
  assert.deepEqual(normaliseQuery("  MOON   MOSS  ", "beta, Alpha, moon moss, BETA,,"), { name: "moon moss", synonyms: ["alpha", "beta"], id: "moon moss|alpha|beta" });
  assert.equal(cleanTerm(' [moss]|(logic),"test":\\ '), "mosslogictest");
  assert.equal(normaliseQuery("[]|'\"").name, "");
  assert.equal(normaliseQuery("MOSS", "b,a").id, normaliseQuery(" moss ", "a,b,b").id);
});

test("search expression quotes spaces and hyphens and excludes filter delimiters", () => {
  assert.equal(buildSearchExpression(normaliseQuery("moss", "moon moss,low-gravity")), '(moss OR "low-gravity" OR "moon moss")');
  const expression = buildSearchExpression(normaliseQuery('moss,|["x"]', '(foo):bar'));
  assert.equal(expression, '(mossx OR foobar)');
});

test("nine query descriptors use the specified filters, date windows and limits", () => {
  const all = buildQueries(query, 2026);
  assert.equal(all.length, 9);
  const byId = Object.fromEntries(all.map((item) => [item.id, item.params]));
  assert.equal(byId.years.group_by, "publication_year");
  assert(byId.years.filter.endsWith("publication_year:2010-2026"));
  assert(byId.early.filter.endsWith("from_publication_date:2020-01-01,to_publication_date:2022-12-31"));
  assert(byId.late.filter.endsWith("from_publication_date:2023-01-01,to_publication_date:2025-12-31"));
  assert.equal(byId.experts.group_by, "authorships.author.id");
  assert.equal(byId.countries.group_by, "authorships.countries");
  assert.equal(byId.journals.group_by, "primary_location.source.id");
  assert.equal(byId.keywords.group_by, "keywords.id");
  assert.equal(byId.field.group_by, "primary_topic.field.id");
  assert.equal(byId.field.per_page, "1");
  assert.equal(byId.papers.sort, "cited_by_count:desc");
  assert.equal(byId.papers.per_page, "6");
  assert.equal(byId.papers.select, "id,display_name,publication_year,cited_by_count,doi,authorships,primary_location");
  for (const item of all) { assert(item.params.filter.startsWith('title_and_abstract.search:("lunar moss computing" OR "moon moss circuits"),')); assert(!("api_key" in item.params)); }
});

test("growth handles zero baseline, zero final count, five-year CAGR and all momentum boundaries", () => {
  assert.equal(growth(0, 50, 5), null);
  assert.equal(growth(10, 0, 5), -1);
  assert.equal(growth(100, 200, 5), 2 ** .2 - 1);
  for (const [value, label] of [[null, "Not enough data"], [-.001, "Cooling"], [0, "Stable"], [.0799, "Stable"], [.08, "Growing"], [.1999, "Growing"], [.2, "Accelerating"]]) assert.equal(momentum(value), label);
});

test("years fill missing years; KPIs exclude current year from growth and last-year count", () => {
  const topic = shapeTopic(query, responses(), date);
  assert.equal(topic.years.length, 17);
  assert.deepEqual(topic.years[0], { year: 2010, count: 0 });
  assert.equal(topic.kpis.total, 1992);
  assert.equal(topic.kpis.lastYear, 249);
  assert.equal(topic.kpis.growth5y, (249 / 100) ** .2 - 1);
  assert.equal(topic.cached, false);
  assert.equal(topic.updated, "2026-10-31");
  assert.equal(topic.field, "Computer Science");
  assert.deepEqual(Object.keys(topic), ["id", "name", "synonyms", "field", "updated", "years", "kpis", "headline", "experts", "subtopics", "countries", "journals", "papers", "suggestedSynonyms", "exploreNext", "cached"]);
  assert(topic.headline.includes("249 papers were published in 2025"));
});

test("response shapers preserve names and counts; zero-early sub-topics have null growth", () => {
  assert.deepEqual(shapeExperts(fixture("experts"))[0], { name: "Researcher A", openalexUrl: "https://openalex.org/A900000001", count: 74 });
  assert.deepEqual(shapeJournals(fixture("journals"))[0], { name: "Journal of Fictional Moss Logic", count: 160 });
  const items = shapeSubtopics(fixture("early"), fixture("late"));
  assert.equal(items.find((item) => item.name === "Low-gravity logic gates").growth, null);
  assert.equal(items.find((item) => item.name === "Moss memory arrays").growth, 2);
  const renamed = fixture("early"); renamed.group_by[0].key_display_name = "Old name";
  assert.equal(shapeSubtopics(renamed, fixture("late")).find((item) => item.name === "Moss memory arrays").growth, 2);
});

test("country codes become names and only the six GCC countries are tagged", () => {
  const countries = shapeCountries(fixture("countries"));
  assert.deepEqual(countries[0], { name: "United States", code: "US", count: 180, gcc: false });
  assert.deepEqual(countries.filter((item) => item.gcc).map((item) => item.code).sort(), ["AE", "BH", "KW", "OM", "QA", "SA"]);
});

test("papers tolerate missing journals, missing authors, and absent DOI; unsafe links are discarded", () => {
  const papers = shapePapers(fixture("papers"));
  assert.equal(papers[0].authors, "Researcher A");
  assert.equal(papers[0].journal, "Journal of Fictional Moss Logic");
  assert.equal(papers[1].journal, "Unknown journal");
  assert.equal(papers[1].authors, "Unknown authors");
  assert.equal(papers[0].url, "https://openalex.org/W900000001");
  const input = fixture("papers");
  input.results[0].doi = "https://doi.org/10.0000/fictional";
  assert.equal(shapePapers(input)[0].url, input.results[0].doi);
  input.results[0].doi = "javascript:bad"; input.results[0].id = "https://untrusted.example/";
  assert.equal(shapePapers(input)[0].url, "");
  input.results[1].primary_location = { source: null };
  assert.equal(shapePapers(input)[1].journal, "Unknown journal");
});

test("keyword suggestions exclude search terms and duplicates, and are capped at six", () => {
  assert.deepEqual(suggestedSynonyms(fixture("keywords"), query), ["Orbital processors", "Spore networks"]);
  const input = fixture("keywords");
  input.group_by.push(...Array.from({ length: 10 }, (_, i) => ({ key: `keyword-${i}`, key_display_name: `Keyword ${i}`, count: 20 })));
  input.group_by.push({ key: "duplicate", key_display_name: "ORBITAL PROCESSORS", count: 15 });
  assert.equal(suggestedSynonyms(input, query).length, 6);
});

test("explore-next ranks eligible growth first, then largest, excluding self and duplicates", () => {
  assert.deepEqual(exploreNext([
    { name: "Self", late: 1000, growth: 50 }, { name: "Tiny", late: 19, growth: 100 },
    { name: "Fast", late: 20, growth: 3 }, { name: "Large", late: 200, growth: null },
    { name: "Slow", late: 40, growth: 1 }, { name: "Fast", late: 20, growth: 3 }
  ], "self"), ["Fast", "Slow", "Large", "Tiny"]);
  assert.equal(exploreNext(Array.from({ length: 10 }, (_, i) => ({ name: `Topic ${i}`, late: 25, growth: i })), "self").length, 6);
});

test("empty responses produce complete zero-valued topic; malformed responses throw", () => {
  const empty = Object.fromEntries(Object.keys(responses()).map((name) => [name, fixture(name === "papers" ? "empty-papers" : "empty-groups")]));
  const topic = shapeTopic(query, empty, date);
  assert.deepEqual(topic.kpis, { total: 0, lastYear: 0, growth5y: null, momentum: "Not enough data" });
  assert.equal(topic.field, "Unclassified");
  for (const field of ["experts", "subtopics", "countries", "journals", "papers", "suggestedSynonyms", "exploreNext"]) assert.deepEqual(topic[field], []);
  assert(topic.headline.includes("not enough data"));
  assert.throws(() => shapeYears({}, 2026));
  assert.throws(() => shapePapers({ results: [{}] }));
  assert.throws(() => shapeYears({ group_by: [{ key: "2020", key_display_name: "2020", count: -1 }] }, 2026));
  assert(headline("moss", { growth5y: -.1, momentum: "Cooling", lastYear: 20 }, 2025).includes("-10.0%"));
});

test("top lists obey their caps and unknown groups are ignored", () => {
  const input = { group_by: Array.from({ length: 20 }, (_, i) => ({ key: `https://openalex.org/A${i}`, key_display_name: `Researcher ${i}`, count: i })) };
  assert.equal(shapeExperts(input).length, 10);
  assert.equal(shapeExperts(input)[0].count, 19);
  assert.equal(shapeJournals(input).length, 10);
  const data = responses(); data.late = input;
  assert.equal(shapeTopic(query, data, date).subtopics.length, 9);
  assert.deepEqual(shapeExperts({ group_by: [{ key: "unknown", key_display_name: "Unknown", count: 5 }] }), []);
});

test("origin rules allow only exact configured origin, local dev origins and dev-only null", () => {
  const prod = { ALLOWED_ORIGIN: "https://sample.example" };
  assert(originAllowed(null, prod));
  assert(originAllowed("https://sample.example", prod));
  for (const origin of ["null", "http://localhost:9000", "https://sample.example.evil.test", "https://sample.example/path", "https://elsewhere.example"]) assert.equal(originAllowed(origin, prod), false);
  const dev = { ...prod, ENVIRONMENT: "dev" };
  assert(originAllowed("null", dev));
  assert(originAllowed("http://localhost:9000", dev));
  assert(originAllowed("http://localhost", dev));
  for (const origin of ["http://localhost.evil.test:9000", "https://localhost:9000", "http://localhost:9000/path", "http://127.0.0.1:9000"]) assert.equal(originAllowed(origin, dev), false);
});
