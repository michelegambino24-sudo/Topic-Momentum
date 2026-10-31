# Topic Momentum Meter — SPEC

## 1. Goal
A free public website where anyone types a research topic and sees how fast research on it is growing, who the leading experts are, which sub-topics are rising, where the research happens, where it is published, and which recent papers matter most. Every topic searched is saved in a shared, well-organised library.

Data source: OpenAlex (api.openalex.org). No AI is used anywhere: every number is a real count from OpenAlex.

## 2. Hard constraints
- **Free for everyone.** Visitors need no account, no key and pay nothing. The owner pays nothing either.
- **The owner's OpenAlex key is never in the repo or the website.** It lives only as a Cloudflare Worker secret (`OPENALEX_KEY`).
- **Website:** plain HTML, CSS and JavaScript in `site/`. No framework, no npm, no build step. Hosted on GitHub Pages (public repo).
- **Worker:** one Cloudflare Worker in `worker/`, free plan, using one KV namespace (`TMM`) for the cache and the library.
- **Daily cap:** `NEW_TOPICS_PER_DAY` defaults to 90 attempts per UTC day. Reserve an attempt before calling OpenAlex; failed source requests still count. Cached topics never count. KV counters are eventually consistent, so concurrent requests can slightly overshoot this cap.
- **English** for UI, code, comments and commits.

## 3. Architecture
```
Browser (site/ on GitHub Pages)
   │  GET /api/topic, GET /api/library
   ▼
Cloudflare Worker (worker/)  ── adds OPENALEX_KEY, caches in KV, enforces the daily cap
   │
   ▼
OpenAlex API
```
The Worker only answers requests from the site's origin (CORS allow-list in `ALLOWED_ORIGIN`, plus `http://localhost:*` for development).

## 4. Worker API

### GET /api/topic?q=<topic>&syn=<comma-separated synonyms>&parent=<topic id, optional>&subtopic=<OpenAlex topic ID, optional>&subtopicName=<display title, optional>
1. Normalise: lower-case, trim, de-duplicate terms, sort synonyms. Cache key = `topic:` + normalised query. For sub-topics, append `|primary_topic:<ID>` to the normalised parent search identity. Validate IDs as `T` followed by digits, optionally prefixed with `https://openalex.org/`. The sub-topic name is a display title, not a text search term.
2. If the key is in KV and younger than 7 days, return it (`"cached": true`). Measure age from the precise saved timestamp. Retain expired records for fallback rather than deleting them with a KV expiry.
3. Otherwise check today's UTC counter `count:<YYYY-MM-DD>`. At the cap, return the expired report if present (`"cached": true, "stale": true`), preserving its original `updated` date. Without a stored report, return HTTP 429 `{ "error": "daily_limit", "message": "Daily limit reached. Try again tomorrow or browse the Library." }`.
4. Increment and persist the counter before calling OpenAlex (Section 5). On success, build the topic JSON (Section 6), store it in KV, add or update its entry in the library index, and return it. On source failure, keep the counter increment and save no partial results.
5. If `parent` is given, record the new topic as a child of the parent in the library index. For a sub-topic, infer the parent from its normalised search terms when omitted; reject a conflicting supplied parent. Preserve children when refreshing a parent, and avoid duplicate child IDs. Sub-topic reports and index entries retain the OpenAlex ID and parent search terms.
6. On OpenAlex errors return HTTP 502 `{ "error": "source_unavailable" }`. Never return the key or the upstream URL.

### GET /api/library
Returns the library index: `[{ id, name, synonyms, field, momentum, growth, total, updated, parent, children: [ids] }]`.

Store only topic data, relationships and aggregate daily counters. Never store IP addresses or visitor identifiers.

### KV writes budget
Free plan: 1,000 writes a day. A successful new report uses at most 3 writes (counter, topic, index); a failed source attempt uses one counter write. The default cap of 90 attempts budgets at most 270 such writes. Ordinary cache hits use no writes; a missing index entry or relationship can be repaired with one index write.

## 5. OpenAlex queries for one topic
Search expression: `(term1 OR "multi word term" OR ...)` over the topic and its synonyms, used as `filter=title_and_abstract.search:<expr>`. Strip commas, pipes, brackets and quotes from user input before building it; quote terms containing spaces or hyphens. Add `api_key=<OPENALEX_KEY>`.

| # | What | Extra filter | Parameter |
|---|------|-------------|-----------|
| 1 | Papers per year | `publication_year:2010-<current year>` | `group_by=publication_year` |
| 2 | Leading experts | `from_publication_date:2020-01-01` | `group_by=authorships.author.id` (top 10) |
| 3 | Sub-topics, early period | 2020-01-01 to 2022-12-31 | `group_by=primary_topic.id` |
| 4 | Sub-topics, late period | 2023-01-01 to end of last year | `group_by=primary_topic.id` |
| 5 | Countries | since 2020 | `group_by=authorships.countries` (top 15) |
| 6 | Top journals | since 2020 | `group_by=primary_location.source.id` (top 10) |
| 7 | Most cited recent papers | `from_publication_date:2022-01-01` | `sort=cited_by_count:desc&per_page=6&select=id,display_name,publication_year,cited_by_count,doi,authorships,primary_location` |
| 8 | Suggested synonyms | since 2020 | `group_by=keywords.id` (top 15) |
| 9 | Library field | since 2020 | `group_by=primary_topic.field.id` (top 1) |

