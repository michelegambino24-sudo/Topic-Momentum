import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseQuery, normaliseSubtopicId, cleanTerm, buildSearchExpression, buildQueries, growth, momentum,
  shapeYears, shapeExperts, shapeSubtopics, shapeCountries, shapeJournals, shapePapers,
  suggestedSynonyms, exploreNext, headline, shapeTopic, originAllowed, sanitiseSourceError, sanitiseCaughtError,
  cacheIsFresh, dailyCap, updateLibrary, CACHE_MAX_AGE_MS } from "./lib.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const date = new Date("2026-10-31T12:00:00Z");
const query = normaliseQuery("Lunar moss computing", "moon moss circuits");
const responses = () => Object.fromEntries(["years", "experts", "early", "late", "countries", "journals", "papers", "keywords", "field", "subfields", "uae", "gcc"].map((name) => [name, fixture(name)]));

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
  assert.deepEqual(normaliseQuery("  MOON   MOSS  ", "beta, Alpha, moon moss, BETA,,"), { name: "moon moss", synonyms: ["alpha", "beta"], from: 2010, to: null, id: "moon moss|alpha|beta" });
  assert.equal(cleanTerm(' [moss]|(logic),"test":\\ '), "mosslogictest");
  assert.equal(normaliseQuery("[]|'\"").name, "");
  assert.equal(normaliseQuery("MOSS", "b,a").id, normaliseQuery(" moss ", "a,b,b").id);
});

test("search expression quotes spaces and hyphens and excludes filter delimiters", () => {
  assert.equal(buildSearchExpression(normaliseQuery("moss", "moon moss,low-gravity")), '(moss OR "low-gravity" OR "moon moss")');
  const expression = buildSearchExpression(normaliseQuery('moss,|["x"]', '(foo):bar'));
  assert.equal(expression, '(mossx OR foobar)');
});

test("twelve query descriptors use the specified filters, date windows and limits", () => {
  const all = buildQueries(query, 2026);
  assert.equal(all.length, 12);
  const byId = Object.fromEntries(all.map((item) => [item.id, item.params]));
  assert.equal(byId.years.group_by, "publication_year");
  assert(byId.years.filter.endsWith("publication_year:2010-2026"));
  assert(byId.early.filter.endsWith("from_publication_date:2010-01-01,to_publication_date:2017-12-31"));
  assert(byId.late.filter.endsWith("from_publication_date:2018-01-01,to_publication_date:2025-12-31"));
  assert.equal(byId.experts.group_by, "authorships.author.id");
  assert(byId.experts.filter.endsWith("from_publication_date:2020-01-01,primary_location.source.type:!repository,type:article|review,primary_location.source.is_core:true"));
  assert.equal(byId.countries.group_by, "authorships.countries");
  assert.equal(byId.journals.group_by, "primary_location.source.id");
  assert(byId.journals.filter.endsWith("from_publication_date:2010-01-01,primary_location.source.type:journal,type:article|review,primary_location.source.is_core:true"));
  for (const { id, params } of all) {
    if (!["experts", "journals"].includes(id)) assert(!params.filter.includes("primary_location.source.type:"));
  }
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
  assert.deepEqual(Object.keys(topic), ["id", "name", "synonyms", "from", "to", "subtopicWindow", "searchTerms", "subfields", "field", "updated", "years", "kpis", "headline", "sourceQuality", "experts", "subtopics", "countries", "regionalCounts", "journals", "papers", "suggestedSynonyms", "exploreNext", "cached", "refinements"]);
  assert(topic.headline.includes("to 249 in 2025."));
});

test("response shapers preserve names and counts; zero-early sub-topics have null growth", () => {
  assert.deepEqual(shapeExperts(fixture("experts")), [
    { name: "Researcher A", openalexUrl: "https://openalex.org/A900000001", count: 104 },
    { name: "Researcher B", openalexUrl: "https://openalex.org/A900000002", count: 90 }
  ]);
  assert.deepEqual(shapeJournals(fixture("journals"))[0], { name: "Journal of Fictional Moss Logic", count: 160 });
  const items = shapeSubtopics(fixture("early"), fixture("late"));
  assert.equal(items.find((item) => item.name === "Low-gravity logic gates").growth, null);
  assert.equal(items.find((item) => item.name === "Moss memory arrays").growth, 2);
  const renamed = fixture("early"); renamed.group_by[0].key_display_name = "Old name";
  assert.equal(shapeSubtopics(renamed, fixture("late")).find((item) => item.name === "Moss memory arrays").growth, 2);
});

