import { normaliseQuery, buildQueries, shapeTopic, originAllowed, sanitiseSourceError, sanitiseCaughtError } from "./lib.js";

// Injection keeps all automated tests offline. Production uses the built-in fetch.
export function createWorker(fetchSource = (...args) => fetch(...args), now = () => new Date()) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get("Origin");
      const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
      const respond = (body, status = 200, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
      const error = (code, message, status, extra) => respond({ error: code, message }, status, extra);
      if (!originAllowed(origin, env)) return error("origin_not_allowed", "This origin is not allowed. Open the configured site or use local development mode.", 403);
      if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
      const url = new URL(request.url);
      if (url.pathname !== "/api/topic") return error("not_found", "This endpoint does not exist. Use /api/topic?q=your-topic.", 404);
      if (request.method === "OPTIONS") {
        const method = request.headers.get("Access-Control-Request-Method");
        if (method && method !== "GET") return error("method_not_allowed", "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: "GET, OPTIONS" });
        return respond(null, 204, { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "600" });
      }
      if (request.method !== "GET") return error("method_not_allowed", "This endpoint accepts GET requests. Send a GET request.", 405, { Allow: "GET, OPTIONS" });
      const rawQuery = url.searchParams.get("q") || "";
      const rawSynonyms = url.searchParams.get("syn") || "";
      if (rawQuery.length > 200 || rawSynonyms.length > 1200) return error("invalid_query", "The search is too long. Use a topic under 200 characters and synonyms under 1,200 characters.", 400);
      let query;
      const subtopicId = url.searchParams.get("subtopic") || "";
      const subtopicName = url.searchParams.get("subtopicName") || "";
      const parent = url.searchParams.get("parent") || "";
      const parentName = url.searchParams.get("parentName") || "";
      if (subtopicName.length > 300 || parent.length > 2000 || parentName.length > 300) return error("invalid_query", "The sub-topic details are too long. Shorten them and try again.", 400);
      try { query = normaliseQuery(rawQuery, rawSynonyms, subtopicId); }
      catch { return error("invalid_query", "The sub-topic ID is invalid. Choose a sub-topic from the report and try again.", 400); }
      if (subtopicId) Object.assign(query, { subtopicName: subtopicName.trim(), parent, parentName: parentName.trim() });
      if (!query.name) return error("invalid_query", "A research topic is required. Add a topic with the q parameter.", 400);
      if (typeof env.OPENALEX_KEY !== "string" || !env.OPENALEX_KEY.trim()) return error("missing_key", "OPENALEX_KEY is not set. Add it to worker/.dev.vars.", 503);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const date = now();
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
        return respond(shapeTopic(query, Object.fromEntries(results), date));
      } catch {
        controller.abort();
        // Responses never include upstream details; development logs are sanitised above.
        return error("source_unavailable", "The research data source is unavailable. Try again later.", 502);
      } finally { clearTimeout(timeout); }
    }
  };
}

export default createWorker();
