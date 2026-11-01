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

export function normaliseSubtopicId(value) {
  const match = String(value).match(/^(?:https:\/\/openalex\.org\/)?(T[0-9]+)$/);
  if (!match) throw new Error("Invalid sub-topic ID");
  return match[1];
}

export function validateRange(from = 2010, to = "", currentYear = new Date().getUTCFullYear()) {
  if (!/^\d{4}$/.test(String(from)) || Number(from) < 2000 || Number(from) > currentYear) throw new Error(`Enter a From year between 2000 and ${currentYear}.`);
  if (to !== "" && to !== null && (!/^\d{4}$/.test(String(to)) || Number(to) < 2000 || Number(to) > currentYear)) throw new Error(`Enter a To year between 2000 and ${currentYear}, or leave it empty to include papers up to today.`);
  const range = { from: Number(from), to: to === "" || to === null ? null : Number(to) };
  if (range.to !== null && range.from > range.to) throw new Error("The From year must be the same as or earlier than the To year.");
  return range;
}

export function rangeLabel(range, capital = false) {
  return range.to != null ? `${range.from}–${range.to}` : `${capital ? "Since" : "since"} ${range.from}`;
}

export function rangeDetails(range, currentYear) {
  const from = range.from ?? range.period ?? 2010;
  const to = range.to ?? null;
  const end = to ?? currentYear;
  const lastComplete = Math.min(end, currentYear - 1);
  const completeYears = Math.max(0, lastComplete - from + 1);
  const split = from + Math.floor(completeYears / 2);
  return { from, to, end, lastComplete, completeYears, split, expertsFrom: from < 2020 && to === null ? 2020 : from };
}

export function normaliseQuery(query, synonyms = "", subtopicId = "", include = "", from = 2010, to = "", currentYear = new Date().getUTCFullYear()) {
  const range = validateRange(from, to, currentYear);
  const name = cleanTerm(query);
  const terms = [...new Set(String(synonyms).split(",").map(cleanTerm).filter((term) => term && term !== name))].sort();
  const filterId = subtopicId ? normaliseSubtopicId(subtopicId) : "";
  const includeTerms = [...new Set(String(include).split(",").map(cleanTerm).filter(Boolean))].sort();
  const rangeId = range.to !== null ? [`range:${range.from}-${range.to}`] : range.from !== 2010 ? ["since:" + range.from] : [];
  return { name, synonyms: terms, ...range, id: [name, ...terms, ...(includeTerms.length ? ["include:" + JSON.stringify(includeTerms)] : []), ...rangeId, ...(filterId ? ["primary_topic:" + filterId] : [])].join("|"),
    ...(includeTerms.length ? { includeTerms } : {}), ...(filterId ? { subtopicId: filterId } : {}) };
}

export const REPORT_CACHE_PREFIX = "v3:topic:";
export const REPORT_RETENTION_SECONDS = 60 * 24 * 60 * 60;

export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function cacheIsFresh(record, time) {
  const age = time - record?.savedAt;
  return Number.isFinite(record?.savedAt) && age >= 0 && age < CACHE_MAX_AGE_MS;
}

export function dailyCap(value = 90) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid daily cap");
  return Number(value);
}

