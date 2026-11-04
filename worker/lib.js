// Pure query and response logic. No credentials or network calls belong here.
import "../site/search-presets.js";
import { COUNTRY_CODES, placeDetails, countryLabel } from "./countries.js";

export const SEARCH_PRESETS = globalThis.TMM_SEARCH_PRESETS;
export const includeGroupIdentity = (groups, presets = SEARCH_PRESETS) => globalThis.TMM_PRESET_IDENTITIES.encode(groups, presets);

export function legacyMultiGroupId(query) {
  const groups = includeGroupsOf(query);
  if (groups.length < 2) return null;
  const current = includeGroupIdentity(groups), legacy = "includeGroups:" + JSON.stringify(groups);
  return current === legacy ? null : query.id.replace("|" + current, "|" + legacy);
}

export function includeGroupsOf(source) {
  if (Array.isArray(source)) return source.length ? Array.isArray(source[0]) ? source : [source] : [];
  const groups = source.includeGroups || source.searchTerms?.includeGroups;
  if (groups) return groups;
  const terms = source.includeTerms || source.searchTerms?.includeTerms || [];
  return terms.length ? [terms] : [];
}

export function normaliseIncludeGroups(input = "") {
  const raw = Array.isArray(input) && input.some(Array.isArray) ? input : [input];
  if (raw.length > 3) throw new Error("You can use up to three include groups. Remove a group to add another.");
  const seen = new Set();
  return raw.map(group => [...new Set((Array.isArray(group) ? group : String(group).split(",")).map(cleanTerm).filter(Boolean))].sort()).filter(group => {
    const key = JSON.stringify(group);
    if (!group.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function includeFields(groups) {
  return groups.length > 1 ? { includeGroups: groups } : groups.length ? { includeTerms: groups[0] } : {};
}

// Long custom groups read as "pupils (and 4 similar terms)" instead of listing every word.
export function shortGroup(terms, separator, format = (term) => term) {
  const clean = terms.map((term) => String(term).trim()).filter(Boolean);
  if (clean.length <= 3) return clean.map(format).join(separator);
  const lead = [...clean].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  return `${format(lead)} (and ${clean.length - 1} similar terms)`;
}
export function includePreset(terms) {
  const key = JSON.stringify([...terms].sort());
  return Object.values(SEARCH_PRESETS).find(preset => JSON.stringify([...preset.terms].sort()) === key)
    || (globalThis.TMM_COUNTRY_GROUPS || []).find(country => JSON.stringify([...country.terms].sort()) === key);
}
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

export function normaliseSubfieldId(value) {
  const match = String(value).match(/^(?:https:\/\/openalex\.org\/subfields\/)?([1-9][0-9]{3})$/);
  if (!match) throw new Error("Choose a subfield from the report and try again.");
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

export function normaliseQuery(query, synonyms = "", subtopicId = "", include = "", from = 2010, to = "", currentYear = new Date().getUTCFullYear(), subfield = "", presets = SEARCH_PRESETS, filters = {}) {
  const range = validateRange(from, to, currentYear);
  const name = cleanTerm(query);
  const terms = [...new Set(String(synonyms).split(",").map(cleanTerm).filter((term) => term && term !== name))].sort();
  const filterId = subtopicId ? normaliseSubtopicId(subtopicId) : "";
  const subfieldId = subfield ? normaliseSubfieldId(subfield) : "";
  const groups = normaliseIncludeGroups(include);
  const encodedGroups = includeGroupIdentity(groups, presets);
  const includeId = encodedGroups ? [encodedGroups] : [];
  const rangeId = range.to !== null ? [`range:${range.from}-${range.to}`] : range.from !== 2010 ? ["since:" + range.from] : [];
  const extra = normaliseFilters(filters);
  const extraId = [...(extra.excludeTerms?.length ? ["exclude:" + JSON.stringify(extra.excludeTerms)] : []), ...(extra.authoredCodes?.length ? ["authored:" + JSON.stringify(extra.authoredCodes)] : [])];
  return { name, synonyms: terms, ...range, id: [name, ...terms, ...includeId, ...rangeId, ...extraId, ...(subfieldId ? ["subfield:" + subfieldId] : []), ...(filterId ? ["primary_topic:" + filterId] : [])].join("|"),
    ...includeFields(groups), ...extra, ...(subfieldId ? { subfieldId } : {}), ...(filterId ? { subtopicId: filterId } : {}) };
}

export function normaliseFilters({ excludeTerms = [], authoredCodes = [] } = {}) {
  if (!Array.isArray(excludeTerms) || excludeTerms.length > 6 || excludeTerms.some(term => typeof term !== "string" || !cleanTerm(term) || term.length > 120)) throw new Error("Use up to six excluded terms, each under 120 characters.");
  if (!Array.isArray(authoredCodes) || authoredCodes.length > 64 || authoredCodes.some(code => typeof code !== "string" || !COUNTRY_CODES.has(code))) throw new Error("Choose valid country codes and try again.");
  return { ...(excludeTerms.length ? { excludeTerms: [...new Set(excludeTerms.map(cleanTerm))].sort() } : {}), ...(authoredCodes.length ? { authoredCodes: [...new Set(authoredCodes)].sort() } : {}) };
}

export function aiPlanSchema(year) {
  const term = { type: "string", minLength: 1, maxLength: 80 };
  const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const array = (items, maxItems, minItems = 0) => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
  return object({ topic: { ...term, maxLength: 200 }, synonyms: array(term, 5),
    includeGroups: array({ oneOf: [object({ preset: { type: "string", enum: Object.keys(SEARCH_PRESETS) } }), object({ terms: array(term, 8, 1) })] }, 3),
    place: object({ codes: array({ type: "string", pattern: "^[A-Z]{2}$" }, 64), mode: { type: "string", enum: ["authored", "mentions"] } }),
    excludeTerms: array({ ...term, maxLength: 120 }, 6),
    years: object({ from: { type: "integer", minimum: 2000, maximum: year }, to: { anyOf: [{ type: "null" }, { type: "integer", minimum: 2000, maximum: year }] } }) });
}
function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validateAIPlan(raw, year) {
  const fail = () => { throw new Error("Invalid interpretation"); };
  const terms = (list, max, length = 80, min = 0) => Array.isArray(list) && list.length >= min && list.length <= max && list.every(value => typeof value === "string" && value.length <= length && cleanTerm(value) && !/[\x00-\x1f\x7f|{}[\]\\]/.test(value)) && new Set(list).size === list.length;
  if (!exactObject(raw, ["topic", "synonyms", "includeGroups", "place", "excludeTerms", "years"]) || typeof raw.topic !== "string" || !terms([raw.topic], 1, 200)) fail();
  if (!terms(raw.synonyms, 5) || !terms(raw.excludeTerms, 6, 120) || !Array.isArray(raw.includeGroups) || raw.includeGroups.length > 3 || new Set(raw.includeGroups.map(group => JSON.stringify(group))).size !== raw.includeGroups.length) fail();
  for (const group of raw.includeGroups) {
    if (exactObject(group, ["preset"])) { if (typeof group.preset !== "string" || !Object.hasOwn(SEARCH_PRESETS, group.preset)) fail(); }
    else if (!exactObject(group, ["terms"]) || !terms(group.terms, 8, 80, 1)) fail();
  }
  if (!exactObject(raw.place, ["codes", "mode"]) || !["authored", "mentions"].includes(raw.place.mode) || !Array.isArray(raw.place.codes) || raw.place.codes.length > 64 || new Set(raw.place.codes).size !== raw.place.codes.length || raw.place.codes.some(code => !COUNTRY_CODES.has(code))) fail();
  if (!exactObject(raw.years, ["from", "to"]) || !Number.isInteger(raw.years.from) || raw.years.to !== null && !Number.isInteger(raw.years.to)) fail();
  validateRange(raw.years.from, raw.years.to, year);
  const excluded = raw.excludeTerms.map(cleanTerm);
  if (excluded.includes(cleanTerm(raw.topic)) || raw.synonyms.some(value => excluded.includes(cleanTerm(value)))) fail();
  return {...JSON.parse(JSON.stringify(raw)),topic:raw.topic.split(",").map(part=>part.trim()).filter(Boolean).join(", ")};
}
export function compileAIPlan(raw, year, mode = raw.place.mode, current = null) {
  raw = validateAIPlan(raw, year);
  if (!["authored", "mentions"].includes(mode)) throw new Error("Invalid place mode");
  const details = placeDetails(raw.place.codes, SEARCH_PRESETS, globalThis.TMM_COUNTRY_GROUPS);
  const groupKey = group => JSON.stringify([...group].map(cleanTerm).sort());
  let groups = current ? includeGroupsOf(current).map(group => [...group]) : raw.includeGroups.map(group => group.preset ? [...SEARCH_PRESETS[group.preset].terms] : [...group.terms]);
  if (current && details.terms.length) groups = groups.filter(group => groupKey(group) !== groupKey(details.terms));
  if (mode === "mentions" && details.terms.length && !groups.some(group => groupKey(group) === groupKey(details.terms))) groups.push(details.terms);
  const query = normaliseQuery(current?.name || raw.topic, (current?.synonyms || raw.synonyms).join(","), current?.subtopicId || "", groups, current?.from ?? raw.years.from, (current ? current.to : raw.years.to) ?? "", year, current?.subfieldId || "", SEARCH_PRESETS,
    { excludeTerms: current?.excludeTerms || raw.excludeTerms, authoredCodes: mode === "authored" ? raw.place.codes : [] });
  if (new TextEncoder().encode(REPORT_CACHE_PREFIX + query.id).length > 512 || groups.reduce((sum, group) => sum + group.join(",").length, 0) > 1200) throw new Error(COMPLEX_SEARCH_MESSAGE);
  query.headlineName = current?.headlineName || raw.topic;
  if (current?.subtopicName) query.subtopicName = current.subtopicName;
  return { query, place: raw.place.codes.length ? { codes: [...raw.place.codes].sort(), mode, label: details.label, terms: details.terms } : null };
}
export function isTighterPlan(initial, candidate, year) {
  const a = compileAIPlan(initial, year), b = compileAIPlan(candidate, year);
  // Phrase replacements cannot be proved narrower lexically: re-sampling decides
  // whether they improve precision. Never remove an AND constraint or population.
  return a.query.name === b.query.name && a.query.from === b.query.from && a.query.to === b.query.to
    && initial.place.mode === candidate.place.mode
    && JSON.stringify([...initial.place.codes].sort()) === JSON.stringify([...candidate.place.codes].sort())
    && initial.includeGroups.length === candidate.includeGroups.length
    && JSON.stringify(initial.includeGroups.filter(group => group.preset).map(group => group.preset).sort()) === JSON.stringify(candidate.includeGroups.filter(group => group.preset).map(group => group.preset).sort())
    && (a.query.excludeTerms || []).every(term => b.query.excludeTerms?.includes(term));
}
export function judgeTitles(raw, size) {
  if (!exactObject(raw, ["onTopic"]) || !Array.isArray(raw.onTopic) || raw.onTopic.length !== size || !raw.onTopic.every(value => typeof value === "boolean")) throw new Error("Invalid title judgments");
  return { matched: raw.onTopic.filter(Boolean).length, total: size, judgments: raw.onTopic };
}
export function titleSample(query, year) {
  const papers = buildQueries(query, year).find(item => item.id === "papers");
  return { id: "checkTitles", params: { filter: papers.params.filter.replace(",type:article|review", ""), per_page: "25", select: "id,display_name", sort: "relevance_score:desc" } };
}
export function semanticQuery(query, sentence, year) {
  // Membership enforces lexical, geography and other unsupported vector filters.
  return { id: "semanticPapers", params: { "search.semantic": sentence, filter: "publication_year:" + query.from + "-" + (query.to ?? year) + ",type:article|review", per_page: "30", select: "id,display_name,publication_year,cited_by_count,doi,authorships,primary_location" } };
}
export function semanticMembership(query, candidates, year) {
  const ids = [...new Set(candidates.map(item => item.id).filter(id => /^https:\/\/openalex\.org\/W\d+$/.test(id)))];
  if (!ids.length) throw new Error("No semantic candidates");
  const papers = buildQueries(query, year).find(item => item.id === "papers");
  return { id: "semanticMembership", params: { filter: papers.params.filter + ",openalex_id:" + ids.map(id => id.split("/").at(-1)).join("|"), per_page: "30", select: "id" } };
}

export function queryParams(query) {
  const params = new URLSearchParams({ q: query.name, syn: query.synonyms.join(","), from: String(query.from) });
  if (query.to != null) params.set("to", String(query.to));
  includeGroupsOf(query).forEach((group, index) => params.set(index ? "include" + (index + 1) : "include", group.join(",")));
  if (query.excludeTerms?.length) params.set("exclude", JSON.stringify(query.excludeTerms));
  if (query.authoredCodes?.length) params.set("authored", query.authoredCodes.join(","));
  if (query.subfieldId) params.set("subfield", query.subfieldId);
  for (const [property, key] of [["subtopicId", "subtopic"], ["subtopicName", "subtopicName"], ["parent", "parent"], ["parentName", "parentName"]]) if (query[property]) params.set(key, query[property]);
  return params;
}

export const REPORT_CACHE_PREFIX = "v3:topic:";

export function refinementCandidates(report) {
  const result = [], groups = includeGroupsOf(report);
  const terms = report.searchTerms || { name: report.name, synonyms: report.synonyms || [] };
  const excluded = new Set([terms.name, ...(terms.synonyms || []), ...groups.flat()].map(cleanTerm));
  const fits = (synonyms, include, subfield = report.subfieldId || "") => {
    try {
      if (include.reduce((sum, group) => sum + group.join(",").length, 0) > 1200 || synonyms.join(",").length > 1200) return false;
      const query = normaliseQuery(terms.name, synonyms.join(","), report.subtopicId || "", include, report.from ?? 2010, report.to ?? "", Number(report.updated.slice(0, 4)), subfield);
      return new TextEncoder().encode(REPORT_CACHE_PREFIX + query.id).length <= 512;
    } catch { return false; }
  };
  const distribution = report.subfields;
  if (!report.subfieldId && distribution?.total > 0 && distribution.total === report.kpis?.total && distribution.from === report.from && distribution.to === report.to) {
    const seen = new Set();
    const items = distribution.items.filter(item => {
      try { normaliseSubfieldId(item.id); } catch { return false; }
      if (seen.has(item.id) || typeof item.name !== "string" || !item.name.trim() || !Number.isSafeInteger(item.count) || item.count <= 0 || item.count > distribution.total) return false;
      seen.add(item.id); return true;
    }).sort((a, b) => b.count - a.count).slice(0, 5);
    const consistent = distribution.items.every(item => Number.isSafeInteger(item.count) && item.count >= 0 && item.count <= distribution.total) && distribution.items.reduce((sum, item) => sum + item.count, 0) <= distribution.total;
    if (consistent && items.length && items[0].count / distribution.total < .85) {
      for (const item of items) {
        if (!fits(terms.synonyms || [], groups, item.id)) continue;
        const suffix = ` · ${Math.round(item.count / distribution.total * 100)}%`;
        const budget = 30 - 5 - suffix.length;
        const chars = Array.from(item.name);
        const short = chars.length > budget ? chars.slice(0, budget - 1).join("") + "…" : item.name;
        result.push({ kind: "subfield", id: item.id, name: item.name, label: `Only ${short}${suffix}` });
        if (result.length === 2) break;
      }
    }
  }
  if (groups.length < 3) {
    for (const [preset, codes] of [["gcc", ["AE", "SA", "QA", "KW", "BH", "OM"]], ["middleEast", ["AE", "BH", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"]]]) {
      const definition = SEARCH_PRESETS[preset];
      if (groups.some(group => includePreset(group) === definition)) continue;
      const evidence = report.regionalCounts?.gcc > 0 || report.countries?.some(country => country.count > 0 && codes.includes(country.code));
      if (evidence && fits(terms.synonyms || [], [...groups, definition.terms])) result.push({ kind: "region", preset, label: "Mentions " + definition.label });
    }
  }
  let synonyms = 0;
  for (const term of report.suggestedSynonyms || []) {
    const clean = cleanTerm(term);
    if (!clean || excluded.has(clean)) continue;
    excluded.add(clean);
    if (!fits([...(terms.synonyms || []), clean], groups)) continue;
    result.push({ kind: "synonym", term: clean, label: "+ " + clean });
    if (++synonyms === 2 || result.length === 5) break;
  }
  return result.slice(0, 5);
}

export const subfieldTitle = (name, selected) => selected ? `${name}, ${selected.name} papers` : name;
export const REPORT_RETENTION_SECONDS = 60 * 24 * 60 * 60;

export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function cacheIsFresh(record, time) {
  const age = time - record?.savedAt;
  return Number.isFinite(record?.savedAt) && age >= 0 && age < CACHE_MAX_AGE_MS;
}

export function dailyCap(value = 30) {
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
export function headlineSubject(name, includeTerms = []) {
  const groups = includeGroupsOf(includeTerms);
  let base = String(name).replace(/ · (?:since \d{4}|\d{4}–\d{4})$/, "");
  const suffix = groups.length ? reportLabel("", includeTerms) : "";
  if (suffix && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  const topic = headlineTopicName(base);
  if (groups.length > 1) {
    const named = groups.map(terms => includePreset(terms));
    // All-preset searches read naturally: "inheritance law in children in the GCC". Places come last.
    if (named.every(preset => preset?.phrase)) return topic + " " + named.map(preset => preset.phrase).sort((left, right) => left.startsWith("in the ") - right.startsWith("in the ")).join(" ");
    if (named.some(preset => preset?.phrase)) {
      const custom = groups.filter((_, index) => !named[index]?.phrase).map(terms => shortGroup(terms, " or ", headlineTopicName));
      const phrases = named.filter(preset => preset?.phrase).map(preset => preset.phrase).sort((left, right) => /^in (?:the )?[A-ZÀ-Ý]/.test(left) - /^in (?:the )?[A-ZÀ-Ý]/.test(right));
      return topic + " mentioning " + custom.join(" and ") + " " + phrases.join(" ");
    }
    return topic + " matching " + groups.map(terms => includePreset(terms)?.subject || "one of " + shortGroup(terms, " or ", headlineTopicName)).join(" and ");
  }
  if (!groups.length) return topic;
  includeTerms = groups[0];
  const preset = JSON.stringify([...includeTerms].sort()) === JSON.stringify(childrenTerms);
  const named = preset ? null : includePreset(includeTerms);
  return topic + (preset ? " in children" : named ? " " + (named.phrase || "mentioning " + named.subject) : " mentioning " + shortGroup(includeTerms, " or ", headlineTopicName));
}
export function newTopicHeadline(name, window, includeTerms = []) {
  const count = (n) => new Intl.NumberFormat("en-US").format(n);
  return `Research on ${headlineSubject(name, includeTerms)} is a new topic: from ${count(window.growthStartCount)} ${window.growthStartCount === 1 ? "paper" : "papers"} in ${window.growthStartYear} to ${count(window.growthEndCount)} in ${window.growthEndYear}.`;
}

// Store the actual complete-year series and its range; no implicit ten-year window.
export function reportSummary(topic) {
  const range = rangeDetails(topic, Number(topic.updated.slice(0, 4)));
  const firstAvailable = Math.min(...topic.years.map((item) => item.year));
  const sparkStartYear = Math.max(range.from, firstAvailable);
  const counts = new Map(topic.years.map((item) => [item.year, item.count]));
  const spark = Array.from({ length: Math.max(0, range.lastComplete - sparkStartYear + 1) }, (_, i) => counts.get(sparkStartYear + i) ?? 0);
  return { id: topic.id, name: topic.name, parent: topic.parent || null, field: topic.field, ...normaliseFilters(topic),
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
    ...(topic.authoredCodes?.length || topic.excludeTerms?.length ? { variant: !topic.subtopicId, searchTerms: topic.searchTerms } : {}),
    ...(topic.subfieldId ? { subfieldId: topic.subfieldId, selectedSubfield: topic.selectedSubfield, searchTerms: topic.searchTerms, variant: !topic.subtopicId } : {}),
    ...(topic.includeGroups?.length ? { includeGroups: topic.includeGroups, searchTerms: topic.searchTerms, variant: !topic.subtopicId } : {}),
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
  const positive = group([query.name, ...query.synonyms]) + includeGroupsOf(query).map(terms => ` AND ${group(terms)}`).join("");
  return positive + (query.excludeTerms?.length ? ` NOT ${group(query.excludeTerms)}` : "");
}

// Descriptors contain only public parameters; the Worker adds authentication.
export const COMPLEX_SEARCH_MESSAGE = "This search has too many terms. Remove some synonyms or additional terms and try again.";
export const MAX_SOURCE_REQUESTS = 30;
export function queryOperatorCount(query) {
  return (query.synonyms?.length || 0) + includeGroupsOf(query).reduce((sum, group) => sum + group.length, 0) + (query.excludeTerms?.length || 0);
}
export function retryDelay(value, time) {
  if (value == null || value === "") return 1000;
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - time;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 1000;
}

export function buildQueries(query, currentYear, coreOnly = true) {
  const search = `title_and_abstract.search:${buildSearchExpression(query)}${query.subtopicId ? `,primary_topic.id:${normaliseSubtopicId(query.subtopicId)}` : ""}${query.subfieldId ? `,primary_topic.subfield.id:${normaliseSubfieldId(query.subfieldId)}` : ""}${query.authoredCodes?.length ? `,authorships.countries:${query.authoredCodes.join("|")}` : ""}`;
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
    grouped("field", "primary_topic.field.id", since2020, 1),
    grouped("subfields", "primary_topic.subfield.id", selected, 5)
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
  const excluded = [query.name, ...(query.synonyms || []), ...includeGroupsOf(query).flat()].map(cleanTerm);
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
  const groups = includeGroupsOf(includeTerms);
  return baseName + groups.map(terms => " + " + (includePreset(terms)?.label || shortGroup(terms, " / "))).join("") + suffix;
}

// Update presentation of older saved reports without refreshing data or writing KV.
export function presentReport(report) {
  if (!report || typeof report.name !== "string") return report;
  report = repairBoundedGrowth(report);
  const terms = includeGroupsOf(report);
  const reportRange = report.from !== undefined ? report : report.period;
  const periodSuffix = reportRange ? ` · ${typeof reportRange === "object" ? rangeLabel(reportRange) : `since ${reportRange}`}` : "";
  const bareName = periodSuffix && report.name.endsWith(periodSuffix) ? report.name.slice(0, -periodSuffix.length) : report.name;
  let baseName = report.searchTerms?.name || bareName;
  if (report.subtopicId) {
    baseName = bareName;
    if (report.selectedSubfield) {
      const selectedSuffix = `, ${report.selectedSubfield.name} papers`;
      if (baseName.endsWith(selectedSuffix)) baseName = baseName.slice(0, -selectedSuffix.length);
    }
    const suffixes = [` + (${(terms[0] || []).join(" OR ")})`, reportLabel("", terms)];
    const suffix = terms.length && suffixes.find((item) => baseName.endsWith(item));
    if (suffix) baseName = baseName.slice(0, -suffix.length);
  }
  const name = reportLabel(subfieldTitle(reportLabel(baseName, terms), report.selectedSubfield), [], reportRange);
  let legacyHeadline = report.headline?.replace(report.name, name);
  if (legacyHeadline) {
    const subject = headlineSubject(report.headlineName || baseName, terms);
    legacyHeadline = legacyHeadline.replace(/^Research on .+?(?= (?:is|has been|was) )/, "Research on " + subject)
      .replace(/^.+? is a new (?:research )?topic:/, "Research on " + subject + " is a new topic:");
    if (report.regionalCounts?.uae === 0) legacyHeadline = legacyHeadline.replace("from the GCC (0 from the UAE).", "from the GCC, none from the UAE.");
  }

  return { ...report, name, ...(report.kpis && Array.isArray(report.years) ? { refinements: refinementCandidates(report) } : {}),
    ...(typeof report.headline === "string" ? { headline: report.understanding?.check?.lowPrecision ? "These counts match the search terms, but many papers may be off-topic. Narrow the search before drawing conclusions." : report.kpis && report.from !== undefined && Array.isArray(report.years)
      ? headline(reportLabel(report.headlineName || baseName, terms), { ...report.kpis, ...growthWindow(report) }, Math.max(report.from, Math.min(report.to ?? Number(report.updated.slice(0, 4)) - 1, Number(report.updated.slice(0, 4)) - 1)), report.regionalCounts, report.kpis.total, report, terms)
      : legacyHeadline } : {}),
    ...(Array.isArray(report.suggestedSynonyms) ? { suggestedSynonyms: filterSuggestedTerms(report.suggestedSynonyms, { name: baseName, synonyms: report.synonyms, ...includeFields(terms) }) } : {}) };
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

export function headline(name, kpis, lastYear, regionalCounts, periodTotal = 0, period = 2020, includeTerms = []) {
  const range = typeof period === "object" ? period : { from: period, to: null };
  const prefix = range.to == null ? `Since ${range.from}, ` : `From ${range.from} to ${range.to}, `;
  const context = (range.selectedSubfield ? ` within ${range.selectedSubfield.name}` : "") + (range.authoredCodes?.length ? ` with authors in ${placeDetails(range.authoredCodes, SEARCH_PRESETS).label}` : "") + (range.excludeTerms?.length ? ` excluding ${range.excludeTerms.join(" or ")}` : "");
  const topicName = headlineSubject(name, includeTerms) + context;
  const count = new Intl.NumberFormat("en-US").format(kpis.lastYear);
  const published = `In ${lastYear}, ${count} ${kpis.lastYear === 1 ? "paper was" : "papers were"} published.`;
  const regionalPeriod = range.to == null ? `since ${range.from}` : `between ${range.from} and ${range.to}`;
  const regional = regionalCounts && periodTotal > 0 && regionalCounts.gcc === 0
    ? ` None ${range.to != null ? "came" : "come"} from the GCC.`
    : regionalCounts && periodTotal > 0 && regionalCounts.gcc / periodTotal < .05
    ? ` Only ${new Intl.NumberFormat("en-US").format(regionalCounts.gcc)} ${regionalCounts.gcc === 1 ? "paper" : "papers"} published ${regionalPeriod} ${range.to != null ? "came" : regionalCounts.gcc === 1 ? "comes" : "come"} from the GCC${regionalCounts.uae === 0 ? ", none from the UAE." : ` (${new Intl.NumberFormat("en-US").format(regionalCounts.uae)} from the UAE).`}` : "";
  const rateValue = Object.hasOwn(kpis, "growth") ? kpis.growth : kpis.growth5y;
  // Almost nothing published: say so plainly instead of "from 0 papers to 0".
  if (kpis.growthStartCount === 0 && kpis.growthEndCount === 0 && periodTotal > 0) return `Research on ${headlineSubject(name, includeTerms)} is very rare: only ${new Intl.NumberFormat("en-US").format(periodTotal)} ${periodTotal === 1 ? "paper" : "papers"} found ${regionalPeriod}.${regional}`;
  if (isNewTopic(kpis)) return newTopicHeadline(name, kpis, includeTerms).replace(" is a new topic:", context + " is a new topic:") + regional;
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
  const groups = includeGroupsOf(query);
  const fields = includeFields(groups);
  const subfields = { from: range.from, to: range.to, total: kpis.total, items: ranked(responses.subfields).flatMap(item => {
    try { return [{ id: normaliseSubfieldId(item.key), name: displayName(item), count: item.count }]; } catch { return []; }
  }).slice(0, 5) };
  const selectedSubfield = query.subfieldId ? subfields.items.find(item => item.id === query.subfieldId) || { id: query.subfieldId, name: "Subfield " + query.subfieldId } : null;
  const selection = selectedSubfield ? { subfieldId: query.subfieldId, selectedSubfield: { id: selectedSubfield.id, name: selectedSubfield.name } } : {};
  const name = reportLabel(subfieldTitle(reportLabel(baseName, groups), selectedSubfield), [], range);
  const window = growthWindow({ ...range, updated: date.toISOString().slice(0, 10), years, kpis });
  const headlineName = query.subtopicId ? baseName : query.headlineName || query.name;
  const report = {
    id: query.id, name, synonyms: query.synonyms, ...(headlineName !== baseName ? { headlineName } : {}), from: range.from, to: range.to,
    subtopicWindow: { countsOnly: subtopicCountsOnly, from: range.from, split: range.split, end: range.lastComplete },
    searchTerms: { name: query.name, synonyms: query.synonyms, ...fields, ...normaliseFilters(query), ...(query.subfieldId ? { subfieldId: query.subfieldId } : {}) },
    subfields, ...selection, ...normaliseFilters(query),
    ...(query.authoredCodes?.length ? { authoredLabel: placeDetails(query.authoredCodes, SEARCH_PRESETS).label } : {}),
    ...(groups.length ? { ...fields, parent: query.parent || null } : {}),
    ...(query.subtopicId ? { subtopicId: query.subtopicId, parent: query.parent || null, parentName: query.parentName || query.name } : {}),
    field: ranked(responses.field).map(displayName)[0] || "Unclassified",
    updated: date.toISOString().slice(0, 10), years, kpis,
    headline: headline(reportLabel(headlineName, groups), { ...kpis, ...window }, range.completeYears ? range.lastComplete : range.end, regionalCounts, periodTotal, { ...range, ...selection, ...normaliseFilters(query) }, groups),
    sourceQuality: { experts: responses.expertsAll ? "all" : "core", journals: responses.journalsAll ? "all" : "core" },
    experts: shapeExperts(responses.expertsAll || responses.experts), subtopics: subtopics.slice(0, 9),
    countries: shapeCountries(responses.countries), regionalCounts, journals: shapeJournals(responses.journalsAll || responses.journals),
    papers: shapePapers(responses.papers), suggestedSynonyms: suggestedSynonyms(responses.keywords, query),
    exploreNext: exploreNext(subtopics, name), cached: false
  };
  return { ...report, refinements: refinementCandidates(report) };
}

export function originAllowed(origin, env) {
  // Navigations and command-line requests do not carry an Origin header.
  if (origin === null) return true;
  if (origin === "null") return env.ENVIRONMENT === "dev";
  if (origin === env.ALLOWED_ORIGIN && /^https?:\/\//.test(origin)) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && url.hostname === "localhost";
  } catch { return false; }
}
// Remove filtered reports and their relationships from public browsing only.
export function publicLibrary(index) {
  const hidden = new Set(index.filter((item) => (item.from !== undefined && (item.from !== 2010 || item.to != null)) || item.id.includes("|range:") || (item.period && item.period !== 2010) || item.id.includes("|since:") || item.variant || item.authoredCodes?.length || item.excludeTerms?.length || /\|(exclude:|authored:)/.test(item.id) || item.subfieldId || item.id.includes("|subfield:") || includeGroupsOf(item).length || item.id.includes("|include:") || item.id.includes("|includeGroups:")).map((item) => item.id));
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

// Step 16: one vocabulary and pure evidence logic shared by orchestration/tests.
export function cleanAIPlanTerms(plan) {
  // Canonicalization must never discard a word because it looks generic.
  return {...plan, includeGroups: [...new Map(plan.includeGroups.map(group => [JSON.stringify(group), group])).values()]};
}
export function reliabilitySamples(query, year, seed = 1) {
  const end = query.to ?? year, split = query.from + Math.floor((end - query.from + 1) / 2);
  const base = buildQueries(query, year).find(item => item.id === "papers");
  const withoutDates = base.params.filter.replace(/,(?:from|to)_publication_date:[^,]+/g, "").replace(",type:article|review", "");
  return [["early", query.from, split - 1], ["late", split, end]].filter(([, from, to]) => from <= to).map(([period, from, to]) => ({
    id: "check" + period, period, params: { filter: withoutDates + `,from_publication_date:${from}-01-01,to_publication_date:${to}-12-31`, sample: "10", seed: String(seed), per_page: "10", select: "id,display_name" }
  }));
}
export function reliabilityCheck(early, late) {
  const matched = early.matched + late.matched, total = early.total + late.total;
  const lowPrecision = total > 0 && matched / total < .7;
  const trendDistorted = early.total > 0 && late.total > 0 && Math.abs(early.matched / early.total - late.matched / late.total) > .25 + Number.EPSILON;
  return { matched, total, early, late, lowPrecision, trendDistorted };
}
export const EVIDENCE_NOTICES = {
  few: "Few papers match this question exactly",
  low: "Many matching papers may be off-topic; narrow the search for reliable numbers",
  trend: "The trend may be distorted by off-topic papers."
};
export function checkedEvidence(candidates, judgments) {
  const accepted = candidates.filter((_, i) => judgments[i] === true);
  return { papers: accepted.slice().sort((a, b) => b.cited_by_count - a.cited_by_count || a.id.localeCompare(b.id)).slice(0, 10).flatMap(item => shapePapers({ results: [item] })),
    experts: [], accepted: accepted.length, candidates: candidates.length };
}

// Question-grounded plans: model output may refine terms, never erase an intent.
export const dailyKey = date => date.toISOString().slice(0, 10);
export function aiTimeouts(env) {
  const duration=(value,fallback)=>Number.isSafeInteger(Number(value)) && Number(value)>0?Number(value):fallback;
  return {planning:duration(env.AI_TIMEOUT_MS,25000),checking:duration(env.AI_CHECK_TIMEOUT_MS,12000),preparation:duration(env.AI_PREPARATION_MS,90000)};
}
export function aiStopReason(aborted, currentTime, deadline, calls) {
  if(aborted || currentTime>=deadline)return "ai_total_deadline";
  return calls>=14?"ai_call_limit":null;
}
export const SELF_CHECK_TIMEOUT_NOTE = "Your search plan is ready, but its final AI self-check took too long. Paper and expert lists are unavailable until the checks finish. Try the question again later.";
export function parseModelReply(value) {
  if (typeof value !== "string") return value;
  const text=value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); } catch { /* Accept a complete object followed by prose, never truncated JSON. */ }
  if (text[0] !== "{") throw new SyntaxError("The model reply is not a JSON object.");
  let depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(quoted){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;
    else if(char==="{")depth++;
    else if(char==="}" && --depth===0) {
      const tail=text.slice(i+1).trim().replace(/^```\s*/, "");
      // A second JSON value is ambiguous; do not silently choose between answers.
      if(/^[{\[]/.test(tail))throw new SyntaxError("The model returned multiple JSON values.");
      return JSON.parse(text.slice(0,i+1));
    }
  }
  throw new SyntaxError("The model reply contains incomplete JSON.");
}
export function aiAttemptDiagnostic({stage,attempt,call,category,error,parseableJSON,rawReply,secrets=[]}) {
  const redact=value=>{
    let text=String(value ?? "");
    for(const secret of secrets)if(typeof secret==="string" && secret)text=text.split(secret).join("[redacted]");
    return text.replace(/\bBearer\s+[^\s,"'}]+/gi,"Bearer [redacted]").replace(/((?:api[_-]?key|authorization|(?:access[_-]?)?token|secret|password)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,"$1[redacted]")
      .replace(/\b(?:sk-|sk_)[a-zA-Z0-9_-]+/g,"[redacted]");
  };
  return {stage,attempt,call,category,errorName:redact(error.name || "Error").slice(0,60),message:redact(error.detail || error.message).slice(0,160),parseableJSON,replyPreview:redact(rawReply).slice(0,800)};
}
export function dailyReset(date) {
  const next = new Date(date);
  next.setUTCHours(24, 0, 0, 0);
  const rome = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Rome",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(next);
  return {at:next.toISOString(),rome};
}
export function aiFailureMessage(reason, date) {
  if (["daily_ai_limit", "daily_neuron_limit"].includes(reason)) return `Today's AI checks are used up. They reset at ${dailyReset(date).rome} (Rome time). Saved reports and the Library still work.`;
  if (reason === "search_neuron_limit") return "This question needs more AI checking than one search allows. Shorten the question and try again. Saved reports and the Library still work.";
  if (["ai_timeout","ai_call_timeout"].includes(reason)) return "An AI call took too long. Try again later. Saved reports and the Library still work.";
  if (reason === "ai_total_deadline") return "The search reached its total time limit. Try again later. Saved reports and the Library still work.";
  if (reason === "ai_call_limit") return "This question needed too many AI checks. Shorten the question and try again. Saved reports and the Library still work.";
  if (["ai_validation","ai_bad_json"].includes(reason)) return "The AI returned an invalid search plan. Rephrase your question and try again. Saved reports and the Library still work.";
  return "The AI check could not finish. Try again later or rephrase your question. Saved reports and the Library still work.";
}
export function questionRequirements(sentence, year) {
  const parts = globalThis.TMM_QUERY_PARSER.questionParts(sentence, year);
  return { topic: parts.concepts[0] || "", focus: parts.concepts.slice(1), population: parts.population.map(item=>item.label), place: parts.place.map(item=>item.label) };
}
// Sources are verbatim spans, not a second vocabulary of hand-written concepts.
const QUESTION_SCAFFOLD = new Set("a an the and or of on in for to with about regarding concerning how what which why when where who whose does do did is are was were be been can could will would should may might its it their they them this that these those research researchers studies study links growing developing evolving changing trends increasing help helps learn leading field since from between until during written authored excluding without except s".split(" "));
export const questionContentWords = sentence => [...new Set((String(sentence).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => !QUESTION_SCAFFOLD.has(word)))];
export function questionHasPlace(sentence, year) {
  if(globalThis.TMM_QUERY_PARSER.questionParts(sentence,year).place.length)return true;
  const words=value=>String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const text=" "+words(sentence)+" ",names=new Intl.DisplayNames(["en"],{type:"region"});
  return [...COUNTRY_CODES].some(code=>[names.of(code),countryLabel(code)].some(name=>text.includes(" "+words(name)+" ")));
}
export function groundedPlanSchema(year, sentence = null) {
  const object = properties => ({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
  const text = {type:"string",minLength:1,maxLength:1000};
  const plan=aiPlanSchema(year);
  const namedPlace=sentence===null || questionHasPlace(sentence,year);
  plan.properties.place=namedPlace?{anyOf:[{type:"null"},plan.properties.place]}:{type:"null"};
  if(namedPlace)plan.properties.place.anyOf[1].properties.codes.items={type:"string",enum:[...COUNTRY_CODES]};
  plan.required=plan.required.filter(key=>key!=="place");
  const candidate = object({plan,sources:{type:"array",maxItems:40,items:object({path:{type:"string",maxLength:80},source:text})}});
  return object({...candidate.properties,ambiguity:{anyOf:[{type:"null"},object({question:{...text,maxLength:180},options:{type:"array",minItems:2,maxItems:3,items:object({label:{...text,maxLength:80},...candidate.properties})}})]}});
}
export function groundPlan(candidate, sentence, year) {
  const raw = validateAIPlan(candidate?.plan, year);
  if (!Array.isArray(candidate.sources) || candidate.sources.length > 40) throw new Error("Invalid plan sources");
  const sources = new Map();
  for (const entry of candidate.sources) {
    if (!exactObject(entry,["path","source"]) || typeof entry.path !== "string" || typeof entry.source !== "string" || !entry.source.trim() || entry.source.length > 1000) throw new Error("Invalid plan source");
    // Exact words, including spelling/case. Prevent a source matching inside another word.
    const start = sentence.indexOf(entry.source);
    const before = start > 0 ? sentence[start-1] : "", after = sentence[start+entry.source.length] || "";
    const path = entry.path.replace(/^plan\./, "").replace(/\[(\d+)\]/g, ".$1");
    if (start >= 0 && !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after) && !sources.has(path)) sources.set(path,entry.source);
  }
  const used = [];
  const keep = path => {const source=sources.get(path);if(source)used.push({path,source});return Boolean(source);};
  const topic = keep("topic") ? raw.topic : "";
  const select = (items,prefix) => {
    const selected=[];
    items.forEach((item,index)=>{const source=sources.get(prefix+index);if(source){used.push({path:prefix+selected.length,source});selected.push(item);}});
    return selected;
  };
  const synonyms = select(raw.synonyms,"synonyms.");
  const includeGroups = select(raw.includeGroups,"includeGroups.");
  const place = keep("place") ? raw.place : {codes:[],mode:"mentions"};
  const excludeTerms = select(raw.excludeTerms,"excludeTerms.");
  const years = {from:keep("years.from")?raw.years.from:2010,to:keep("years.to")?raw.years.to:null};
  const covered = new Set(used.flatMap(entry=>questionContentWords(entry.source)));
  const missing = questionContentWords(sentence).filter(word=>!covered.has(word));
  return {plan:{topic,synonyms,includeGroups,place,excludeTerms,years},sources:used,missing};
}
export function reconcileGrounding(grounded, plan, sentence) {
  const original=new Map(grounded.sources.map(entry=>[entry.path,entry.source])),sources=[];
  const retain=(path,previous=path)=>{const source=original.get(previous);if(source)sources.push({path,source});};
  retain("topic");
  for (const field of ["synonyms","includeGroups","excludeTerms"]) plan[field].forEach((item,index)=>{
    const previous=grounded.plan[field].findIndex(value=>JSON.stringify(value)===JSON.stringify(item));
    if(previous>=0)retain(field+"."+index,field+"."+previous);
  });
  if(plan.place.codes.length)retain("place");
  for(const field of ["from","to"])if(plan.years[field]!==null)retain("years."+field);
  const covered=new Set(sources.flatMap(entry=>questionContentWords(entry.source)));
  return {plan,sources,missing:questionContentWords(sentence).filter(word=>!covered.has(word))};
}
// Repair the model boundary only; cached/internal plans still use the strict validator.
export function repairGroundedResponse(value, sentence, year, record = () => {}) {
  const raw=value?.plan ?? value;
  const usable=(term,max=80)=>typeof term==="string" && term.trim() && term.length<=max && !/[\x00-\x1f\x7f|{}[\]\\]/.test(term);
  const cleanTrend=value=>globalThis.TMM_QUERY_PARSER.cleanTrendTerm(value,sentence);
  const topic=typeof raw?.topic==="string"?cleanTrend(raw.topic.split(",").map(part=>part.trim()).filter(Boolean).join(", ")):"";
  if(!usable(topic,200))throw new Error("The model reply has no usable research topic.");
  const note=(field,reason,action="dropped_or_repaired")=>record({field,action,reason});
  const sourceInput=value?.sources ?? raw.sources;
  const entries=Array.isArray(sourceInput)?sourceInput:sourceInput && typeof sourceInput==="object"?Object.entries(sourceInput).map(([path,source])=>({path,source})):[];
  const sources=new Map();
  for(const entry of entries.slice(0,40))if(typeof entry?.path==="string" && entry.path.length<=80 && typeof entry.source==="string" && entry.source.trim() && entry.source.length<=1000){
    const path=entry.path.replace(/^plan\./,"").replace(/\[(\d+)\]/g,".$1");
    if(!sources.has(path))sources.set(path,entry.source);
  }
  if(JSON.stringify(entries)!==JSON.stringify(sourceInput))note("sources","invalid_source_entries");
  const used=[];
  const retain=(target,original=target)=>{if(sources.has(original))used.push({path:target,source:sources.get(original)});};
  retain("topic");
  // A literal topic supplies its own source if the optional sources field is absent/broken.
  if(!used.length){const start=sentence.indexOf(topic);if(start>=0)used.push({path:"topic",source:sentence.slice(start,start+topic.length)});}
  const list=(field,max,length=80)=>{
    const result=[];
    for(const [index,item] of (Array.isArray(raw[field])?raw[field]:[]).entries())if(usable(item,length)){
      const term=cleanTerm(field==="synonyms"?cleanTrend(item):item);
      if(term && result.length<max && !result.includes(term)){retain(field+"."+result.length,field+"."+index);result.push(term);}
    }
    if(JSON.stringify(result)!==JSON.stringify(raw[field]))note(field,"invalid_or_duplicate_terms");
    return result;
  };
  const synonyms=list("synonyms",5),exclusions=list("excludeTerms",6,120),includeGroups=[];
  for(const [index,group] of (Array.isArray(raw.includeGroups)?raw.includeGroups:[]).entries()){
    let cleaned=null;
    if(typeof group?.preset==="string" && Object.hasOwn(SEARCH_PRESETS,group.preset))cleaned={preset:group.preset};
    else if(Array.isArray(group?.terms)){
      const terms=[...new Set(group.terms.filter(term=>usable(term)).map(cleanTrend).filter(Boolean).map(cleanTerm))].slice(0,8);
      if(terms.length)cleaned={terms};
    }
    if(cleaned && includeGroups.length<3 && !includeGroups.some(item=>JSON.stringify(item)===JSON.stringify(cleaned))){
      retain("includeGroups."+includeGroups.length,"includeGroups."+index);includeGroups.push(cleaned);
    }
  }
  if(JSON.stringify(includeGroups)!==JSON.stringify(raw.includeGroups))note("includeGroups","invalid_or_duplicate_groups");
  const namedPlace=questionHasPlace(sentence,year);
  const suppliedCodes=raw.place?.codes;
  const validCodes=Array.isArray(suppliedCodes)?[...new Set(suppliedCodes.filter(code=>COUNTRY_CODES.has(code)))].slice(0,64):[];
  let place={codes:[],mode:"mentions"};
  if(namedPlace && validCodes.length){place={codes:validCodes,mode:raw.place.mode==="authored"?"authored":"mentions"};retain("place");}
  if(raw.place!=null && (JSON.stringify(place)!==JSON.stringify(raw.place)))note("place",!namedPlace?"no_named_place":!validCodes.length?"invalid_codes":"invalid_place_fields",place.codes.length?"repaired":"dropped");
  const parsedYear=input=>Number.isInteger(input)?input:typeof input==="string" && /^\d{4}$/.test(input)?Number(input):null;
  const requested=globalThis.TMM_QUERY_PARSER.questionParts(sentence,year);
  let years={from:parsedYear(raw.years?.from) ?? 2010,to:parsedYear(raw.years?.to)};
  try{validateRange(years.from,years.to,year);}catch{years={from:2010,to:null};}
  let rangeSource=null;
  if(requested.explicitRange){
    try{
      validateRange(requested.from,requested.to,year);
      years={from:requested.from,to:requested.to};
      rangeSource=sentence.match(/\b(?:since|from|after)\s+\d{4}\b|\bbetween\s+\d{4}\s+and\s+\d{4}\b/i)?.[0] || null;
    }catch{ /* Invalid requested dates remain uncovered and require rephrasing. */ }
  }
  if(JSON.stringify(years)!==JSON.stringify(raw.years))note("years","invalid_years");
  for(const field of ["from","to"])if(years[field]!==null){
    if(rangeSource)used.push({path:"years."+field,source:rangeSource});
    else if(years[field]===parsedYear(raw.years?.[field]))retain("years."+field);
  }
  const excludeTerms=exclusions.filter(term=>term!==cleanTerm(topic) && !synonyms.includes(term));
  if(excludeTerms.length!==exclusions.length){
    note("excludeTerms","conflicting_exclusions");
    const old=used.filter(entry=>entry.path.startsWith("excludeTerms."));
    for(let i=used.length-1;i>=0;i--)if(used[i].path.startsWith("excludeTerms."))used.splice(i,1);
    excludeTerms.forEach((term,index)=>{const source=old.find(entry=>entry.path==="excludeTerms."+exclusions.indexOf(term));if(source)used.push({...source,path:"excludeTerms."+index});});
  }
  const plan=validateAIPlan({topic,synonyms,includeGroups,place,excludeTerms,years},year);
  if(Object.keys(raw).some(key=>!["topic","synonyms","includeGroups","place","excludeTerms","years"].includes(key)) || (value?.plan && Object.keys(value).some(key=>!["plan","sources","ambiguity"].includes(key))))note("extra_keys","unexpected_fields");
  let ambiguity=null;
  if(value?.ambiguity!=null){
    const proposed=value.ambiguity;
    if(typeof proposed.question==="string" && proposed.question.trim() && proposed.question.length<=180 && Array.isArray(proposed.options) && proposed.options.length>=2 && proposed.options.length<=3){
      try{
        const labels=new Set();
        const options=proposed.options.map(option=>{
          if(typeof option?.label!=="string" || !option.label.trim() || option.label.length>80 || labels.has(option.label))throw new Error("Invalid option");
          labels.add(option.label);
          const repaired=repairGroundedResponse({...option,ambiguity:null},sentence,year,record);
          const grounded=groundPlan(repaired,sentence,year);
          if(!grounded.plan.topic || grounded.missing.length)throw new Error("Incomplete option");
          return {label:option.label,plan:repaired.plan,sources:repaired.sources};
        });
        ambiguity={question:proposed.question,options};
      }catch{note("ambiguity","invalid_options");}
    }else note("ambiguity","invalid_options");
  }
  return {plan,sources:used,ambiguity};
}
export function validateGroundedResponse(value, sentence, year, record) {
  value=repairGroundedResponse(value,sentence,year,record);
  groundPlan(value,sentence,year);
  if (value.ambiguity !== null) {
    const ambiguity=value.ambiguity;
    if (!exactObject(ambiguity,["question","options"]) || typeof ambiguity.question!=="string" || !ambiguity.question.trim() || ambiguity.question.length>180 || !Array.isArray(ambiguity.options) || ambiguity.options.length<2 || ambiguity.options.length>3) throw new Error("Invalid ambiguity");
    const labels=new Set();
    for (const option of ambiguity.options) {
      if (!exactObject(option,["label","plan","sources"]) || typeof option.label!=="string" || !option.label.trim() || option.label.length>80 || labels.has(option.label)) throw new Error("Invalid ambiguity option");
      labels.add(option.label);
      const grounded=groundPlan(option,sentence,year);
      if (!grounded.plan.topic || grounded.missing.length) throw new Error("Incomplete ambiguity option");
    }
  }
  return value;
}
// Recover only a literal, single-concept question; never invent model expansions or choices.
export function literalQuestionPlan(candidate, sentence, year) {
  const parts = globalThis.TMM_QUERY_PARSER.questionParts(sentence, year);
  if (parts.concepts.length !== 1 || parts.population.length || parts.place.length || /\b(?:without|excluding|except)\b/i.test(sentence)) return candidate;
  if (cleanTerm(parts.concepts[0]) !== cleanTerm(candidate.plan.topic) || candidate.plan.synonyms.length || candidate.plan.includeGroups.length || candidate.plan.place.codes.length || candidate.plan.excludeTerms.length) return candidate;
  const start = sentence.toLowerCase().indexOf(candidate.plan.topic.toLowerCase());
  if (start < 0) return candidate;
  const sources = [{path:"topic",source:sentence.slice(start,start+candidate.plan.topic.length)}];
  for (const [field,value] of Object.entries({from:parts.from,to:parts.to})) if (value !== null && sentence.includes(String(value))) sources.push({path:"years."+field,source:String(value)});
  return {...candidate,plan:{...candidate.plan,years:{from:parts.from,to:parts.to}},sources};
}
export function planRequirements(plan) {
  return {topic:plan.topic,alternatives:plan.synonyms,requiredGroups:plan.includeGroups.map(group=>group.preset?{label:SEARCH_PRESETS[group.preset].label,alternatives:SEARCH_PRESETS[group.preset].terms}:{alternatives:group.terms}),place:plan.place,exclusions:plan.excludeTerms};
}
export function passingTitleIds(raw, size) {
  if(!exactObject(raw,["pass"]) || !Array.isArray(raw.pass) || raw.pass.length>size || raw.pass.some(id=>!Number.isInteger(id)||id<1||id>size) || new Set(raw.pass).size!==raw.pass.length)throw new Error("Invalid title judgments");
  return Array.from({length:size},(_,i)=>raw.pass.includes(i+1));
}
export function verifiedExperts(ranked, candidates, judgments) {
  const allowed=new Set(candidates.filter((_,i)=>judgments[i]===true).flatMap(paper=>(paper.authorships||[]).map(entry=>entry.author?.id)));
  return ranked.filter(author=>allowed.has(author.openalexUrl)).slice(0,10).map(author=>({...author}));
}
export function expertCandidateQuery(query, ranked, year) {
  const ids=[...new Set(ranked.slice(0,10).map(author=>author.openalexUrl).filter(id=>/^https:\/\/openalex\.org\/A\d+$/.test(id||"")))];
  if(!ids.length)return null;
  const base=buildQueries(query,year).find(item=>item.id==="papers");
  return {id:"expertCandidates",params:{...base.params,filter:base.params.filter+",authorships.author.id:"+ids.map(id=>id.split("/").at(-1)).join("|"),per_page:"50"}};
}

export function rankExpertAuthors(response) {
  return ranked(response).flatMap(item=>/^https:\/\/openalex\.org\/A\d+$/.test(item.key||"")&&item.key_display_name&&item.count>0?[{name:item.key_display_name,openalexUrl:item.key,count:item.count}]:[]).slice(0,10);
}

// This is the existing SPEC budget assumption, not a verified billing tariff.
export const OPENALEX_ESTIMATE_USD_PER_CALL = .001;
export function explicitOpenAlexUsd(headerValue, bodyValue) {
  const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value
    : typeof value === "string" && /^(?:\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
  const header=number(headerValue),body=number(bodyValue);
  // Conflicting or unitless signals cannot establish dollar cost.
  return header!==null && body!==null && header!==body ? null : body ?? header;
}
const usd = value => Math.round(value * 1e9) / 1e9;
export function openAlexUsage(attempts = []) {
  const reported=attempts.filter(item=>Number.isFinite(item.reportedUsd)&&item.reportedUsd>=0);
  const byQuery={},byStage={};
  for(const item of attempts){byQuery[item.query]=(byQuery[item.query]||0)+1;byStage[item.stage]=(byStage[item.stage]||0)+1;}
  return {calls:attempts.length,measuredCalls:true,reportedCalls:reported.length,
    reportedUsd:reported.length===attempts.length?usd(reported.reduce((sum,item)=>sum+item.reportedUsd,0)):null,
    partialReportedUsd:usd(reported.reduce((sum,item)=>sum+item.reportedUsd,0)),
    estimatedUsd:usd(attempts.length*OPENALEX_ESTIMATE_USD_PER_CALL),estimatePerCallUsd:OPENALEX_ESTIMATE_USD_PER_CALL,
    costBasis:attempts.length===0?"no_requests":reported.length===attempts.length?"provider_reported_usd":"estimate_from_spec",
    byQuery,byStage,attempts:attempts.map(item=>({...item}))};
}
export function combineOpenAlexUsage(usages) {
  const result={calls:0,measuredCalls:true,reportedCalls:0,reportedUsd:0,partialReportedUsd:0,estimatedUsd:0,estimatePerCallUsd:OPENALEX_ESTIMATE_USD_PER_CALL,byQuery:{},byStage:{},attempts:[]};
  for(const usage of usages){
    if(!usage || usage.measuredCalls!==true || !Number.isInteger(usage.calls) || usage.calls<0){result.measuredCalls=false;continue;}
    result.calls+=usage.calls;result.reportedCalls+=usage.reportedCalls||0;
    result.partialReportedUsd+=usage.partialReportedUsd||0;
    result.estimatedUsd+=usage.calls*OPENALEX_ESTIMATE_USD_PER_CALL;
    for(const field of ["byQuery","byStage"])for(const [key,count] of Object.entries(usage[field]||{}))result[field][key]=(result[field][key]||0)+count;
    result.attempts.push(...(usage.attempts||[]));
  }
  result.estimatedUsd=usd(result.estimatedUsd);result.partialReportedUsd=usd(result.partialReportedUsd);
  result.reportedUsd=result.measuredCalls&&result.reportedCalls===result.calls?result.partialReportedUsd:null;
  result.costBasis=!result.measuredCalls?"incomplete":result.calls===0?"no_requests":result.reportedUsd!==null?"provider_reported_usd":"estimate_from_spec";
  return result;
}
export function openAlexBudgetSummary(rows, budgetUsd = .90) {
  const evaluation=combineOpenAlexUsage(rows.map(row=>row.openalex));
  const totals={evaluatedQuestions:rows.length,evalCalls:evaluation.calls,evalCallsComplete:evaluation.measuredCalls,evalReportedUsd:evaluation.reportedUsd,evalEstimatedUsd:evaluation.estimatedUsd};
  // Zero-call cache hits and clarification-only responses cannot price a fresh search.
  const fresh=rows.filter(row=>row.pass && row.mode==="ai" && !row.cached && row.openalex?.measuredCalls && row.openalex.calls>0);
  if(!fresh.length)return {...totals,budgetUsd,freshSearches:0,recommendedNewTopicsPerDay:null,readyToRaiseCap:false,reason:"No complete fresh checked-search measurements"};
  const provider=fresh.every(row=>row.openalex.reportedUsd!==null);
  const costs=fresh.map(row=>provider?row.openalex.reportedUsd:row.openalex.estimatedUsd);
  const maximum=Math.max(...costs),calls=fresh.map(row=>row.openalex.calls);
  return {...totals,budgetUsd,freshSearches:fresh.length,totalCalls:calls.reduce((sum,count)=>sum+count,0),maxCallsPerSearch:Math.max(...calls),
    totalUsd:usd(costs.reduce((sum,cost)=>sum+cost,0)),averageUsd:usd(costs.reduce((sum,cost)=>sum+cost,0)/costs.length),maxUsdPerSearch:maximum,
    costBasis:provider?"provider_reported_usd":"estimate_from_spec",recommendedNewTopicsPerDay:maximum>0?Math.floor((budgetUsd+1e-12)/maximum):null,
    readyToRaiseCap:false,reason:provider?"Observed sample maximum only; retain the 30-attempt cap until a hard daily dollar guard covers heavier searches and retries":"Dollar costs use the unverified SPEC rate; verify pricing and add a hard daily dollar guard before raising the cap"};
}
