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

### GET /api/topic?q=<topic>&syn=<comma-separated synonyms>&include=<comma-separated alternatives, optional>&from=<year, optional>&to=<year, optional>&parent=<topic id, optional>&subtopic=<OpenAlex topic ID, optional>&subtopicName=<display title, optional>

Optional `from` defaults to 2010; optional `to` is empty/null for until today. Validate whole four-digit years from 2000 to the current UTC year, with From ≤ To. Reject invalid values with HTTP 400 and a plain sentence explaining what to change. The site validates before requesting data. Legacy `period` links remain supported as an alias for From when `from` is absent.

Default range (2010, no To) preserves existing cache identities. Other open ranges append `|since:<from>`; bounded ranges append `|range:<from>-<to>`. Range identity follows the include group and precedes the sub-topic ID. An explicit current-year To is distinct from an open range. Non-default ranges are Library variants of the default unfiltered identity. Sub-topics inherit the parent's exact range and include group. Forms, synonyms, Explore next, back links, cache-only links, history and restored reports retain both years. Shared cache freshness, daily cap and write budget remain unchanged. Version 2 report keys force a rebuild on the next search. Legacy saved reports are available only as a fallback when the daily cap prevents a rebuild.

Optional `include` terms are normalised, deduplicated and sorted. Search titles and abstracts with `(topic OR synonyms) AND (include term OR include term ...)`. Each multiword term is a phrase. An empty include group preserves existing behavior and cache identities. Non-empty groups append `|include:<JSON array of sorted terms>` before any sub-topic ID in the cache identity. Limit raw include input to 1,200 characters and retain the 512-byte cache-key limit. Every aggregate and paper query uses the combined expression.

Suggested synonyms exclude terms already present in the topic, synonyms, or include alternatives (case-insensitive, including a complete term within a longer phrase). Apply label and suggestion fixes to saved reports on read without additional KV writes or source requests.

Filtered reports carry `includeTerms` and `searchTerms` (main name, synonyms, includeTerms). Their title and headline show `main topic + term / term` (no parentheses); the exact Children 0–9 quick-fill term set displays as `main topic + Children 0–9`. A filtered report is a Library variant whose parent is the unfiltered search identity; its index entry retains the search terms and `variant: true`. Variants appear as independent cards in this browser’s My library, even when the main report has not been saved. Filtered sub-topics inherit the include group and use the filtered parent identity. Saved links, browser history, restored forms, suggested synonyms and exploration retain the include terms. Cache-only links remain read-only. Existing reports remain valid. Daily cap, cache freshness and write budget remain unchanged. Legacy v1 fallback reports retain their saved data and dates; section labels keep their original aggregate windows.
1. Normalise: lower-case, trim, de-duplicate terms, sort synonyms. Report cache key = `v2:topic:` + normalised query. Versioning changes only KV report keys: report IDs, Library relationships, index keys and daily counter keys stay unchanged. Old v1 records use `topic:<id>` and are never rewritten or deleted. For sub-topics, append `|primary_topic:<ID>` to the normalised parent search identity. Validate IDs as `T` followed by digits, optionally prefixed with `https://openalex.org/`. The sub-topic name is a display title, not a text search term.
2. If the key is in KV and younger than 7 days, return it (`"cached": true`). Measure age from the precise saved timestamp. Write every v2 report with `expirationTtl: 5184000` (60 days). Keep the precise 7-day freshness window; expired v2 records can be served stale until KV deletes them. Refreshes reset the 60-day expiry; cache hits do not extend it. Leave v1 records and their expiry settings untouched.
3. Otherwise check today's UTC counter `count:<YYYY-MM-DD>`. At the cap, return the expired report if present (`"cached": true, "stale": true`), preserving its original `updated` date. If there is no v2 report, check the matching v1 `topic:<id>` record and return it with `cached: true, stale: true`, preserving its original `updated` date. This fallback performs no writes or OpenAlex calls. Without either report, return HTTP 429 `{ "error": "daily_limit", "message": "Daily limit reached. Try again tomorrow or browse the Library." }`.
4. Increment and persist the counter before calling OpenAlex (Section 5). On success, build the topic JSON (Section 6), store it in KV, add or update its entry in the library index, and return it. On source failure, keep the counter increment and save no partial results.
5. If `parent` is given, record the new topic as a child of the parent in the library index. For a sub-topic, infer the parent from its normalised search terms when omitted; reject a conflicting supplied parent. Preserve children when refreshing a parent, and avoid duplicate child IDs. Sub-topic reports and index entries retain the OpenAlex ID and parent search terms.
6. On OpenAlex errors return HTTP 502 `{ "error": "source_unavailable" }`. Never return the key or the upstream URL.