export function growthWindow(report) {
  const range = rangeDetails(report, Number(report.updated.slice(0, 4)));
  const useRange = report.kpis.growthLabel !== "5-year growth" && report.from !== undefined && range.completeYears >= 3;
  const growthStartYear = useRange ? range.from : range.lastComplete - 5;
  const growthEndYear = range.lastComplete;
  return { growthStartYear, growthEndYear,
    growthStartCount: report.years.find((item) => item.year === growthStartYear)?.count,
    growthEndCount: report.years.find((item) => item.year === growthEndYear)?.count };
}
export function repairBoundedGrowth(report) {
  if (report.to == null || !report.kpis || !Array.isArray(report.years)) return report;
  const range = rangeDetails(report, Number(report.updated.slice(0, 4)));
  const first = report.years.find((item) => item.year === range.lastComplete - 5)?.count;
  const last = report.years.find((item) => item.year === range.lastComplete)?.count;
  const available = Number.isFinite(first) && Number.isFinite(last);
  const growth5y = available ? growth(first, last, 5) : null;
  const {growthNeedsRebuild, ...saved} = report;
  return { ...saved, kpis: { ...report.kpis, growth5y, ...(range.completeYears < 3 ? {growth:growth5y, growthLabel:"5-year growth", momentum:momentum(growth5y)} : {}) },
    ...(!available && range.completeYears < 3 ? {growthNeedsRebuild:true} : {}) };
}
export function growthStartCount(report) { return growthWindow(report).growthStartCount; }
export function isNewTopic(window) {
  return Number.isFinite(window.growthStartCount) && (window.growthStartCount < 20 || window.growthStartCount < .02 * window.growthEndCount);
}
export function newTopicHeadline(name, window) {
  const title = headlineTopicName(name);
  const topic = title.charAt(0).toUpperCase() + title.slice(1);
  const count = (n) => new Intl.NumberFormat("en-US").format(n);
  return `${topic} is a new research topic: from ${count(window.growthStartCount)} ${window.growthStartCount === 1 ? "paper" : "papers"} in ${window.growthStartYear} to ${count(window.growthEndCount)} in ${window.growthEndYear}.`;
}

// Store the actual complete-year series and its range; no implicit ten-year window.
export function reportSummary(topic) {
  const range = rangeDetails(topic, Number(topic.updated.slice(0, 4)));
  const firstAvailable = Math.min(...topic.years.map((item) => item.year));
  const sparkStartYear = Math.max(range.from, firstAvailable);
  const counts = new Map(topic.years.map((item) => [item.year, item.count]));
  const spark = Array.from({ length: Math.max(0, range.lastComplete - sparkStartYear + 1) }, (_, i) => counts.get(sparkStartYear + i) ?? 0);
  return { id: topic.id, name: topic.name, parent: topic.parent || null, field: topic.field,
    momentum: topic.kpis.momentum, growth: Object.hasOwn(topic.kpis, "growth") ? topic.kpis.growth : topic.kpis.growth5y,
    total: topic.kpis.total, spark, updated: topic.updated, from: range.from, to: range.to, sparkStartYear,
    growthLabel: topic.kpis.growthLabel || "5-year growth", ...growthWindow(topic) };
}

// Whitelist topic fields; request headers and visitor details never enter the index.
export function updateLibrary(index, topic) {
  if (!Array.isArray(index)) throw new Error("Invalid library index");
  const previous = index.find((entry) => entry.id === topic.id);
  const parent = topic.parent || previous?.parent || null;
  const entry = { ...reportSummary(topic), synonyms: topic.synonyms, parent, children: [],
    ...(topic.includeTerms?.length ? { includeTerms: topic.includeTerms, searchTerms: topic.searchTerms, variant: !topic.subtopicId } : {}),
    ...(topic.from !== undefined ? { from: topic.from, to: topic.to, ...(topic.from !== 2010 || topic.to !== null ? { variant: !topic.subtopicId, searchTerms: topic.searchTerms } : {}) } : {}),
    ...(topic.period ? { period: topic.period, ...(topic.period !== 2010 ? { variant: !topic.subtopicId, searchTerms: topic.searchTerms } : {}) } : {}),
    ...(topic.subtopicId ? { subtopicId: topic.subtopicId, searchTerms: topic.searchTerms } : {})
  };
  const entries = previous ? index.map((item) => item.id === topic.id ? entry : item) : index.concat(entry);
  const byId = new Map(entries.map((item) => [item.id, item]));
  const seen = new Set([topic.id]);
  let ancestor = parent;
  while (ancestor) {
    if (seen.has(ancestor)) throw new Error("Invalid parent relationship");
    seen.add(ancestor);
    ancestor = byId.get(ancestor)?.parent;
  }
  // Rebuild links so refreshing a parent keeps its children, including child-first searches.
  return entries.map((item) => ({ ...item, children: entries.filter((child) => child.parent === item.id).map((child) => child.id) }));
}