Run the calls in parallel. If one fails, fail the whole topic (no half results in the cache).

## 6. Topic JSON (what the Worker returns and caches)
```json
{
  "id": "neurotechnology|brain-computer interface|neural implant",
  "name": "neurotechnology",
  "synonyms": ["brain-computer interface", "neural implant"],
  "field": "Neuroscience",
  "updated": "2026-10-31",
  "years": [{ "year": 2010, "count": 0 }],
  "kpis": { "total": 0, "lastYear": 0, "growth5y": 0.0, "momentum": "Accelerating" },
  "headline": "Research on neurotechnology is accelerating (+X% a year). ...",
  "experts": [{ "name": "", "openalexUrl": "", "count": 0 }],
  "subtopics": [{ "name": "", "late": 0, "growth": 0.0 }],
  "countries": [{ "name": "", "code": "AE", "count": 0, "gcc": true }],
  "journals": [{ "name": "", "count": 0 }],
  "papers": [{ "title": "", "authors": "", "year": 0, "journal": "", "citations": 0, "url": "" }],
  "suggestedSynonyms": [""],
  "exploreNext": [""],
  "cached": false
}
```
Rules:
- `growth5y` = compound annual growth from (last complete year − 5) to last complete year; `null` if the start year has 0 papers.
- `momentum`: ≥ 20% Accelerating, 8–20% Growing, 0–8% Stable, < 0 Cooling, `null` growth → "Not enough data".
- Sub-topic `growth` = late / early − 1; `null` (shown as "new") if early is 0. Show the top 9 by late count.
- `gcc` true for AE, SA, QA, KW, BH, OM.
- `suggestedSynonyms` = top keywords not already in the search terms (max 6).
- `exploreNext` = the fastest-growing sub-topics with at least 20 late papers, then the largest ones (max 6), excluding the topic itself.
- `headline` is built from a template with the real numbers; no AI.

## 7. Website (site/)
Follow the approved mockup: dark top bar with "Search" and "Library", accent `#C2410C`, fonts Bricolage Grotesque (headings), Instrument Sans (text), IBM Plex Mono (numbers and labels). Works at phone width.

**Search / topic page**
- Topic field, synonyms field (comma-separated, shown as removable chips), "Measure momentum" button.
- After a search: suggested synonyms as "+ term" chips that add the term and search again.
- Four KPI cards (total, yearly growth + momentum badge, last year, fastest-growing sub-topic).
- Dark headline banner with "Copy as slide headline".
- Papers-per-year bar chart (inline SVG, current year hatched as "year to date") and "Export CSV".
- Leading experts, Sub-topics, Countries (GCC tag), Top journals, Most cited recent papers.
- "Explore next" chips: each runs a search with `parent` set to the current topic.
- Loading state while waiting; plain messages for `daily_limit` ("Daily limit reached. Try again tomorrow or browse the Library.") and `source_unavailable`.
- Footer: "Data: OpenAlex. Searches are cached anonymously to keep the tool free."

**Library page** (`#library`)
- Field sidebar with counts, search box, sort by Momentum / Name / Last updated.
- One card per top-level topic: field, momentum badge, mini growth chart, "Sub-topics explored" chips, "Updated <date> · <N> papers". Clicking opens the topic page from the cache.

The Worker URL is set once in `site/config.js` (`WORKER_URL`).

## 8. Tests
- `node --test` only, no extra packages.
- Pure functions live in `worker/lib.js` (normalise query, build search expression, growth, momentum, shaping each OpenAlex response, headline, explore-next) and are tested with saved OpenAlex responses in `worker/fixtures/`.
- Tests never call the network.

## 9. Steps (one Codex session each)
1. **Static site with sample data.** `site/` with both pages built from `site/sample-topic.json` and `site/sample-library.json` (clearly marked as sample). No network.
2. **Worker core.** `worker/lib.js` + tests with fixtures; `worker/worker.js` with `/api/topic` without KV; `wrangler.toml`; runs with `npx wrangler dev`.
3. **Cache, daily cap and library.** KV cache (7 days), daily counter, library index with parent/children, `/api/library`.
4. **Connect the site to the Worker.** Search, synonyms, suggested synonyms, explore next, error states, CSV, copy headline.
5. **Library page live.** Field sidebar, search, sort, cards from `/api/library`.
6. **Publish.** README with exact steps: create Cloudflare account, KV namespace, `wrangler secret put OPENALEX_KEY`, deploy the Worker, set `WORKER_URL` and `ALLOWED_ORIGIN`, enable GitHub Pages on `site/`.