Library report links add `cache=only`. If a matching v2 report exists, return it even when stale, preserving its original date; this read does not call OpenAlex, inspect the daily counter or write KV. If v2 is missing (including after its 60-day expiry), automatically run the ordinary search flow: reserve an attempt under the daily cap, rebuild the report, write it with the 60-day expiry, and update its Library entry. At the cap, return matching v1 data if available; otherwise return the ordinary daily-limit error. Source failures count as attempts and leave v1 untouched. Do not silently fall back to v1 on source or configuration errors. The browser sends one saved-report request; the Worker handles rebuilding and fallback.


### GET /api/library
Returns the library index: `[{ id, name, synonyms, field, momentum, growth, total, updated, parent, children: [ids], spark: [counts] }]`. The public response excludes all reports with a "Must also include" group or a non-default range, including their sub-topics, and removes references to their IDs from child lists. This is a response-only projection: the shared KV index and report cache remain unchanged. Each saved report adds a compact `spark` array containing paper counts for the last 10 complete years, oldest first, relative to the report's `updated` year. Missing years have zero counts; the current partial year is excluded. Older entries without `spark` remain valid.

Store only topic data, relationships and aggregate daily counters. Never store IP addresses or visitor identifiers.

### KV writes budget
Free plan: 1,000 writes a day. A successful new report uses at most 3 writes (counter, topic, index); a failed source attempt uses one counter write. The default cap of 90 attempts budgets at most 270 such writes. Ordinary cache hits use no writes; a missing index entry or relationship can be repaired with one index write.

## 5. OpenAlex queries for one topic
Search expression: `(term1 OR "multi word term" OR ...)` over the topic and its synonyms, used as `filter=title_and_abstract.search:<expr>`. Strip commas, pipes, brackets and quotes from user input before building it; quote terms containing spaces or hyphens. Add `api_key=<OPENALEX_KEY>`.

| # | What | Extra filter | Parameter |
|---|------|-------------|-----------|
| 1 | Papers per year (one query) | `publication_year:<min(2010, From)>-<current year>` | `group_by=publication_year` |
| 2 | Leading experts | selected range; if From < 2020 and To is empty, count from 2020 | `group_by=authorships.author.id` (top 10) |
| 3 | Sub-topics, first half | first half of complete years in the range; with fewer than 2 complete years, selected range (growth unused) | `group_by=primary_topic.id` |
| 4 | Sub-topics, second half | second half of complete years in the range; with fewer than 2 complete years, selected range including year to date | `group_by=primary_topic.id` |
| 5 | Countries | selected range | `group_by=authorships.countries` (top 15) |
| 6 | Top journals | selected range | `group_by=primary_location.source.id` (top 10) |
| 7 | Most cited papers | selected range | `sort=cited_by_count:desc&per_page=6&select=id,display_name,publication_year,cited_by_count,doi,authorships,primary_location` |
| 8 | Suggested synonyms | since 2020 | `group_by=keywords.id` (top 15) |
| 9 | Library field | since 2020 | `group_by=primary_topic.field.id` (top 1) |

A selected range uses `from_publication_date:<From>-01-01` and, when To is set, `to_publication_date:<To>-12-31`. Query 1 always includes 2010 through the current year for fallback calculations; extend the same query earlier when From < 2010.

UAE and GCC totals each use a separate count query with the selected range and the same search expression (GCC uses an OR of the six country codes, counting each paper once). Keywords and Library field keep their since-2020 window. Experts retain their article/review and repository exclusions; journals and cited papers retain their article/review restrictions.

Run the eleven calls in parallel. If one fails, fail the whole topic (no half results in the cache).

## 6. Topic JSON (what the Worker returns and caches)
```json
{
  "id": "neurotechnology|brain-computer interface|neural implant",
  "name": "neurotechnology · since 2010",
  "synonyms": ["brain-computer interface", "neural implant"],
  "from": 2010,
  "to": null,
  "subtopicWindow": { "countsOnly": false, "from": 2010, "split": 2018, "end": 2025 },
  "searchTerms": { "name": "neurotechnology", "synonyms": ["brain-computer interface", "neural implant"] },
  "field": "Neuroscience",
  "updated": "2026-10-31",
  "years": [{ "year": 2010, "count": 0 }],
  "kpis": { "total": 0, "lastYear": 0, "growth5y": 0.0, "growth": 0.0, "growthLabel": "Growth 2010–2025", "momentum": "Accelerating" },
  "headline": "Research on neurotechnology · since 2010 is accelerating (+X% a year). ...",
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
- `years` retains min(2010, From) through the current year. Total papers sums only years From through To/current year, inclusive. The main chart and CSV display only that range.
- Titles and headlines append ` · since <From>` for open ranges or ` · <From>–<To>` for bounded ranges, after any include label. Keep the original search name in `searchTerms`.
- Complete years are From through min(To/current year, current year − 1), inclusive. The current partial year never enters growth or sub-topic comparisons.
- `growth5y` remains the five-year CAGR from current year − 6 to current year − 1. It is null if the baseline has zero papers.
- With at least 3 complete years, `kpis.growth` is CAGR between the first and last complete year in the selected range: (last / first)^(1 / (last year − first year)) − 1. Label it `Growth <first>–<last>`. A zero baseline gives null; do not substitute fallback growth for that case.
- With fewer than 3 complete years, `kpis.growth` equals `growth5y` and `growthLabel` is "5-year growth". Momentum, headlines, Library summaries and sorting use the displayed growth.
- `momentum`: ≥ 20% Accelerating, 8–20% Growing, 0–8% Stable, < 0 Cooling, null → "Not enough data".
- The papers KPI and headline use the last complete year inside the range. For a current-year-only range, show current-year counts labelled as year to date.
- Split complete years into a first half of floor(N/2) years and a second half containing the rest; an odd extra year belongs to the second half. Sub-topic growth is second-half count / first-half count − 1, null ("new") if the baseline is zero. Display the compared years explicitly. Rank the top 9 by second-half count.
- With fewer than 2 complete years, count sub-topic papers throughout the selected range, rank by count, set growth to null, and show no percentage or "new" label. Explore next ranks by counts in that case.
- `gcc` true for AE, SA, QA, KW, BH, OM.
- `suggestedSynonyms` = top keywords not already in the search terms (max 6).
- `exploreNext` = the fastest-growing sub-topics with at least 20 late papers, then the largest ones (max 6), excluding the topic itself.
- `headline` is built from a template with the real numbers; no AI.

## 7. Website (site/)
Follow the approved mockup: dark top bar with "Search" and "Library", accent `#C2410C`, fonts Bricolage Grotesque (headings), Instrument Sans (text), IBM Plex Mono (numbers and labels). Works at phone width.