export function buildSearchExpression(query) {
  const group = (terms) => `(${terms.map((term) => /[\s-]/.test(term) ? `"${term}"` : term).join(" OR ")})`;
  return group([query.name, ...query.synonyms]) + (query.includeTerms?.length ? ` AND ${group(query.includeTerms)}` : "");
}

// Descriptors contain only public parameters; the Worker adds authentication.
export function buildQueries(query, currentYear, coreOnly = true) {
  const search = `title_and_abstract.search:${buildSearchExpression(query)}${query.subtopicId ? `,primary_topic.id:${normaliseSubtopicId(query.subtopicId)}` : ""}`;
  const grouped = (id, group, filter, limit) => ({ id, params: {
    filter: `${search},${filter}`, group_by: group, per_page: String(limit)
  } });
  const since2020 = "from_publication_date:2020-01-01";
  const range = rangeDetails(query, currentYear);
  const window = (from, to) => `from_publication_date:${from}-01-01${to == null ? "" : `,to_publication_date:${to}-12-31`}`;
  const selected = window(range.from, range.to);
  const core = coreOnly ? ",primary_location.source.is_core:true" : "";
  const early = range.completeYears < 2 ? selected : window(range.from, range.split - 1);
  const late = range.completeYears < 2 ? selected : window(range.split, range.lastComplete);
  return [
    grouped("years", "publication_year", `publication_year:${Math.min(2010, range.from, range.lastComplete - 5)}-${currentYear}`, 200),
    grouped("experts", "authorships.author.id", `${window(range.expertsFrom, range.to)},primary_location.source.type:!repository,type:article|review${core}`, 10),
    grouped("early", "primary_topic.id", early, 200),
    grouped("late", "primary_topic.id", late, 200),
    grouped("countries", "authorships.countries", selected, 15),
    ...[
      ["uae", "countries/ae"],
      ["gcc", "countries/ae|countries/sa|countries/qa|countries/kw|countries/bh|countries/om"]
    ].map(([id, countries]) => ({ id, params: {
      filter: search + "," + selected + ",authorships.countries:" + countries, per_page: "1", select: "id"
    } })),
    grouped("journals", "primary_location.source.id", `${selected},primary_location.source.type:journal,type:article|review${core}`, 10),
    { id: "papers", params: { filter: `${search},${selected},type:article|review`, sort: "cited_by_count:desc", per_page: "6", select: "id,display_name,publication_year,cited_by_count,doi,authorships,primary_location" } },
    grouped("keywords", "keywords.id", since2020, 15),
    grouped("field", "primary_topic.field.id", since2020, 1)
  ];
}

export function fallbackQueries(query, currentYear, responses) {
  const needed = new Set();
  if (shapeExperts(responses.experts).length < 5) needed.add("experts");
  if (shapeJournals(responses.journals).length < 5) needed.add("journals");
  return buildQueries(query, currentYear, false).filter(({id}) => needed.has(id)).map(({id, params}) => ({id: id + "All", params}));
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

export function shapeYears(response, currentYear, startYear = 2010) {
  const values = new Map(groups(response).map((item) => [Number(item.key), item.count]));
  return Array.from({ length: currentYear - startYear + 1 }, (_, i) => ({ year: startYear + i, count: values.get(startYear + i) ?? 0 }));
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
  const early = new Map(groups(earlyResponse).map((item) => [normaliseSubtopicId(item.key), item.count]));
  return ranked(lateResponse).map((item) => ({ id: normaliseSubtopicId(item.key), name: displayName(item), late: item.count, early: early.get(normaliseSubtopicId(item.key)) ?? 0, growth: growth(early.get(normaliseSubtopicId(item.key)) ?? 0, item.count) }));
}

export function shapeCountries(response) {
  return ranked(response).flatMap((item) => {
    const match = String(item.key).match(/^(?:https:\/\/openalex\.org\/countries\/)?([a-z]{2})$/i);
    if (!match) return [];
    const code = match[1].toUpperCase();
    return [{ name: item.key_display_name || code, code, count: item.count, gcc: ["AE", "SA", "QA", "KW", "BH", "OM"].includes(code) }];
  }).slice(0, 15);
}

export function journalName(name) {
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  const acronyms = new Set(["IEEE", "ACM", "DNA", "RNA", "AI", "BMJ", "JAMA", "PNAS", "PLOS", "ACS", "IET"]);
  const minor = new Set(["a", "an", "the", "and", "or", "but", "of", "in", "on", "for", "to", "at", "by", "with"]);
  const words = name.toLowerCase().split(/(\s+)/);
  return words.map((word, i) => acronyms.has(word.toUpperCase()) ? word.toUpperCase() : i > 0 && i < words.length - 1 && minor.has(word) ? word : word.replace(/(^|[-/])\p{L}/gu, (c) => c.toUpperCase())).join("");
}
export function shapeJournals(response) {
  return ranked(response).slice(0, 10).map((item) => ({ name: journalName(displayName(item)), count: item.count }));
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
      journal: journalName(item.primary_location?.source?.display_name || "Unknown journal"),
      citations: item.cited_by_count,
      url: /^https:\/\/doi\.org\/\S+$/i.test(item.doi || "") ? item.doi : entityUrl(item.id, "W")
    };
  });
}

