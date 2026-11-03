import { createAIService } from "./ai.js";
import { normaliseQuery, normaliseSubfieldId, normaliseFilters, SEARCH_PRESETS, queryParams, legacyMultiGroupId, queryOperatorCount, retryDelay, COMPLEX_SEARCH_MESSAGE, MAX_SOURCE_REQUESTS, buildQueries, fallbackQueries, shapeTopic, originAllowed, sanitiseSourceError, sanitiseCaughtError, cacheIsFresh, dailyCap, updateLibrary, presentReport, publicLibrary, validateRange, REPORT_CACHE_PREFIX, REPORT_RETENTION_SECONDS, rankExpertAuthors } from "./lib.js";

// Injection keeps all automated tests offline. Production uses the built-in fetch.
export function createWorker(fetchSource = (...args) => fetch(...args), now = () => new Date(), timing = {}) {
  const clock = timing.now || Date.now;
  const sleep = timing.sleep || ((milliseconds, signal) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("Request cancelled")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, {once:true});
    if (signal.aborted) abort();
  }));
  // Shared by searches in this instance; upstream 429 handling covers other instances.
  let pacingTail = Promise.resolve(), nextSourceStart = 0, cooldownUntil = 0, complexSearches = 0;
  let semanticTail = Promise.resolve(), nextSemanticStart = 0;
  async function paceSemantic(signal, start) {
    let response;
    const turn = semanticTail.then(async () => {
      const delay = nextSemanticStart - clock();
      if (delay > 0) await sleep(delay, signal);
      if (signal.aborted) throw new Error("Request cancelled");
      try { response = await start(); }
      finally { nextSemanticStart = clock() + 1000; }
    });
    semanticTail = turn.catch(() => {});
    await turn;
    return response;
  }
  async function pace(signal, complex, start) {
    if (!complex && complexSearches === 0 && clock() >= cooldownUntil) return start();
    let response;
    const turn = pacingTail.then(async () => {
      if (signal.aborted) throw new Error("Request cancelled");
      let delay;
      while ((delay = Math.max(nextSourceStart, cooldownUntil) - clock()) > 0) await sleep(delay, signal);
      if (signal.aborted) throw new Error("Request cancelled");
      nextSourceStart = clock() + 400;
      response = start();
    });
    pacingTail = turn.catch(() => {});
    await turn;
    return response;
  }
  const complexityError = (status = 400) => Object.assign(new Error(COMPLEX_SEARCH_MESSAGE), {code:"search_too_complex", status});
  // Serialise matching operations in this isolate; KV remains eventually consistent across isolates.
  const queues = new WeakMap();
  async function locked(kv, key, action) {
    kv = kv.originalBinding || kv;
    let pending = queues.get(kv);
    if (!pending) { pending = new Map(); queues.set(kv, pending); }
    const previous = pending.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    pending.set(key, current);
    await previous;
    try { return await action(); }
    finally { release(); if (pending.get(key) === current) pending.delete(key); }
  }
  async function indexTopic(kv, topic) {
    await locked(kv, "library", async () => {
      const index = await kv.get("library", "json") || [];
      const updated = updateLibrary(index, topic);
      // Hits do not spend writes unless a relationship or a missing entry needs repair.
      const before = index.slice().sort((a, b) => a.id.localeCompare(b.id));
      const after = updated.slice().sort((a, b) => a.id.localeCompare(b.id));
      if (JSON.stringify(before) !== JSON.stringify(after)) await kv.put("library", JSON.stringify(updated));
    });
  }
  async function reserveTopic(env, date) {
    const cap = Math.min(30, dailyCap(env.NEW_TOPICS_PER_DAY));
    const countKey = "count:" + date.toISOString().slice(0, 10);
          return await locked(env.TMM, countKey, async () => {
            const count = await env.TMM.get(countKey, "json") ?? 0;
            if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid counter");
            if (count >= cap) return false;
            if (typeof env.OPENALEX_KEY !== "string" || !env.OPENALEX_KEY.trim()) return "missing_key";
            // Count the attempt before any paid source request, including eventual failures.
            await env.TMM.put(countKey, JSON.stringify(count + 1), { expirationTtl: 172800 });
            return true;
          });
  }
  function sourceRequester(env, session, controller, complex) {
    const dev = env.ENVIRONMENT === "dev";
    return async ({ id, params }) => {
              let status = null;
              let stage = "url_setup";
              let sourceMessage;
              try {
                const upstream = new URL("https://api.openalex.org/works");
                upstream.search = new URLSearchParams(params).toString();
                upstream.searchParams.set("api_key", env.OPENALEX_KEY);
                let response;
                for (let attempt = 0; attempt <= 2; attempt++) {
                  stage = "pacing";
                  const start = () => pace(controller.signal, complex, () => {
                    if (controller.signal.aborted) throw new Error("Request cancelled");
                    if (session.requests >= MAX_SOURCE_REQUESTS) throw complexityError(429);
                    session.requests++;
                    session.bump?.("source");
                    stage = "fetch";
                    // Count retries and fallbacks; never follow a credential-bearing redirect.
                    return fetchSource(upstream, { signal: controller.signal, redirect: "manual" });
                  });
                  response = await (id === "semanticPapers" ? paceSemantic(controller.signal, start) : start());
                  status = response.status;
                  if (status !== 429) break;
                  const delay = Math.max(400, retryDelay(response.headers?.get("Retry-After"), clock()));
                  cooldownUntil = Math.max(cooldownUntil, clock() + delay);
                  if (attempt === 2 || delay > 1500) break;
                  await response.body?.cancel();
                }
                status = response.status;
                stage = "http_response";
                // Response.ok excludes every 3xx response as well as 4xx/5xx errors.
                if (!response.ok) {
                  if (dev || (complex && status === 400)) {
                    sourceMessage = "The source error message could not be read.";
                    sourceMessage = await response.text();
                  }
                  if (status === 414 || (complex && (status === 429 || (status === 400 && /too many|boolean|complex|too long|length|syntax|parse/i.test(sourceMessage || ""))))) throw complexityError(status === 429 ? 429 : 400);
                  throw new Error("Source unavailable");
                }
                stage = "response_parsing";
                return [id, await response.json()];
              } catch (caught) {
                if (dev) console.error("[OpenAlex]", {
                  query: id, status: status ?? "unavailable", stage,
                  message: sourceMessage !== undefined ? sanitiseSourceError(sourceMessage, env.OPENALEX_KEY) :
                    stage === "url_setup" ? "The request could not be constructed." :
                      status === null ? "The request failed before an HTTP response was received." : "The source returned an unreadable JSON response.",
                  error: sanitiseCaughtError(caught, env.OPENALEX_KEY)
                });
                if (caught.code === "search_too_complex") throw caught;
                if (complex && controller.signal.aborted && stage === "pacing") throw complexityError(429);
                throw new Error("Source unavailable");
              }
            };
  }
  async function topicResponse(url, env, respond, error, session = { requests: 0, reserved: false }) {
    const storageError = () => error("storage_unavailable", "The topic storage is unavailable. Try again later.", 503);
      const rawQuery = url.searchParams.get("q") || "";
      const rawSynonyms = url.searchParams.get("syn") || "";
      const includeKeys = ["include", "include2", "include3"];
      for (const key of url.searchParams.keys()) {
        if (/^include(?:\d*|Groups)$/.test(key) && (!includeKeys.includes(key) || url.searchParams.getAll(key).length > 1)) return error("invalid_query", "Use up to three include groups, with each group supplied once.", 400);
      }
      const rawIncludes = includeKeys.map(key => url.searchParams.get(key) || "");
      if (rawIncludes.reduce((sum, value) => sum + value.length, 0) > 1200) return error("invalid_query", "The additional terms are too long. Use fewer than 1,200 characters and try again.", 400);
      const rawInclude = rawIncludes.map(value => value.split(","));
      const cacheMode = url.searchParams.get("cache");
      if (cacheMode !== null && cacheMode !== "only") return error("invalid_query", "The cache option is invalid. Use cache=only to open a saved report.", 400);
      if (rawQuery.length > 200 || rawSynonyms.length > 1200) return error("invalid_query", "The search is too long. Use a topic under 200 characters and synonyms under 1,200 characters.", 400);
      let range;
      const currentYear = now().getUTCFullYear();
      try { range = validateRange(url.searchParams.get("from") ?? url.searchParams.get("period") ?? "2010", url.searchParams.get("to") ?? "", currentYear); }
      catch (caught) { return error("invalid_query", caught.message, 400); }
      let subfieldId = "";
      if (url.searchParams.getAll("subfield").length > 1) return error("invalid_query", "Choose a subfield from the report and try again.", 400);
      try { if (url.searchParams.has("subfield")) subfieldId = normaliseSubfieldId(url.searchParams.get("subfield")); }
      catch (caught) { return error("invalid_query", caught.message, 400); }
      let filters;
      try {
        if (url.searchParams.getAll("exclude").length > 1 || url.searchParams.getAll("authored").length > 1) throw new Error("Use each search filter once and try again.");
        filters = normaliseFilters({ excludeTerms: url.searchParams.has("exclude") ? JSON.parse(url.searchParams.get("exclude")) : [], authoredCodes: url.searchParams.has("authored") ? url.searchParams.get("authored").split(",") : [] });
      } catch { return error("invalid_query", "Use valid excluded terms and country codes, then try again.", 400); }
      let query;
      const subtopicId = url.searchParams.get("subtopic") || "";
      const subtopicName = url.searchParams.get("subtopicName") || "";
      const parent = url.searchParams.get("parent") || "";
      const parentName = url.searchParams.get("parentName") || "";
      if (subtopicName.length > 300 || parent.length > 2000 || parentName.length > 300) return error("invalid_query", "The sub-topic details are too long. Shorten them and try again.", 400);
      try { query = normaliseQuery(rawQuery, rawSynonyms, subtopicId, rawInclude, range.from, range.to, currentYear, subfieldId, SEARCH_PRESETS, filters); }
      catch { return error("invalid_query", "The sub-topic ID is invalid. Choose a sub-topic from the report and try again.", 400); }
      query.headlineName = rawQuery.trim();
      const parentQuery = normaliseQuery(rawQuery, rawSynonyms, "", rawInclude, range.from, range.to, currentYear, subfieldId);
      if (subtopicId && parent && parent !== parentQuery.id && parent !== legacyMultiGroupId(parentQuery)) return error("invalid_query", "The sub-topic parent does not match its search terms. Open the parent report and choose the sub-topic again.", 400);
      if (subtopicId) Object.assign(query, { subtopicName: subtopicName.trim(), parent: parentQuery.id, parentName: parentName.trim() || rawQuery.trim() });
      else if (subfieldId) query.parent = normaliseQuery(rawQuery, rawSynonyms, "", rawInclude, range.from, range.to, currentYear, "", SEARCH_PRESETS, filters).id;
      else if (query.excludeTerms?.length || query.authoredCodes?.length || query.includeTerms?.length || query.includeGroups?.length || (range.from !== 2010 || range.to !== null)) query.parent = normaliseQuery(rawQuery, rawSynonyms).id;
      else if (parent) query.parent = parent;
      if (query.parent === query.id) return error("invalid_query", "A topic cannot be its own parent. Choose a different parent and try again.", 400);
      if (!query.name) return error("invalid_query", "A research topic is required. Add a topic with the q parameter.", 400);
      const key = REPORT_CACHE_PREFIX + query.id;
      if (new TextEncoder().encode(key).length > 512) return error("invalid_query", COMPLEX_SEARCH_MESSAGE, 400);
      if (!env.TMM) return storageError();
      try {
        return await locked(env.TMM, key, async () => {
          const date = now();
          let record = await env.TMM.get(key, "json");
          const legacyId = legacyMultiGroupId(query);
          let legacyHit = false;
          if (!record && legacyId && new TextEncoder().encode(REPORT_CACHE_PREFIX + legacyId).length <= 512) {
            const previous = await env.TMM.get(REPORT_CACHE_PREFIX + legacyId, "json");
            if (previous?.topic?.id === legacyId) { record = previous; legacyHit = true; }
          }
          const cached = record?.topic?.id === (legacyHit ? legacyId : query.id) ? { ...record, topic: presentReport(record.topic) } : null;
          // Saved links rebuild automatically when the current-version record is missing.
          if (cacheMode === "only" && cached && !cached.topic.growthNeedsRebuild) {
            return respond({ ...cached.topic, cached: true, ...(!cacheIsFresh(cached, date.getTime()) ? { stale: true } : {}) });
          }
          if (cached && !cached.topic.growthNeedsRebuild && cacheIsFresh(cached, date.getTime())) {
            await indexTopic(env.TMM, { ...cached.topic, ...(!legacyHit && query.parent ? { parent: query.parent } : {}) });
            return respond({ ...cached.topic, cached: true });
          }
          let cap;
          try { cap = dailyCap(env.NEW_TOPICS_PER_DAY); }
          catch { return error("invalid_configuration", "The daily search limit is invalid. Set NEW_TOPICS_PER_DAY to a non-negative whole number and try again.", 503); }
          const admitted = session.reserved || await reserveTopic(env, date);
          if (admitted === true) session.reserved = true;
          if (!admitted) {
            if (cached) {
              if (!cached.topic.growthNeedsRebuild) await indexTopic(env.TMM, cached.topic);
              return respond({ ...cached.topic, cached: true, stale: true });
            }
            for (const prefix of ["v2:topic:", "topic:"]) {
              const legacy = await env.TMM.get(prefix + query.id, "json");
              if (legacy?.topic?.id === query.id) return respond({ ...legacy.topic, cached: true, stale: true });
            }
            return error("daily_limit", "Daily limit reached. Try again tomorrow or browse the Library.", 429);
          }
          if (admitted === "missing_key") return error("missing_key", "OPENALEX_KEY is not set. Add it to worker/.dev.vars.", 503);
          const complex = queryOperatorCount(query) > 5;
          if (complex) complexSearches++;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000);
          try {
            const dev = env.ENVIRONMENT === "dev";
            const requestSource = sourceRequester(env, session, controller, complex);
            const pending = buildQueries(query, date.getUTCFullYear()).map(requestSource);
            let results;
            if (dev) {
              // Let every query finish so one failure cannot hide other error messages.
              const settled = await Promise.allSettled(pending);
              if (settled.some((item) => item.status === "rejected")) throw settled.find((item) => item.status === "rejected" && item.reason?.code === "search_too_complex")?.reason || new Error("Source unavailable");
              results = settled.map((item) => item.value);
            } else {
              results = await Promise.all(pending);
            }
            results.push(...await Promise.all(fallbackQueries(query, date.getUTCFullYear(), Object.fromEntries(results)).map(requestSource)));
            const responses=Object.fromEntries(results);
            session.expertRanking=rankExpertAuthors(responses.expertsAll || responses.experts);
            const topic = { ...shapeTopic(query, responses, date), ...(query.parent ? { parent: query.parent } : {}) };
            try {
              // Fresh for seven days; retain stale fallback reports for at most sixty days.
              await env.TMM.put(key, JSON.stringify({ savedAt: date.getTime(), topic }), { expirationTtl: REPORT_RETENTION_SECONDS });
              await indexTopic(env.TMM, topic);
            } catch { return storageError(); }
            return respond(topic);
          } catch (caught) {
            controller.abort();
            if (caught.code === "search_too_complex") return error(caught.code, COMPLEX_SEARCH_MESSAGE, caught.status);
            // Responses never include upstream details; development logs are sanitised above.
            return error("source_unavailable", "The research data source is unavailable. Try again later.", 502);
          } finally { clearTimeout(timeout); if (complex) complexSearches--; }
        });
      } catch { return storageError(); }
  }
  const aiService = createAIService({ now, clock, locked, reserve: reserveTopic, source: async (descriptor, env, session, query, signal) => {
    const complex = queryOperatorCount(query) > 5;
    if (complex) complexSearches++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try { return (await sourceRequester(env, session, controller, complex)(descriptor))[1]; }
    finally { signal?.removeEventListener("abort", abort); if (complex) complexSearches--; }
  } });
  return {
    async fetch(request, env) {
      const origin = request.headers.get("Origin");
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
      const respond = (body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(Array.isArray(body) ? body.map(presentReport) : presentReport(body)), { status, headers: { ...headers, ...extra } });
      const error = (code, message, status, extra) => respond({ error: code, message }, status, extra);
      if (!originAllowed(origin, env)) return error("origin_not_allowed", "This origin is not allowed. Open the configured site or use local development mode.", 403);
      if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
      const url = new URL(request.url);
      if (!["/api/topic", "/api/library", "/api/search"].includes(url.pathname)) return error("not_found", "This endpoint does not exist. Use /api/topic?q=your-topic.", 404);
      if (request.method === "OPTIONS") {
        const method = request.headers.get("Access-Control-Request-Method");
        const expected = url.pathname === "/api/search" ? "POST" : "GET";
        if (method && method !== expected) return error("method_not_allowed", expected === "POST" ? "Send a POST request with your search sentence." : "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: expected + ", OPTIONS" });
        return respond(null, 204, { "Access-Control-Allow-Methods": url.pathname === "/api/search" ? "POST, OPTIONS" : "GET, OPTIONS", ...(url.pathname === "/api/search" ? { "Access-Control-Allow-Headers": "Content-Type" } : {}), "Access-Control-Max-Age": "600" });
      }
      if (url.pathname === "/api/search") {
        if (request.method !== "POST") return error("method_not_allowed", "Send a POST request with your search sentence.", 405, { Allow: "POST, OPTIONS" });
        if (Number(request.headers.get("Content-Length")) > 16384) return error("invalid_query", "The search is too long. Use a shorter sentence.", 400);
        let input;
        try { const text = await request.text(); if (new TextEncoder().encode(text).length > 16384) throw new Error(); input = JSON.parse(text); }
        catch { return error("invalid_query", "Send a search sentence as JSON and try again.", 400); }
        const result = await aiService.search(input, env, async (query, activeEnv, session) => {
          const result = await topicResponse(new URL("https://worker.invalid/api/topic?" + queryParams(query)), activeEnv, respond, error, session);
          return { body: await result.json(), status: result.status };
        });
        return respond(result.body, result.status);
      }
      if (request.method !== "GET") return error("method_not_allowed", "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: "GET, OPTIONS" });
      const storageError = () => error("storage_unavailable", "The topic storage is unavailable. Try again later.", 503);
      if (url.pathname === "/api/library") {
        if (!env.TMM) return storageError();
        try { return respond(publicLibrary(await env.TMM.get("library", "json") || [])); }
        catch { return storageError(); }
      }
      const result = await topicResponse(url, env, respond, error);
      if (!result.ok || !url.searchParams.has("understanding")) return result;
      return respond(await aiService.attach(await result.json(), url.searchParams.get("understanding"), env));
    }
  };
}

export default createWorker();