test("country URLs become codes, names come from OpenAlex, and only the six GCC countries are tagged", () => {
  const countries = shapeCountries(fixture("countries"));
  assert.deepEqual(countries[0], { name: "United States of America", code: "US", count: 180, gcc: false });
  assert.deepEqual(countries.filter((item) => item.gcc).map((item) => item.code).sort(), ["AE", "BH", "KW", "OM", "QA", "SA"]);
});

test("papers tolerate missing journals, missing authors, and absent DOI; unsafe links are discarded", () => {
  const papers = shapePapers(fixture("papers"));
  assert.equal(papers[0].authors, "Researcher A, Researcher B, Researcher C, et al.");
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

test("expert names are merged before ranking and limiting, with the largest record's link retained", () => {
  const input = { group_by: Array.from({ length: 12 }, (_, i) => ({ key: `https://openalex.org/A${900000010 + i}`, key_display_name: `Researcher ${i}`, count: 100 - i })) };
  input.group_by.push({ key: "https://openalex.org/A900000099", key_display_name: "Researcher 11", count: 50 });
  const experts = shapeExperts(input);
  assert.equal(experts.length, 10);
  assert.deepEqual(experts[0], { name: "Researcher 11", openalexUrl: "https://openalex.org/A900000021", count: 139 });
  assert.equal(experts.filter((item) => item.name === "Researcher 11").length, 1);
});

test("countries support bare and URL keys, skip invalid keys, retain display names, and cap at fifteen", () => {
  const mixed = fixture("countries");
  mixed.group_by[0].key = "us";
  mixed.group_by[1].key = "https://openalex.org/countries/ae";
  mixed.group_by[1].key_display_name = "Source-provided country name";
  for (const key of ["https://untrusted.example/countries/US", "https://openalex.org/not-countries/US", "not-a-country", "unknown", null]) {
    mixed.group_by.push({ key, key_display_name: "Invalid group", count: 1000 });
  }
  const countries = shapeCountries(mixed);
  assert.equal(countries.length, 7);
  assert.equal(countries[0].code, "US");
  assert.equal(countries[1].code, "AE");
  assert.equal(countries[1].gcc, true);
  assert.equal(countries[1].name, "Source-provided country name");
  const input = { group_by: ["US", "AE", "SA", "QA", "KW", "BH", "OM", "JP", "GB", "DE", "FR", "IT", "CA", "CN", "BR", "AU"].map((code, i) => ({ key: `https://openalex.org/countries/${code}`, key_display_name: `Country ${code}`, count: 100 - i })) };
  assert.equal(shapeCountries(input).length, 15);
});

test("paper authors keep source order, show up to three names, and add et al. only for longer lists", () => {
  const data = fixture("papers");
  const allAuthors = data.results[0].authorships;
  for (const [count, expected] of [
    [0, "Unknown authors"], [1, "Researcher A"], [2, "Researcher A, Researcher B"],
    [3, "Researcher A, Researcher B, Researcher C"], [4, "Researcher A, Researcher B, Researcher C, et al."]
  ]) {
    data.results[0].authorships = allAuthors.slice(0, count);
    assert.equal(shapePapers(data)[0].authors, expected);
  }
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
  ], "self").map((item) => item.name), ["Fast", "Slow", "Large", "Tiny"]);
  assert.equal(exploreNext(Array.from({ length: 10 }, (_, i) => ({ name: `Topic ${i}`, late: 25, growth: i })), "self").length, 6);
});