export function suggestedSynonyms(response, query) {
  return filterSuggestedTerms(ranked(response).map(displayName), query);
}

export function filterSuggestedTerms(names, query) {
  const excluded = [query.name, ...(query.synonyms || []), ...(query.includeTerms || [])].map(cleanTerm);
  const seen = new Set();
  return names.filter((name) => {
    const normalised = cleanTerm(name);
    if (!normalised || excluded.some((term) => ` ${term} `.includes(` ${normalised} `)) || seen.has(normalised)) return false;
    seen.add(normalised);
    return true;
  }).slice(0, 6);
}

const childrenTerms = "children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood".split(", ").sort();

export function reportLabel(baseName, includeTerms = [], period) {
  const suffix = period ? ` · ${typeof period === "object" ? rangeLabel(period) : `since ${period}`}` : "";
  if (!includeTerms.length) return baseName + suffix;
  const preset = JSON.stringify([...includeTerms].sort()) === JSON.stringify(childrenTerms);
  return `${baseName} + ${preset ? "Children 0–9" : includeTerms.join(" / ")}${suffix}`;
}

// Update presentation of older saved reports without refreshing data or writing KV.
export function presentReport(report) {
  if (!report || typeof report.name !== "string") return report;
  report = repairBoundedGrowth(report);
  const terms = report.includeTerms || report.searchTerms?.includeTerms || [];
  const reportRange = report.from !== undefined ? report : report.period;
  const periodSuffix = reportRange ? ` · ${typeof reportRange === "object" ? rangeLabel(reportRange) : `since ${reportRange}`}` : "";
  const bareName = periodSuffix && report.name.endsWith(periodSuffix) ? report.name.slice(0, -periodSuffix.length) : report.name;
  let baseName = report.searchTerms?.name || bareName;
  if (report.subtopicId) {
    baseName = bareName;
    const suffixes = [` + (${terms.join(" OR ")})`, reportLabel("", terms)];
    const suffix = terms.length && suffixes.find((item) => baseName.endsWith(item));
    if (suffix) baseName = baseName.slice(0, -suffix.length);
  }
  const name = reportLabel(baseName, terms, reportRange);
  return { ...report, name,
    ...(typeof report.headline === "string" ? { headline: report.kpis && report.from !== undefined && Array.isArray(report.years)
      ? headline(reportLabel(report.headlineName || baseName, terms), { ...report.kpis, ...growthWindow(report) }, Math.max(report.from, Math.min(report.to ?? Number(report.updated.slice(0, 4)) - 1, Number(report.updated.slice(0, 4)) - 1)), report.regionalCounts, report.kpis.total, report)
      : report.headline.replace(report.name, name) } : {}),
    ...(Array.isArray(report.suggestedSynonyms) ? { suggestedSynonyms: filterSuggestedTerms(report.suggestedSynonyms, { name: baseName, synonyms: report.synonyms, includeTerms: terms }) } : {}) };
}

