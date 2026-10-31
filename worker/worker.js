import { normaliseQuery, buildQueries, shapeTopic, originAllowed, sanitiseSourceError, sanitiseCaughtError, cacheIsFresh, dailyCap, updateLibrary } from "./lib.js";

// Injection keeps all automated tests offline. Production uses the built-in fetch.
export function createWorker(fetchSource = (...args) => fetch(...args), now = () => new Date()) {
  // Serialise matching operations in this isolate; KV remains eventually consistent across isolates.
  const queues = new WeakMap();
  async function locked(kv, key, action) {
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
  return {
    async fetch(request, env) {
      const origin = request.headers.get("Origin");
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
      const respond = (body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
      const error = (code, message, status, extra) => respond({ error: code, message }, status, extra);
      if (!originAllowed(origin, env)) return error("origin_not_allowed", "This origin is not allowed. Open the configured site or use local development mode.", 403);
      if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
      const url = new URL(request.url);
      if (!["/api/topic", "/api/library"].includes(url.pathname)) return error("not_found", "This endpoint does not exist. Use /api/topic?q=your-topic.", 404);
      if (request.method === "OPTIONS") {
        const method = request.headers.get("Access-Control-Request-Method");
        if (method && method !== "GET") return error("method_not_allowed", "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: "GET, OPTIONS" });
        return respond(null, 204, { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "600" });
      }
      if (request.method !== "GET") return error("method_not_allowed", "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: "GET, OPTIONS" });
      const storageError = () => error("storage_unavailable", "The topic storage is unavailable. Try again later.", 503);
      if (url.pathname === "/api/library") {
        if (!env.TMM) return storageError();
        try { return respond(await env.TMM.get("library", "json") || []); }
        catch { return storageError(); }
      }
      const rawQuery = url.searchParams.get("q") || "";
      const rawSynonyms = url.searchParams.get("syn") || "";
      const cacheMode = url.searchParams.get("cache");
      if (cacheMode !== null && cacheMode !== "only") return error("invalid_query", "The cache option is invalid. Use cache=only to open a saved report.", 400);
      if (rawQuery.length > 200 || rawSynonyms.length > 1200) return error("invalid_query", "The search is too long. Use a topic under 200 characters and synonyms under 1,200 characters.", 400);
      let query;
      const subtopicId = url.searchParams.get("subtopic") || "";
      const subtopicName = url.searchParams.get("subtopicName") || "";
      const parent = url.searchParams.get("parent") || "";
      const parentName = url.searchParams.get("parentName") || "";
      if (subtopicName.length > 300 || parent.length > 2000 || parentName.length > 300) return error("invalid_query", "The sub-topic details are too long. Shorten them and try again.", 400);
      try { query = normaliseQuery(rawQuery, rawSynonyms, subtopicId); }
      catch { return error("invalid_query", "The sub-topic ID is invalid. Choose a sub-topic from the report and try again.", 400); }
      const parentQuery = normaliseQuery(rawQuery, rawSynonyms);
      if (subtopicId && parent && parent !== parentQuery.id) return error("invalid_query", "The sub-topic parent does not match its search terms. Open the parent report and choose the sub-topic again.", 400);
      if (subtopicId) Object.assign(query, { subtopicName: subtopicName.trim(), parent: parentQuery.id, parentName: parentQuery.name });
      else if (parent) query.parent = parent;
      if (query.parent === query.id) return error("invalid_query", "A topic cannot be its own parent. Choose a different parent and try again.", 400);
      if (!query.name) return error("invalid_query", "A research topic is required. Add a topic with the q parameter.", 400);
      const key = "topic:" + query.id;
      if (new TextEncoder().encode(key).length > 512) return error("invalid_query", "The search has too many terms. Shorten the topic or synonyms and try again.", 400);
      if (!env.TMM) return storageError();
      try {
        return await locked(env.TMM, key, async () => {
          const date = now();
          const record = await env.TMM.get(key, "json");
          const cached = record?.topic?.id === query.id ? record : null;
          if (cacheMode === "only") {
            if (!cached) return error("cache_miss", "This saved report is unavailable. Enter the topic and select Measure momentum to search again.", 404);
            return respond({ ...cached.topic, cached: true, ...(!cacheIsFresh(cached, date.getTime()) ? { stale: true } : {}) });
          }
          if (cached && cacheIsFresh(cached, date.getTime())) {
            await indexTopic(env.TMM, { ...cached.topic, ...(query.parent ? { parent: query.parent } : {}) });
            return respond({ ...cached.topic, cached: true });
          }
          let cap;
          try { cap = dailyCap(env.NEW_TOPICS_PER_DAY); }
          catch { return error("invalid_configuration", "The daily search limit is invalid. Set NEW_TOPICS_PER_DAY to a non-negative whole number and try again.", 503); }
          const countKey = "count:" + date.toISOString().slice(0, 10);
          const admitted = await locked(env.TMM, countKey, async () => {
            const count = await env.TMM.get(countKey, "json") ?? 0;
            if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid counter");
            if (count >= cap) return false;
            if (typeof env.OPENALEX_KEY !== "string" || !env.OPENALEX_KEY.trim()) return "missing_key";
            // Count the attempt before any paid source request, including eventual failures.
            await env.TMM.put(countKey, JSON.stringify(count + 1), { expirationTtl: 172800 });
            return true;
          });
          if (!admitted) {
            if (cached) {
              await indexTopic(env.TMM, cached.topic);
              return respond({ ...cached.topic, cached: true, stale: true });
            }
            return error("daily_limit", "Daily limit reached. Try again tomorrow or browse the Library.", 429);
          }
          if (admitted === "missing_key") return error("missing_key", "OPENALEX_KEY is not set. Add it to worker/.dev.vars.", 503);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20000);
          try {
            const dev = env.ENVIRONMENT === "dev";
            const pending = buildQueries(query, date.getUTCFullYear()).map(async ({ id, params }) => {
              let status = null;
              let stage = "url_setup";
              let sourceMessage;
              try {
                const upstream = new URL("https://api.openalex.org/works");
                upstream.search = new URLSearchParams(params).toString();
                upstream.searchParams.set("api_key", env.OPENALEX_KEY);
                stage = "fetch";
                // Workers supports manual redirects; never follow a credential-bearing redirect.
                const response = await fetchSource(upstream, { signal: controller.signal, redirect: "manual" });
                status = response.status;
                stage = "http_response";
                // Response.ok excludes every 3xx response as well as 4xx/5xx errors.
                if (!response.ok) {
                  if (dev) {
                    sourceMessage = "The source error message could not be read.";
                    sourceMessage = await response.text();
                  }
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
                throw new Error("Source unavailable");
              }
            });
            let results;
            if (dev) {
              // Let every query finish so one failure cannot hide other error messages.
              const settled = await Promise.allSettled(pending);
              if (settled.some((item) => item.status === "rejected")) throw new Error("Source unavailable");
              results = settled.map((item) => item.value);
            } else {
              results = await Promise.all(pending);
            }
            const topic = { ...shapeTopic(query, Object.fromEntries(results), date), ...(query.parent ? { parent: query.parent } : {}) };
            try {
              // No KV expiry: old reports remain available after the seven-day freshness window.
              await env.TMM.put(key, JSON.stringify({ savedAt: date.getTime(), topic }));
              await indexTopic(env.TMM, topic);
            } catch { return storageError(); }
            return respond(topic);
          } catch {
            controller.abort();
            // Responses never include upstream details; development logs are sanitised above.
            return error("source_unavailable", "The research data source is unavailable. Try again later.", 502);
          } finally { clearTimeout(timeout); }
        });
      } catch { return storageError(); }
    }
  };
}

export default createWorker();