test("empty responses produce complete zero-valued topic; malformed responses throw", () => {
  const empty = Object.fromEntries(Object.keys(responses()).map((name) => [name, fixture(name === "papers" ? "empty-papers" : "empty-groups")]));
  empty.uae = empty.gcc = { meta: { count: 0 }, results: [] };
  const topic = shapeTopic(query, empty, date);
  assert.deepEqual(topic.kpis, { total: 0, lastYear: 0, growth5y: null, growth: null, growthLabel: "Growth 2010–2025", momentum: "Not enough data" });
  assert.equal(topic.field, "Unclassified");
  for (const field of ["experts", "subtopics", "countries", "journals", "papers", "suggestedSynonyms", "exploreNext"]) assert.deepEqual(topic[field], []);
  assert(topic.headline.includes("is a new topic:"));
  assert.throws(() => shapeYears({}, 2026));
  assert.throws(() => shapePapers({ results: [{}] }));
  assert.throws(() => shapeYears({ group_by: [{ key: "2020", key_display_name: "2020", count: -1 }] }, 2026));
  assert(headline("moss", { growth5y: -.1, momentum: "Cooling", lastYear: 20 }, 2025).includes("−10%"));
});

test("top lists obey their caps and unknown groups are ignored", () => {
  const input = { group_by: Array.from({ length: 20 }, (_, i) => ({ key: `https://openalex.org/A${i}`, key_display_name: `Researcher ${i}`, count: i })) };
  assert.equal(shapeExperts(input).length, 10);
  assert.equal(shapeExperts(input)[0].count, 19);
  assert.equal(shapeJournals(input).length, 10);
  const data = responses(); data.late = { group_by: input.group_by.map((item, i) => ({ ...item, key: `https://openalex.org/T${i}` })) };
  assert.equal(shapeTopic(query, data, date).subtopics.length, 9);
  assert.deepEqual(shapeExperts({ group_by: [{ key: "unknown", key_display_name: "Unknown", count: 5 }] }), []);
});

test("origin rules allow exact configured origins and HTTP localhost in production, with null only in dev", () => {
  const prod = { ALLOWED_ORIGIN: "https://sample.example" };
  assert(originAllowed(null, prod));
  assert(originAllowed("https://sample.example", prod));
  for (const origin of ["http://localhost", "http://localhost:8000", "http://localhost:9000", "http://localhost:65535"]) assert(originAllowed(origin, prod));
  for (const origin of ["null", "https://sample.example.evil.test", "https://sample.example/path", "https://elsewhere.example"]) assert.equal(originAllowed(origin, prod), false);
  const dev = { ...prod, ENVIRONMENT: "dev" };
  assert(originAllowed("null", dev));
  assert(originAllowed("http://localhost:9000", dev));
  assert(originAllowed("http://localhost", dev));
  for (const settings of [prod, dev]) for (const origin of ["http://localhost.evil.test:9000", "https://localhost:9000", "http://localhost:9000/path", "http://127.0.0.1:9000", "http://[::1]:8000", "http://user@localhost:8000", "http://localhost:8000?x=1", "http://localhost:65536"]) assert.equal(originAllowed(origin, settings), false);
});

test("regional totals are independent of the top countries and use the GCC OR filter", () => {
  const descriptors = Object.fromEntries(buildQueries(query, 2026).map(({id, params}) => [id, params]));
  assert(descriptors.gcc.filter.endsWith("authorships.countries:countries/ae|countries/sa|countries/qa|countries/kw|countries/bh|countries/om"));
  assert(descriptors.uae.filter.endsWith("authorships.countries:countries/ae"));
  const data = responses();
  data.countries = { group_by: [] };
  assert.deepEqual(shapeTopic(query, data, date).regionalCounts, { uae: 7, gcc: 11 });
  data.gcc = { meta: { count: -1 } };
  assert.throws(() => shapeTopic(query, data, date));
});


