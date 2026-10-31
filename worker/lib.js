// Pure query and response logic. No credentials or network calls belong here.
export function sanitiseSourceError(body, secret) {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : body;
  } catch { /* Plain-text source errors are also supported. */ }
  message = String(message).replace(/\\\//g, "/");
  // Remove complete URLs before truncation, even when the credential is near the end.
  message = message.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+|\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b(?:api\.)?openalex\.org\b[^\s<>"']*|\bhttps?%3a%2f%2f[^\s<>"']+/gi, "[URL removed]");
  if (secret) {
    const variants = [secret, encodeURI(secret), encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString().slice(6), JSON.stringify(secret).slice(1, -1)];
    for (const value of new Set(variants)) {
      const pattern = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      message = message.replace(new RegExp(pattern, "gi"), "[key removed]");
    }
  }
  message = message.replace(/api_key\s*[=:]\s*[^\s&,;<>"']+/gi, "api_key=[key removed]");
  return Array.from(message.replace(/[\x00-\x1f\x7f]/g, " ").trim()).slice(0, 300).join("") || "No error message was returned.";
}

export function sanitiseCaughtError(error, secret) {
  const seen = new Set();
  const read = (value, key) => {
    try { return value[key]; } catch { return undefined; }
  };
  const safe = (value) => sanitiseSourceError(String(value), secret);
  const describe = (value, depth = 0) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" && typeof value !== "function") return safe(value);
    if (seen.has(value)) return "[circular cause]";
    if (depth >= 4) return "[cause depth limit]";
    seen.add(value);
    const result = {
      name: safe(read(value, "name") ?? "Error"),
      message: safe(read(value, "message") ?? "No error message was provided.")
    };
    // Common network/TLS error fields; never inspect URLs, headers or stack traces.
    for (const key of ["code", "errno", "syscall"]) {
      const field = read(value, key);
      if (["string", "number"].includes(typeof field)) result[key] = safe(field);
    }
    result.cause = describe(read(value, "cause"), depth + 1);
    return result;
  };
  return describe(error);
}

export function cleanTerm(value) {
  return String(value ?? "").toLowerCase().replace(/[,|[\]{}()"'“”‘’:\\\x00-\x1f\x7f]/g, "").trim().replace(/\s+/g, " ");
}

export function normaliseQuery(query, synonyms = "") {
  const name = cleanTerm(query);
  const terms = [...new Set(String(synonyms).split(",").map(cleanTerm).filter((term) => term && term !== name))].sort();
  return { name, synonyms: terms, id: [name, ...terms].join("|") };
}

export function buildSearchExpression(query) {
  return `(${[query.name, ...query.synonyms].map((term) => /[\s-]/.test(term) ? `"${term}"` : term).join(" OR ")})`;
}

// Descriptors contain only public parameters; the Worker adds authentication.
export function buildQueries(query, currentYear) {
  const search = `title_and_abstract.search:${buildSearchExpression(query)}`;
  const grouped = (id, group, filter, limit) => ({ id, params: {
    filter: `${search},${filter}`, group_by: group, per_page: String(limit)
  } });
  const since2020 = "from_publication_date:2020-01-01";
  return [
    grouped("years", "publication_year", `publication_year:2010-${currentYear}`, 200),
    grouped("experts", "authorships.author.id", `${since2020},primary_location.source.type:!repository`, 10),
    grouped("early", "primary_topic.id", "from_publication_date:2020-01-01,to_publication_date:2022-12-31", 200),
    grouped("late", "primary_topic.id", `from_publication_date:2023-01-01,to_publication_date:${currentYear - 1}-12-31`, 200),
    grouped("countries", "authorships.countries", since2020, 15),
    ...[
      ["uae", "countries/ae"],
      ["gcc", "countries/ae|countries/sa|countries/qa|countries/kw|countries/bh|countries/om"]
    ].map(([id, countries]) => ({ id, params: {
      filter: search + "," + since2020 + ",authorships.countries:" + countries, per_page: "1", select: "id"
    } })),
    grouped("journals", "primary_location.source.id", `${since2020},primary_location.source.type:journal`, 10),
    { id: "papers", params: { filter: `${search},from_publication_date:2022-01-01`, sort: "cited_by_count:desc", per_page: "6", select: "id,display_name,publication_year,cited_by_count,doi,authorships,primary_location" } },
    grouped("keywords", "keywords.id", since2020, 15),
    grouped("field", "primary_topic.field.id", since2020, 1)
  ];
}

export function growth(start, end, years = 1) {
  return start === 0 ? null : (end / start) ** (1 / years) - 1;
}

export function momentum(value) {
  if (value === null) return "Not enough data";
  if (value >= .2) return "Accelerating";
  if (value >= .08) return "Growing";
  if (value >= 0) return "Stable";
  return "Cooling";
}

function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }

function groups(response) {
  if (!Array.isArray(response?.group_by) || !response.group_by.every((item) => item &&
    (item.key === null || ["string", "number"].includes(typeof item.key)) &&
    (item.key_display_name === null || typeof item.key_display_name === "string") && validCount(item.count))) {
    throw new Error("Invalid source response");
  }
  return response.group_by.filter((item) => item.key !== null && !["unknown", "-111"].includes(String(item.key)));
}

function ranked(response) { return groups(response).slice().sort((a, b) => b.count - a.count); }
function displayName(item) { return item.key_display_name || String(item.key); }
function entityUrl(value, type) {
  return new RegExp(`^https://openalex\\.org/${type}\\d+$`).test(value || "") ? value : "";
}

export function shapeYears(response, currentYear) {
  const values = new Map(groups(response).map((item) => [Number(item.key), item.count]));
  return Array.from({ length: currentYear - 2009 }, (_, i) => ({ year: 2010 + i, count: values.get(2010 + i) ?? 0 }));
}

export function shapeExperts(response) {
  const merged = new Map();
  for (const item of ranked(response)) {
    const name = displayName(item);
    if (merged.has(name)) {
      merged.get(name).count += item.count;
    } else {
      // Keep the highest-count record's link as the representative for this name.
      merged.set(name, { name, openalexUrl: entityUrl(item.key, "A"), count: item.count });
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 10);
}

export function shapeSubtopics(earlyResponse, lateResponse) {
  const early = new Map(groups(earlyResponse).map((item) => [String(item.key), item.count]));
  return ranked(lateResponse).map((item) => ({ name: displayName(item), late: item.count, growth: growth(early.get(String(item.key)) ?? 0, item.count) }));
}

export function shapeCountries(response) {
  return ranked(response).flatMap((item) => {
    const match = String(item.key).match(/^(?:https:\/\/openalex\.org\/countries\/)?([a-z]{2})$/i);
    if (!match) return [];
    const code = match[1].toUpperCase();
    return [{ name: item.key_display_name || code, code, count: item.count, gcc: ["AE", "SA", "QA", "KW", "BH", "OM"].includes(code) }];
  }).slice(0, 15);
}

export function shapeJournals(response) {
  return ranked(response).slice(0, 10).map((item) => ({ name: displayName(item), count: item.count }));
}

export function shapePapers(response) {
  if (!Array.isArray(response?.results) || !response.results.every((item) => item && typeof item.display_name === "string" &&
    Number.isInteger(item.publication_year) && validCount(item.cited_by_count) && Array.isArray(item.authorships))) {
    throw new Error("Invalid source response");
  }
  return response.results.slice().sort((a, b) => b.cited_by_count - a.cited_by_count).slice(0, 6).map((item) => {
    const authors = item.authorships.map((entry) => entry.author?.display_name).filter(Boolean);
    return {
      title: item.display_name,
      authors: authors.length ? `${authors.slice(0, 3).join(", ")}${authors.length > 3 ? ", et al." : ""}` : "Unknown authors",
      year: item.publication_year,
      journal: item.primary_location?.source?.display_name || "Unknown journal",
      citations: item.cited_by_count,
      url: /^https:\/\/doi\.org\/\S+$/i.test(item.doi || "") ? item.doi : entityUrl(item.id, "W")
    };
  });
}

export function suggestedSynonyms(response, query) {
  const excluded = new Set([query.name, ...query.synonyms]);
  const seen = new Set();
  return ranked(response).map(displayName).filter((name) => {
    const normalised = cleanTerm(name);
    if (!normalised || excluded.has(normalised) || seen.has(normalised)) return false;
    seen.add(normalised);
    return true;
  }).slice(0, 6);
}

export function exploreNext(subtopics, topicName) {
  const eligible = subtopics.filter((item) => cleanTerm(item.name) !== cleanTerm(topicName));
  const fastest = eligible.filter((item) => item.late >= 20 && item.growth !== null).sort((a, b) => b.growth - a.growth || b.late - a.late);
  const largest = eligible.slice().sort((a, b) => b.late - a.late);
  return [...new Set([...fastest, ...largest].map((item) => item.name))].slice(0, 6);
}

export function headline(name, kpis, lastYear) {
  const count = new Intl.NumberFormat("en-US").format(kpis.lastYear);
  if (kpis.growth5y === null) return `There is not enough data to calculate five-year growth for ${name}. ${count} papers were published in ${lastYear}.`;
  const rate = `${kpis.growth5y >= 0 ? "+" : ""}${(kpis.growth5y * 100).toFixed(1)}%`;
  return `Research on ${name} is ${kpis.momentum.toLowerCase()} (${rate} a year). ${count} papers were published in ${lastYear}.`;
}

export function shapeRegionalCounts(uae, gcc) {
  if (![uae, gcc].every((response) => validCount(response?.meta?.count))) throw new Error("Invalid source response");
  return { uae: uae.meta.count, gcc: gcc.meta.count };
}

export function shapeTopic(query, responses, date) {
  const currentYear = date.getUTCFullYear();
  const years = shapeYears(responses.years, currentYear);
  const countFor = (year) => years.find((item) => item.year === year)?.count ?? 0;
  const growth5y = growth(countFor(currentYear - 6), countFor(currentYear - 1), 5);
  const kpis = { total: years.reduce((sum, item) => sum + item.count, 0), lastYear: countFor(currentYear - 1), growth5y, momentum: momentum(growth5y) };
  const subtopics = shapeSubtopics(responses.early, responses.late);
  return {
    id: query.id, name: query.name, synonyms: query.synonyms,
    field: ranked(responses.field).map(displayName)[0] || "Unclassified",
    updated: date.toISOString().slice(0, 10), years, kpis,
    headline: headline(query.name, kpis, currentYear - 1),
    experts: shapeExperts(responses.experts), subtopics: subtopics.slice(0, 9),
    countries: shapeCountries(responses.countries), regionalCounts: shapeRegionalCounts(responses.uae, responses.gcc), journals: shapeJournals(responses.journals),
    papers: shapePapers(responses.papers), suggestedSynonyms: suggestedSynonyms(responses.keywords, query),
    exploreNext: exploreNext(subtopics, query.name), cached: false
  };
}

export function originAllowed(origin, env) {
  // Navigations and command-line requests do not carry an Origin header.
  if (origin === null) return true;
  if (origin === "null") return env.ENVIRONMENT === "dev";
  if (origin === env.ALLOWED_ORIGIN && /^https?:\/\//.test(origin)) return true;
  if (env.ENVIRONMENT !== "dev") return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && url.hostname === "localhost";
  } catch { return false; }
}