export function exploreNext(subtopics, topicName) {
  const eligible = subtopics.filter((item) => cleanTerm(item.name) !== cleanTerm(topicName));
  const fastest = eligible.filter((item) => item.late >= 20 && item.growth !== null).sort((a, b) => b.growth - a.growth || b.late - a.late);
  const largest = eligible.slice().sort((a, b) => b.late - a.late);
  return [...new Map([...fastest, ...largest].map((item) => [item.id || item.name, { id: item.id, name: item.name }])).values()].slice(0, 6);
}

export function headlineTopicName(value) {
  // Keep supplied acronyms and mixed-case names; canonicalise common scientific proper nouns.
  const proper = new Map(["Alzheimer", "Parkinson", "Huntington", "Bayesian", "Fourier", "Gaussian", "Darwin", "Einstein", "Newton", "Japan", "China", "Europe", "European", "Africa", "African", "Asia", "Asian", "Arab", "Emirates", "Dubai", "Abu", "Dhabi"].map((word) => [word.toLowerCase(), word]));
  return String(value).replace(/ · (?:since \d{4}|\d{4}–\d{4})$/, "").replace(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g, (word) => {
    const stem = word.replace(/[’']s$/i, "");
    if (proper.has(stem.toLowerCase())) return proper.get(stem.toLowerCase()) + word.slice(stem.length);
    if (/^[A-Z]{2,6}$/.test(word) || /[a-z][A-Z]/.test(word)) return word;
    return word.toLowerCase();
  });
}

export function formatPercent(value) {
  return `${value < 0 ? "−" : "+"}${Math.abs(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 0 : 1)}%`;
}

export function headline(name, kpis, lastYear, regionalCounts, periodTotal = 0, period = 2020) {
  const range = typeof period === "object" ? period : { from: period, to: null };
  const prefix = range.to == null ? `Since ${range.from}, ` : `From ${range.from} to ${range.to}, `;
  const topicName = headlineTopicName(name);
  const count = new Intl.NumberFormat("en-US").format(kpis.lastYear);
  const published = `In ${lastYear}, ${count} ${kpis.lastYear === 1 ? "paper was" : "papers were"} published.`;
  const regionalPeriod = range.to == null ? `since ${range.from}` : `between ${range.from} and ${range.to}`;
  const regional = regionalCounts && periodTotal > 0 && regionalCounts.gcc / periodTotal < .05
    ? ` Only ${new Intl.NumberFormat("en-US").format(regionalCounts.gcc)} ${regionalCounts.gcc === 1 ? "paper" : "papers"} published ${regionalPeriod} ${range.to != null ? "came" : regionalCounts.gcc === 1 ? "comes" : "come"} from the GCC (${new Intl.NumberFormat("en-US").format(regionalCounts.uae)} from the UAE).` : "";
  const rateValue = Object.hasOwn(kpis, "growth") ? kpis.growth : kpis.growth5y;
  if (isNewTopic(kpis)) return newTopicHeadline(name, kpis) + regional;
  if (rateValue === null) return `${prefix}there is not enough data to calculate annual growth for ${topicName}. ${published}${regional}`;
  const rate = formatPercent(rateValue);
  const fallback = kpis.growthLabel === "5-year growth" ? ` over ${kpis.growthStartYear ?? lastYear - 5}–${kpis.growthEndYear ?? lastYear}` : "";
  return `${prefix}research on ${topicName} ${range.to == null ? "has been" : "was"} ${kpis.momentum.toLowerCase()} (${rate} a year${fallback}). ${published}${regional}`;
}

export function shapeRegionalCounts(uae, gcc) {
  if (![uae, gcc].every((response) => validCount(response?.meta?.count))) throw new Error("Invalid source response");
  return { uae: uae.meta.count, gcc: gcc.meta.count };
}

export function shapeTopic(query, responses, date) {
  const currentYear = date.getUTCFullYear();
  const range = rangeDetails(query, currentYear);
  const years = shapeYears(responses.years, currentYear, Math.min(2010, range.from, range.lastComplete - 5));
  const countFor = (year) => years.find((item) => item.year === year)?.count ?? 0;
  const growth5y = growth(countFor(range.lastComplete - 5), countFor(range.lastComplete), 5);
  const rangeGrowth = range.completeYears >= 3;
  const selectedGrowth = rangeGrowth ? growth(countFor(range.from), countFor(range.lastComplete), range.lastComplete - range.from) : growth5y;
  const growthLabel = rangeGrowth ? `Growth ${range.from}–${range.lastComplete}` : "5-year growth";
  const kpis = { total: years.filter((item) => item.year >= range.from && item.year <= range.end).reduce((sum, item) => sum + item.count, 0),
    lastYear: countFor(range.completeYears ? range.lastComplete : range.end), growth5y, growth: selectedGrowth, growthLabel, momentum: momentum(selectedGrowth) };
  const subtopicCountsOnly = range.completeYears < 2;
  const subtopics = shapeSubtopics(responses.early, responses.late).map((item) => subtopicCountsOnly ? { ...item, growth: null } : item);
  const regionalCounts = shapeRegionalCounts(responses.uae, responses.gcc);
  const periodTotal = kpis.total;
  const baseName = query.subtopicId ? query.subtopicName || query.subtopicId : query.name;
  const name = reportLabel(baseName, query.includeTerms, range);
  const window = growthWindow({ ...range, updated: date.toISOString().slice(0, 10), years, kpis });
  const headlineName = query.subtopicId ? baseName : query.headlineName || query.name;
  return {
    id: query.id, name, synonyms: query.synonyms, ...(headlineName !== baseName ? { headlineName } : {}), from: range.from, to: range.to,
    subtopicWindow: { countsOnly: subtopicCountsOnly, from: range.from, split: range.split, end: range.lastComplete },
    searchTerms: { name: query.name, synonyms: query.synonyms, ...(query.includeTerms?.length ? { includeTerms: query.includeTerms } : {}) },
    ...(query.includeTerms?.length ? { includeTerms: query.includeTerms, parent: query.parent || null } : {}),
    ...(query.subtopicId ? { subtopicId: query.subtopicId, parent: query.parent || null, parentName: query.parentName || query.name } : {}),
    field: ranked(responses.field).map(displayName)[0] || "Unclassified",
    updated: date.toISOString().slice(0, 10), years, kpis,
    headline: headline(reportLabel(headlineName, query.includeTerms), { ...kpis, ...window }, range.completeYears ? range.lastComplete : range.end, regionalCounts, periodTotal, range),
    sourceQuality: { experts: responses.expertsAll ? "all" : "core", journals: responses.journalsAll ? "all" : "core" },
    experts: shapeExperts(responses.expertsAll || responses.experts), subtopics: subtopics.slice(0, 9),
    countries: shapeCountries(responses.countries), regionalCounts, journals: shapeJournals(responses.journalsAll || responses.journals),
    papers: shapePapers(responses.papers), suggestedSynonyms: suggestedSynonyms(responses.keywords, query),
    exploreNext: exploreNext(subtopics, name), cached: false
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
// Remove filtered reports and their relationships from public browsing only.
export function publicLibrary(index) {
  const hidden = new Set(index.filter((item) => (item.from !== undefined && (item.from !== 2010 || item.to != null)) || item.id.includes("|range:") || (item.period && item.period !== 2010) || item.id.includes("|since:") || item.variant || item.includeTerms?.length || item.searchTerms?.includeTerms?.length || item.id.includes("|include:")).map((item) => item.id));
  let changed;
  do {
    changed = false;
    for (const item of index) {
      if (hidden.has(item.parent) && !hidden.has(item.id)) { hidden.add(item.id); changed = true; }
    }
  } while (changed);
  const visible = index.filter((item) => !hidden.has(item.id));
  const ids = new Set(visible.map((item) => item.id));
  return visible.map((item) => ({ ...item, children: (item.children || []).filter((id) => ids.has(id)) }));
}