test("sub-topic IDs are canonical, validated, and separate query identities", () => {
  assert.equal(normaliseSubtopicId("T123"), "T123");
  assert.equal(normaliseSubtopicId("https://openalex.org/T123"), "T123");
  for (const id of ["t123", "T", "T123,foo:bar", "https://evil.example/T123", "https://openalex.org/T123?x=1", "T123|T456", "T123/", " T123"]) {
    assert.throws(() => normaliseQuery("moss", "", id));
  }
  const child = normaliseQuery("moss", "circuits", "https://openalex.org/T123");
  assert.equal(child.id, normaliseQuery("moss", "circuits", "T123").id);
  assert.notEqual(child.id, normaliseQuery("moss", "circuits").id);
  assert.notEqual(child.id, normaliseQuery("moss", "circuits", "T456").id);
  for (const { params } of buildQueries(child, 2026)) {
    assert(params.filter.startsWith("title_and_abstract.search:(moss OR circuits),primary_topic.id:T123,"));
  }
  const shaped = shapeSubtopics(fixture("early"), fixture("late"));
  assert(shaped.every((item) => /^T[0-9]+$/.test(item.id)));
  const suggested = exploreNext(shaped, "moss");
  assert(suggested.every((item) => shaped.some((topic) => topic.id === item.id && topic.name === item.name)));
  const topic = shapeTopic({ ...child, subtopicName: "Named sub-topic", parent: "moss|circuits", parentName: "moss" }, responses(), date);
  assert.equal(topic.name, "Named sub-topic · since 2010");
  assert.equal(topic.parent, "moss|circuits");
  assert.deepEqual(topic.searchTerms, { name: "moss", synonyms: ["circuits"] });
});

test("headline GCC share uses only years since 2020, including the current year", () => {
  const data = responses();
  data.years = { group_by: [
    { key: "2019", key_display_name: "2019", count: 100000 },
    { key: "2020", key_display_name: "2020", count: 50 },
    { key: "2025", key_display_name: "2025", count: 25 },
    { key: "2026", key_display_name: "2026", count: 25 }
  ] };
  data.uae = { meta: { count: 2 } };
  data.gcc = { meta: { count: 5 } };
  assert(!shapeTopic({ ...query, from: 2020 }, data, date).headline.includes("Only")); // Exactly 5%.
  data.gcc.meta.count = 4;
  assert(shapeTopic({ ...query, from: 2020 }, data, date).headline.endsWith("Only 4 papers published since 2020 come from the GCC (2 from the UAE)."));
  data.gcc.meta.count = 6;
  assert(!shapeTopic({ ...query, from: 2020 }, data, date).headline.includes("Only"));
  data.years = { group_by: [] };
  data.gcc.meta.count = 0;
  assert(!shapeTopic({ ...query, from: 2020 }, data, date).headline.includes("Only"));
  const kpis = { growth5y: .1, lastYear: 100, momentum: "Growing" };
  assert(headline("moss", kpis, 2025, { gcc: 25, uae: 11 }, 1000).endsWith("Only 25 papers published since 2020 come from the GCC (11 from the UAE)."));
});


test("only experts, journals and papers queries restrict work types to articles and reviews", () => {
  for (const q of [query, normaliseQuery("moss", "", "T123")]) {
    for (const { id, params } of buildQueries(q, 2026)) {
      assert.equal(params.filter.includes(",type:article|review"), ["experts", "journals", "papers"].includes(id));
    }
  }
});

test("headlines use singular paper and verb for one paper", () => {
  for (const rate of [null, .1]) {
    const text = headline("moss", { growth5y: rate, lastYear: 1, momentum: "Growing" }, 2025, { gcc: 1, uae: 1 }, 100);
    assert(text.includes("In 2025, 1 paper was published."));
    assert(text.includes("Only 1 paper published since 2020 comes from the GCC (1 from the UAE)."));
    assert(!text.includes("1 papers"));
  }
});