**Search / topic page**
- From (required, default 2010) and To (optional, empty means until today) year inputs next to the search. Quick-fill buttons **2010, 2020, 2023, 2024, 2025** set From and clear To without submitting. Allow years 2000 through the current year and require From ≤ To, using plain error messages.
- The range applies to totals, chart, experts, countries, UAE/GCC, journals and most cited papers. Experts use only papers inside the range; if From < 2020 and To is empty, count from 2020 and head the section "Active since 2020". All section labels reflect the actual query window.
- Topic field, synonyms field (comma-separated, shown as removable chips), optional "Must also include" field (comma-separated alternatives), "Measure momentum" button. Explain that at least one additional term is required alongside the topic or a synonym. A "Children 0–9" chip fills exactly: `children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood`. It fills the field without submitting; explain that participant ages must be verified in the papers.
- After a search: suggested synonyms as "+ term" chips that add the term and search again.
- Four KPI cards (total, displayed growth + momentum badge, latest complete year in range, fastest-growing sub-topic (largest by count when comparisons are unavailable)).
- Dark headline banner with "Copy as slide headline".
- Papers-per-year bar chart (inline SVG, current year hatched as "year to date") and "Export CSV". CSV has sample_data, range (Since YYYY or YYYY–YYYY), year, papers columns and only displayed years.
- Leading experts, Sub-topics, Countries (GCC tag), Top journals, Most cited papers.
- "Explore next" chips: each runs a search with `parent` set to the current topic.
- Loading state while waiting; plain messages for `daily_limit` ("Daily limit reached. Try again tomorrow or browse the Library.") and `source_unavailable`.
- Footer: "Data: OpenAlex. Searches are cached anonymously to keep the tool free."

**Library page** (`#library`)
- Two tabs: "My library" (default) and "All topics". Both have a field sidebar with counts, search box, and sort by Momentum / Name / Last updated.
- My library stores a compact summary for every successfully searched or opened report in localStorage: id, name, parent, field, momentum, growth, total, spark, updated. Main topics, sub-topics, include variants and range variants are independent cards. The range is encoded in the identity so summaries remain compact. Removal only deletes the local summary. A new browser shows "Your library is empty. Search a topic and it will appear here." Reloading a removed last report does not silently restore its summary; opening it again adds it back.
- All topics uses the public `/api/library` response and never displays include variants, non-default ranges or their sub-topics.
- All topics has one card per top-level topic: field, momentum badge, mini growth chart, "Sub-topics explored" chips, "Updated <date> · <N> papers". Clicking opens the saved report, rebuilding it automatically if v2 is missing.
- Browsing makes one request to `/api/library`; filtering, sorting and mini charts use this response locally. Draw charts from `spark` only, and omit them for older entries without it. My library cards use their stored identity to reconstruct cache-only report requests. Card and child-chip links use `cache=only`, including reloads and browser history, so existing v2 reports open without a new search; missing v2 reports rebuild automatically under the daily cap, with v1 fallback at the cap.

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
7. **Filtered topic variants.** Add the grouped "Must also include" search, Children 0–9 quick-fill, explicit combined labels, Library variants and offline coverage for identities, queries, navigation and storage.

8. **Year ranges.** Replace fixed periods with From/To and five quick-fill years. Apply range windows, range CAGR with five-year fallback, complete-year sub-topic halves, range inheritance, combined cache identities, private Library variants, titles, CSV and offline tests.