test("cache freshness rejects missing and future timestamps and uses the precise seven-day boundary", () => {
  const savedAt = date.getTime();
  assert(cacheIsFresh({ savedAt }, savedAt));
  assert(cacheIsFresh({ savedAt }, savedAt + CACHE_MAX_AGE_MS - 1));
  assert(!cacheIsFresh({ savedAt }, savedAt + CACHE_MAX_AGE_MS));
  assert(!cacheIsFresh({ savedAt }, savedAt - 1));
  assert(!cacheIsFresh({}, savedAt));
  assert(!cacheIsFresh({ savedAt: "not a timestamp" }, savedAt));
  assert.equal(dailyCap(), 30);
  assert.equal(dailyCap("0"), 0);
  for (const value of [null, "", "-1", "1.5", "1e3", "wrong", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => dailyCap(value));
});

test("library handles child-first searches, preserves links on refresh, and rejects cycles without mutating input", () => {
  const parent = shapeTopic(query, responses(), date);
  const child = shapeTopic({ ...normaliseQuery(query.name, query.synonyms.join(","), "T123"), subtopicName: "Orbital logic", parent: parent.id }, responses(), date);
  const childOnly = updateLibrary([], child);
  assert.equal(childOnly[0].parent, parent.id);
  const linked = updateLibrary(childOnly, parent);
  assert.deepEqual(linked.find((entry) => entry.id === parent.id).children, [child.id]);
  assert.equal(childOnly.length, 1);
  assert.deepEqual(updateLibrary(linked, child), linked);
  const updated = updateLibrary(linked, { ...parent, updated: "2026-11-07" });
  assert.deepEqual(updated.find((entry) => entry.id === parent.id).children, [child.id]);
  assert.throws(() => updateLibrary(linked, { ...parent, parent: child.id }));
  assert.throws(() => updateLibrary(linked, { ...parent, parent: parent.id }));
});

test("library spark stores all complete years in the selected range with explicit bounds", () => {
  const topic = shapeTopic(query, responses(), date);
  topic.years = [
    { year: 2015, count: 500 }, { year: 2016, count: 1 },
    { year: 2020, count: 7 }, { year: 2025, count: 10 }, { year: 2026, count: 999 }
  ];
  const entry = updateLibrary([], topic)[0];
  assert.deepEqual(entry.spark, [500, 1, 0, 0, 0, 7, 0, 0, 0, 0, 10]);
  assert.equal(entry.spark.length, 11);
  assert.equal(entry.sparkStartYear, 2015);
  assert.equal(entry.from, 2010);
  assert.equal(entry.to, null);
  const nextYear = updateLibrary([entry], { ...topic, updated: "2027-01-01" })[0];
  assert.deepEqual(nextYear.spark, [500, 1, 0, 0, 0, 7, 0, 0, 0, 0, 10, 999]);
});

test("headlines read naturally, preserve proper names and use range-specific numbers", async () => {
  const {headline, headlineTopicName, reportSummary, presentReport}=await import('./lib.js');
  const kpis={growth:.089,growth5y:.1,growthLabel:"Growth 2020–2025",momentum:"Growing",lastYear:23382,total:50000};
  assert.equal(headline("Epigenetics · since 2020",kpis,2025,{gcc:2043,uae:447},50000,{from:2020,to:null}),"Since 2020, research on epigenetics has been growing (+8.9% a year). In 2025, 23,382 papers were published. Only 2,043 papers published since 2020 come from the GCC (447 from the UAE).");
  assert.equal(headlineTopicName("CRISPR and Alzheimer's Disease"),"CRISPR and Alzheimer's disease");
  assert.match(headline("Epigenetics",kpis,2020,null,1,{from:2015,to:2020}),/^From 2015 to 2020, research on epigenetics was growing/);
  const topic=shapeTopic(query,responses(),date);
  const refreshed=presentReport({...topic,headline:"Obsolete presentation."});
  assert.match(refreshed.headline,/^Research on lunar moss computing is a new topic:/);
  assert.deepEqual(refreshed.years,topic.years);
  const summary=reportSummary({...topic,from:2024,to:2025,kpis:{...topic.kpis,growthLabel:"5-year growth"}});
  assert.equal(summary.sparkStartYear,2024);assert.equal(summary.spark.length,2);
  assert.equal(summary.growthLabel,"5-year growth");
  const childQuery={...query,subtopicId:"T123",subtopicName:"DNA Sequencing",headlineName:"Parent CRISPR"};
  const child=shapeTopic(childQuery,responses(),date);
  assert(presentReport(child).headline.includes("DNA sequencing"));
  assert(!presentReport(child).headline.includes("Parent CRISPR"));
});

test("growth baselines mark tiny starting counts without changing CAGR or momentum", async () => {
  const {growthStartCount,reportSummary,presentReport}=await import('./lib.js');
  for(const [from,to,baseline]of [[2020,null,2020],[2025,null,2020],[2015,2020,2015]]) {
    for(const count of [0,19,20]) {
      const data=responses();data.years={group_by:[{key:String(baseline),key_display_name:String(baseline),count},{key:'2025',key_display_name:'2025',count:200}]};
      const q=normaliseQuery('moss','','','',from,to??'',2026);
      const report=shapeTopic(q,data,date);
      assert.equal(growthStartCount(report),count);
      assert.equal(reportSummary(report).growthStartCount,count);
      assert.equal(report.headline.includes('is a new topic:'),count<20);
      assert.equal(presentReport(report).headline,report.headline);
      assert.equal(report.kpis.momentum,momentum(report.kpis.growth));
    }
  }
});

test("core filters and independent fallbacks preserve every unrelated query",async()=>{
 const {fallbackQueries,journalName,isNewTopic}=await import('./lib.js');
 const core=buildQueries(query,2026),all=buildQueries(query,2026,false);
 for(let i=0;i<core.length;i++)if(['experts','journals'].includes(core[i].id))assert.equal(core[i].params.filter,all[i].params.filter+',primary_location.source.is_core:true');else assert.deepEqual(core[i],all[i]);
 const response=(size,type)=>({group_by:Array.from({length:size},(_,i)=>({key:`https://openalex.org/${type}${i+1}`,key_display_name:'Name '+i,count:10}))});
 for(const [experts,journals,expected]of [[5,5,[]],[4,5,['expertsAll']],[5,4,['journalsAll']],[4,4,['expertsAll','journalsAll']]]){
  const qs=fallbackQueries(query,2026,{experts:response(experts,'A'),journals:response(journals,'S')});assert.deepEqual(qs.map(q=>q.id),expected);assert(qs.every(q=>!q.params.filter.includes('is_core')));
 }
 assert.equal(journalName('JOURNAL OF NEURAL ENGINEERING'),'Journal of Neural Engineering');
 assert.equal(journalName('IEEE TRANSACTIONS ON BIOMEDICAL ENGINEERING'),'IEEE Transactions on Biomedical Engineering');
 assert.equal(journalName('eLife'),'eLife');assert.equal(journalName('Nature'),'Nature');
 for(const [start,end,expected]of [[19,100,true],[20,1000,false],[20,1001,true],[100,10000,true],[200,10000,false]])assert.equal(isNewTopic({growthStartCount:start,growthEndCount:end}),expected);
});

test("headline percentages use the approved precision and actual fallback years",async()=>{
 const {formatPercent}=await import('./lib.js');
 for(const [value,text]of [[.3,'+30%'],[.1,'+10%'],[.089,'+8.9%'],[-.1,'−10%'],[-.089,'−8.9%'],[0,'+0.0%']])assert.equal(formatPercent(value),text);
 assert.equal(headline('moss',{growth:.3,growthLabel:'5-year growth',growthStartYear:2020,growthEndYear:2025,momentum:'Accelerating',lastYear:1},2024,null,10,{from:2024,to:2024}),'From 2024 to 2024, research on moss was accelerating (+30% a year over 2020–2025). In 2024, 1 paper was published.');
});

test('complexity counts normalized Boolean joins and Retry-After delays without changing term coverage',async()=>{
 const {queryOperatorCount,retryDelay}=await import('./lib.js');
 for(const [syn,include,operators]of [['','a,b,c,d,e',5],['','a,b,c,d,e,f',6],['alias','a,b,c,d,e',6],['alias,ALIAS,topic','a,A,a',2]])assert.equal(queryOperatorCount(normaliseQuery('topic',syn,'',include)),operators);
 const preset='children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood';const q=normaliseQuery('topic','','',preset);assert.equal(queryOperatorCount(q),9);assert.equal(q.includeTerms.length,9);
 assert.equal(retryDelay('1',0),1000);assert.equal(retryDelay(null,0),1000);assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:02 GMT',0),2000);assert.equal(retryDelay('invalid',0),1000);
});

test('filtered headlines use natural contexts and zero-UAE wording with exact original numbers',()=>{
 const preset='children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood'.split(', ').sort();
 const kpis={growth:1,momentum:'Accelerating',lastYear:27,growthStartYear:2010,growthEndYear:2025,growthStartCount:1,growthEndCount:27};
 assert.equal(headline('Neurotechnology',kpis,2025,{gcc:1,uae:0},100,{from:2010,to:null},preset),'Research on neurotechnology in children is a new topic: from 1 paper in 2010 to 27 in 2025. Only 1 paper published since 2010 comes from the GCC, none from the UAE.');
 assert.equal(headline('Neurotechnology + child / infant',kpis,2025,null,100,{from:2010,to:null},['child','infant']),'Research on neurotechnology mentioning child or infant is a new topic: from 1 paper in 2010 to 27 in 2025.');
 assert.equal(headline('CRISPR',{growth:.1,momentum:'Growing',lastYear:100},2020,{gcc:1,uae:0},100,{from:2015,to:2020}),'From 2015 to 2020, research on CRISPR was growing (+10% a year). In 2020, 100 papers were published. Only 1 paper published between 2015 and 2020 came from the GCC, none from the UAE.');
 assert.equal(headline('Epigenetics',{growth:.1,momentum:'Growing',lastYear:100},2025,{gcc:2,uae:0},100,{from:2020,to:null}),'Since 2020, research on epigenetics has been growing (+10% a year). In 2025, 100 papers were published. Only 2 papers published since 2020 come from the GCC, none from the UAE.');
});

test('legacy cached headline prose also normalizes capitalized titles and zero UAE',async()=>{
 const {presentReport}=await import('./lib.js');
 const saved={name:'Neurotechnology',synonyms:[],searchTerms:{name:'Neurotechnology',synonyms:[]},headline:'Research on Neurotechnology is growing (+10% a year). Only 1 paper published since 2020 comes from the GCC (0 from the UAE).',regionalCounts:{gcc:1,uae:0}};
 assert.equal(presentReport(saved).headline,'Research on neurotechnology is growing (+10% a year). Only 1 paper published since 2020 comes from the GCC, none from the UAE.');
});

test("a single region preset group is named in the headline instead of listing every term", async () => {
  const { headlineSubject } = await import("./lib.js");
  const terms = globalThis.TMM_SEARCH_PRESETS.middleEast.terms;
  assert.equal(headlineSubject("inheritance law", [...terms]), "inheritance law in the Middle East");
  assert.equal(headlineSubject("inheritance law", [...globalThis.TMM_SEARCH_PRESETS.gcc.terms]), "inheritance law in the GCC");
  assert.equal(headlineSubject("neurotechnology", ["child", "infant"]), "neurotechnology mentioning child or infant");
});

test("all-preset groups read as a natural phrase, people before places", async () => {
  const { headlineSubject } = await import("./lib.js");
  const P = globalThis.TMM_SEARCH_PRESETS;
  assert.equal(headlineSubject("inheritance law", [[...P.gcc.terms], [...P.children.terms]]), "inheritance law in children in the GCC");
  assert.equal(headlineSubject("epigenetics", [...P.pregnancy.terms]), "epigenetics in pregnancy");
  assert.equal(headlineSubject("neurotechnology", [[...P.children.terms], ["school", "classroom"]]), "neurotechnology mentioning school or classroom in children");
  assert.equal(headlineSubject("artificial intelligence", [["early childhood education"], [...globalThis.TMM_COUNTRY_GROUPS.find(c => c.label === "UAE").terms]]), "artificial intelligence mentioning early childhood education in the UAE");
});

test("single-country groups are named in headlines", async () => {
  const { headlineSubject } = await import("./lib.js");
  const C = globalThis.TMM_COUNTRY_GROUPS, P = globalThis.TMM_SEARCH_PRESETS;
  assert.equal(headlineSubject("child custody", [...C.find(c => c.label === "UAE").terms]), "child custody in the UAE");
  assert.equal(headlineSubject("custody", [[...P.children.terms], [...C.find(c => c.label === "UAE").terms]]), "custody in children in the UAE");
});

test("long custom groups are shortened in titles and headlines", async () => {
  const { headlineSubject, shortGroup } = await import("./lib.js");
  const pupils = ["elementary school", "primary education", "primary school", "pupils", "schoolchildren"];
  assert.equal(shortGroup(pupils, " or "), "pupils (and 4 similar terms)");
  assert.equal(shortGroup(["child", "infant"], " or "), "child or infant");
  assert.equal(headlineSubject("gamification", pupils), "gamification mentioning pupils (and 4 similar terms)");
});
