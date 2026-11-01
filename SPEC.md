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

Default range (2010, no To) preserves existing cache identities. Other open ranges append `|since:<from>`; bounded ranges append `|range:<from>-<to>`. Range identity follows the include group and precedes the sub-topic ID. An explicit current-year To is distinct from an open range. Non-default ranges are Library variants of the default unfiltered identity. Sub-topics inherit the parent's exact range and include group. Forms, synonyms, Explore next, back links, cache-only links, history and restored reports retain both years. Shared cache freshness, daily cap and write budget remain unchanged. Version 3 report keys force a rebuild on the next search. Legacy saved reports are available only as a fallback when the daily cap prevents a rebuild.

Optional `include` terms are normalised, deduplicated and sorted. Search titles and abstracts with `(topic OR synonyms) AND (include term OR include term ...)`. Each multiword term is a phrase. An empty include group preserves existing behavior and cache identities. Non-empty groups append `|include:<JSON array of sorted terms>` before any sub-topic ID in the cache identity. Limit raw include input to 1,200 characters and retain the 512-byte cache-key limit. Every aggregate and paper query uses the combined expression.

Suggested synonyms exclude terms already present in the topic, synonyms, or include alternatives (case-insensitive, including a complete term within a longer phrase). Apply label and suggestion fixes to saved reports on read without additional KV writes or source requests.

Filtered reports carry `includeTerms` and `searchTerms` (main name, synonyms, includeTerms). Their title and headline show `main topic + term / term` (no parentheses); the exact Children 0–9 quick-fill term set displays as `main topic + Children 0–9`. A filtered report is a Library variant whose parent is the unfiltered search identity; its index entry retains the search terms and `variant: true`. Variants remain individually saved reports, grouped beneath their parent topic in this browser’s My library, even when the main report has not been saved. Filtered sub-topics inherit the include group and use the filtered parent identity. Saved links, browser history, restored forms, suggested synonyms and exploration retain the include terms. Cache-only links remain read-only. Existing reports remain valid. Daily cap, cache freshness and write budget remain unchanged. Legacy v1 fallback reports retain their saved data and dates; section labels keep their original aggregate windows.
1. Normalise: lower-case, trim, de-duplicate terms, sort synonyms. Report cache key = `v3:topic:` + normalised query. Versioning changes only KV report keys: report IDs, Library relationships, index keys and daily counter keys stay unchanged. Old v1 records use `topic:<id>` and are never rewritten or deleted. For sub-topics, append `|primary_topic:<ID>` to the normalised parent search identity. Validate IDs as `T` followed by digits, optionally prefixed with `https://openalex.org/`. The sub-topic name is a display title, not a text search term.
2. If the key is in KV and younger than 7 days, return it (`"cached": true`). Measure age from the precise saved timestamp. Write every v2 report with `expirationTtl: 5184000` (60 days). Keep the precise 7-day freshness window; expired v2 records can be served stale until KV deletes them. Refreshes reset the 60-day expiry; cache hits do not extend it. Leave v1 records and their expiry settings untouched.
3. Otherwise check today's UTC counter `count:<YYYY-MM-DD>`. At the cap, return the expired report if present (`"cached": true, "stale": true`), preserving its original `updated` date. If there is no v2 report, check the matching v1 `topic:<id>` record and return it with `cached: true, stale: true`, preserving its original `updated` date. This fallback performs no writes or OpenAlex calls. Without either report, return HTTP 429 `{ "error": "daily_limit", "message": "Daily limit reached. Try again tomorrow or browse the Library." }`.
4. Increment and persist the counter before calling OpenAlex (Section 5). On success, build the topic JSON (Section 6), store it in KV, add or update its entry in the library index, and return it. On source failure, keep the counter increment and save no partial results.
5. If `parent` is given, record the new topic as a child of the parent in the library index. For a sub-topic, infer the parent from its normalised search terms when omitted; reject a conflicting supplied parent. Preserve children when refreshing a parent, and avoid duplicate child IDs. Sub-topic reports and index entries retain the OpenAlex ID and parent search terms.
6. On OpenAlex errors return HTTP 502 `{ "error": "source_unavailable" }`. Never return the key or the upstream URL.

Library report links add `cache=only`. If a matching v3 report exists, return it even when stale, preserving its original date; this read does not call OpenAlex, inspect the daily counter or write KV. If v3 is missing (including after its 60-day expiry), automatically run the ordinary search flow: reserve an attempt under the daily cap, rebuild the report, write it with the 60-day expiry, and update its Library entry. At the cap, check matching v2 data, then v1 data; otherwise return the ordinary daily-limit error. Source failures count as attempts and leave old records untouched. Do not silently fall back to old versions on source or configuration errors. The browser sends one saved-report request; the Worker handles rebuilding and fallback.


### GET /api/library
Returns the library index: `[{ id, name, synonyms, field, momentum, growth, total, updated, parent, children: [ids], spark: [counts] }]`. The public response excludes all reports with a "Must also include" group or a non-default range, including their sub-topics, and removes references to their IDs from child lists. This is a response-only projection: the shared KV index and report cache remain unchanged. Each saved report adds a `spark` array for complete years inside its selected range, oldest first, with `from`, `to`, `sparkStartYear`, `growthLabel` and `growthStartCount`. Missing years have zero counts; the current partial year is excluded. Older ten-year arrays and entries without `spark` remain readable without fabricated data.

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

Ordinary searches may launch the eleven calls in parallel. Searches with more than five Boolean operators use shared conservative pacing and bounded 429 retries as specified below. If one fails, fail the whole topic (no half results in the cache).

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
  "headline": "Since 2010, research on neurotechnology has been accelerating (+X% a year). ...",
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
- `years` retains min(2010, From, lastComplete − 5) through the current year. Total papers sums only years From through To/current year, inclusive. The main chart and CSV display only that range.
- Titles append ` · since <From>` for open ranges or ` · <From>–<To>` for bounded ranges, after any include label. Headlines begin `Since <From>, research on ... has been ...` or `From <From> to <To>, research on ... was ...`; then give the last-year paper count and, when applicable, GCC/UAE counts with the regional range. Lowercase common topic words, preserving supplied acronyms and recognised proper names. Keep the original search name in `searchTerms`; optional `headlineName` preserves user-supplied casing independently of cache identity. Presentation of cached reports uses the same sentence template without changing their figures.
- Complete years are From through min(To/current year, current year − 1), inclusive. The current partial year never enters growth or sub-topic comparisons.
- `growth5y` is the five-year CAGR ending at the range’s last complete year: lastComplete − 5 through lastComplete. For open ranges this remains current year − 6 through current year − 1. It is null if the baseline has zero papers.
- With at least 3 complete years, `kpis.growth` is CAGR between the first and last complete year in the selected range: (last / first)^(1 / (last year − first year)) − 1. Label it `Growth <first>–<last>`. A zero baseline gives null; do not substitute fallback growth for that case.
- With fewer than 3 complete years, `kpis.growth` equals `growth5y` and `growthLabel` is "5-year growth". Momentum, headlines, Library summaries and sorting use the displayed growth.
- Growth displays New topic instead of a percentage when the first year of the actual growth window has fewer than 20 papers (including zero) OR less than 2% of the final complete year’s count. Apply this to reports, headlines and Library rows without changing numeric CAGR, momentum thresholds or sorting. Show the endpoint counts beneath the KPI (for example, 12 papers in 2020 → 2,571 in 2025). New-topic headlines use Research on <topic context> is a new topic: from <N> papers in <first year> to <M> in <last year>, followed by the conditional GCC sentence; use singular paper for one. Summaries retain growthStartYear, growthEndYear, growthStartCount and growthEndCount, including endpoints outside a short selected range. Legacy summaries use available saved year counts only; do not invent missing baselines.
- `momentum`: ≥ 20% Accelerating, 8–20% Growing, 0–8% Stable, < 0 Cooling, null → "Not enough data".
- The papers KPI and headline use the last complete year inside the range. For a current-year-only range, show current-year counts labelled as year to date.
- Split complete years into a first half of floor(N/2) years and a second half containing the rest; an odd extra year belongs to the second half. Sub-topic growth is second-half count / first-half count − 1, null if the baseline is zero. Retain the earlier-half count as early; display earlier → later counts rather than a percentage whenever early is below 20. For older cached rows, infer early from late/(1+growth) only where possible. Display the compared years explicitly. Rank the top 9 by second-half count.
- With fewer than 2 complete years, count sub-topic papers throughout the selected range, rank by count, set growth to null, and show no percentage or "new" label. Explore next ranks by counts in that case.
- `gcc` true for AE, SA, QA, KW, BH, OM.
- `suggestedSynonyms` = top keywords not already in the search terms (max 6).
- `exploreNext` = the fastest-growing sub-topics with at least 20 late papers, then the largest ones (max 6), excluding the topic itself.
- `headline` is built from a template with the real numbers; no AI.

## 7. Website (site/)
The presentation follows DESIGN.md and the approved analytics redesign. Keep the Topic Momentum Meter name as a plain wordmark, with Search and Library navigation. Use plain HTML, CSS and JavaScript; no dependencies or build step. Keep report data, API requests, calculations, cache identities and saved navigation behavior unchanged by presentation work.

**Visual system**
- One system font family, weights 400 and 600, tabular numbers. No external/display fonts, eyebrow labels, decorative arrows, symbols or emoji. Use sentence-case titles and labels.
- Page `#F4F6F1`, cards `#FFFFFF`, borders/dividers `#D3D8CF`, chart line/area `#7E8B63` (area at low opacity), actions/links/active momentum `#5F6B47`, main text `#1F2A1C`, secondary `#5E6859`, positive `#4A5538`, negative `#B5483C`. Never use chart green as text. Secondary and placeholder text must meet at least 4.5:1 against white.
- The compact top bar uses `#5F6B47`, white wordmark/navigation and a white active-tab underline.
- Use aligned rows, restrained borders and thin dividers. Layouts must work at phone width, preserve visible keyboard focus and keep tooltip content within the viewport.

**Search and report**
- Show only the topic input and Measure momentum by default, with a collapsible More options panel. Open it automatically for a restored or set synonym/include group, non-default From, or any To. Users can collapse it manually. Invalid hidden year inputs reopen the panel.
- More options retains synonyms and removable chips, suggested synonyms, Must also include, Children 0–9, From/To and quick-fill buttons 2010/2020/2023/2024/2025. Preserve validation and filter semantics. Children 0–9 fills exactly `children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood` without submitting. Place the explanations and participant-age caveat in question-mark help.
- Header: large topic title, only field and range below; Export CSV and Save to My library on the right. Retain automatic browser saving and make explicit saving idempotent; show a filled Saved state with a check mark when already saved. Samples are not saved as real reports. Keep the parent link for exploration.
- Main card: Papers, Growth and Papers in the relevant year, each with question-mark help. Help uses the approved plain copy with natural period phrases (since YYYY or between YYYY and YYYY), the five-year fallback and current-year-only exception. Keep original values and CSV content. Sub-topic quantities remain in the topic table rather than a fourth metric card.
- Replace bars with a line chart and low-opacity area under complete years. Use light dashed gridlines and few axis labels; preserve exact counts at points and in CSV. Draw the segment to the current year dashed with a lighter point and a tooltip explicitly saying year to date. Do not fill that partial segment as if it were complete. A bounded range ending before the current year has no partial segment.
- First supporting row: Momentum, Leading experts and Countries. Each has a plain title and thin divider. Momentum shows the Accelerating/Growing/Stable/Cooling scale, active segment filled, then the headline and Copy. If growth is unavailable, no segment is active and the state says Not enough data.
- Experts, countries, journals and papers show the first 5 records, with Show all/Show less expanding in place. Preserve every record and source link. Put the active-since-2020 expert exception and country aggregation window in help. Keep thin country bars and the UAE/GCC totals line.
- Second supporting row: Top journals and Most cited papers, retaining all names, counts, authors, years, citations and source links. Each paper has its title and right-aligned citations on the first line, then muted comma-separated authors, journal and year. Supporting cards follow their own content height and align to the top.
- Sub-topics uses a two-column arrangement of uniform rows with name, paper count and growth from the current report only. Null-growth new/count-only rows remain valid; exploration-only entries without measurements are omitted and remain accessible in the Library. Do not emphasize previously visited rows. Preserve range/include inheritance and parent navigation. Suggested terms remain in More options. Reflow to one column on phones.
- Question-mark help supports hover, keyboard focus, click/tap and Escape, with associated accessible descriptions. Move explanatory dot-separated copy into help. Source/sample notes and the saved report date appear once in the footer; stale status remains explicit. Remove notice banners.
- Preserve loading, disabled, empty and plain actionable error states. CSV exports only displayed years, with sample_data, range, year, papers columns. Copy uses the displayed headline and retains sample identification.

**Library**
- Keep My library (default), All topics, field filter with counts, search, sort and retry. No large library introduction/heading.
- Use compact aligned rows (about 56px for two short lines) for name/field, sparkline and growth. No question mark beside row fields. Preserve momentum, update date, total and range in the linked row’s title. Render only the saved entry’s range in its sparkline; clip legacy ten-year series using their saved year. Never fabricate a sparkline for missing data. Add a small 5y suffix when growth uses the five-year fallback, including ranges with fewer than three complete years.
- My library stores compact browser summaries (id, name, parent, field, momentum, growth, total, spark, updated, from, to, sparkStartYear, growthLabel, growthStartCount, growthEndCount, growthStartYear, growthEndYear). Group sub-topics, range versions and Must also include variants beneath their parent, indented; retain individual report links and removal. When a parent is absent, show a non-report parent heading marked Parent topic not saved. Counters show topics, sub-topics and saved versions, never report totals or placeholder headings. Remove is small and muted, revealed on desktop row hover or keyboard focus and always visible on touch. Empty text stays Your library is empty. Search a topic and it will appear here.
- All topics keeps main topics and their navigable sub-topics, excluding include variants/non-default ranges and their children from the public response. Preserve parent/child relationships through indented grouped rows.
- Browsing makes one request to /api/library; filters, sort and sparklines use that response locally. Saved links retain cache=only: existing v3 reports open without source requests; missing v3 reports rebuild under the daily cap with v2 then v1 fallback at the cap.

The Worker URL remains set in site/config.js (WORKER_URL).

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

9. **Analytics presentation redesign.** Compact progressive search, system typography and green palette, three metrics with line/area chart, supporting evidence cards, unified sub-topic and Library rows, accessible help and in-place expansion. Preserve all report data and Worker behavior.

### Source quality and proofreading
- Experts and journals initially add primary_location.source.is_core:true (OpenAlex’s CWTS/Leiden core list). Retain all existing date, article/review and repository/journal filters. Other queries and counts are unchanged.
- If a shaped core list has fewer than five records, request that list again without is_core; do not merge it with the core result. Experts and journals decide independently. Eleven initial parallel requests, plus zero to two parallel fallback requests; one daily reservation and the existing KV write budget. All requests retain the same timeout, redirect handling and sanitised errors.
- Reports save sourceQuality flags per list. Fallback lists show Includes non-core sources; core-only tooltip claims appear only for a core list. Old reports without flags retain their saved counts and show the inclusive note. Existing cache freshness/retention are unchanged.
- All-capital journal names display in normal title case, preserving known acronyms and already mixed-case names. Apply to the journal list and cited-paper journal metadata, including cached browser reports.
- COPY.md lists sentence templates and filled examples. worker/fixtures/copy-catalogue.json freezes exact headline and fixed UI copy; tests protect the text and semantic variants.

### Approved copy and cache version 3
- Visible percentages use whole numbers at magnitudes of 10% or more, one decimal below 10%, plus signs for non-negative values and the mathematical minus sign for negative values. Fallback headlines name the actual complete-year window: +30% a year over 2020–2025.
- Publication sentences begin In <year>, <N> papers were published (singular paper was). GCC sentences use papers published since <year> come from for open ranges, and papers published between <From> and <To> came from for bounded ranges.
- Visible dates use 1 Nov 2026 format. Current report metadata uses Updated <date>. Old child reports use Saved on <date>, may be out of date. Part of <parent>. Library metadata uses Growing, 2,571 papers since 2020. Updated 1 Nov 2026.
- Display titles have an initial capital and no period suffix or middle dot. Field and period appear in the subtitle. Internal report identities and range metadata remain unchanged. Library counters use topic, sub-topic and saved version.
- Growth, New topic, chart and core-expert help use the exact approved text in COPY.md. New topic has its own tooltip in addition to growth help.
- Published connection errors suggest checking the connection; local development retains Start the Worker. All topics empty: No shared topics yet. Copy fallback and year-validation messages match COPY.md. Footer: Data from OpenAlex. Searches are cached anonymously to keep the tool free.
- Current keys are v3:topic:<id>. Missing v3 reports rebuild under the daily cap for normal searches and cache-only saved links. When capped, prefer an existing v3 report, otherwise check v2:topic:<id> then topic:<id>. Return the first matching report as cached/stale without rewriting old records. Retain seven-day freshness and 60-day TTL for new writes.

### Anchored historical fallbacks and final copy
- Bounded fallbacks end at min(To, report year − 1), with a baseline five years earlier. Thus 2018–2019 uses 2014–2019 and 2012–2013 uses 2008–2013. Fetch the entire yearly series back to min(2010, From, fallback baseline) in the existing single yearly query. Aggregate totals, chart, expert/source windows and other range filters are unchanged.
- Keep v3. Recompute bounded growth5y from saved yearly counts whenever opening a report, including local restoration and cache-only reads. For fewer than three complete range years, update displayed growth, momentum, headline, endpoints and summaries consistently. Existing range CAGR remains unchanged for longer ranges. Never fabricate a missing endpoint.
- Missing historical endpoints mark growthNeedsRebuild and bypass an otherwise fresh/cache-only hit for a normal capped rebuild. At the cap, retain the report with unavailable growth rather than the old percentage. Do not rewrite old cached report records during an offline correction; browser summaries update when the report is opened.
- Exact copy: Only journals on the Leiden Ranking core list are counted. My library uses Search for a topic. Stable is 0 to 8%. Back to <Topic> capitalises the first letter and retains acronyms as typed. COPY.md and exact-copy fixtures document the complete sentences.

### Sub-topic tiny-base counts
- Replace the sub-topic New label with formatted earlier-half → later-half counts (for example, 2 → 320). Keep the Papers column, row navigation, growth calculation and shared cache unchanged. Zero baselines show 0 → later; older cached null growth represents an earlier count of zero, while finite legacy growth allows reconstructing the earlier count.
- Do not add question-mark controls per row. Append the exact arrow explanation from COPY.md to the Sub-topics card tooltip only when at least one displayed row uses counts. Count-only ranges display neither growth nor arrow counts and omit that explanation. Use explicit earlier/later paper counts for the arrow cell’s accessible label.

### Complex search pacing and natural headline contexts
- Reproduction in ENVIRONMENT=dev established that six or more operators trigger OpenAlex’s five-request-per-second broad-search limit; the previous eleven-call burst caused 429s. Keep the full nine-term Children preset because child does not cover all children/childhood matches. Search semantics, IDs and source counts remain unchanged.
- Count normalized query synonyms plus include alternatives to measure structural Boolean joins. Above five, show This search is more complex, so it takes a little longer…; otherwise retain Loading research data….
- Share a 400ms request-start gate across concurrent searches within one Worker instance while complex searches are active, including core-source fallbacks and retries. Cloudflare isolates do not share this memory: conservative pacing plus upstream Retry-After handling mitigates cross-instance contention, without adding a paid/shared coordination service.
- Each query has at most two retries, only for 429s with cooldowns no longer than 1.5 seconds. Honor Retry-After; propagate longer cooldowns without retrying early. Enforce a hard maximum of 30 OpenAlex calls per search including all retries and fallbacks, leaving room below the 50-subrequest ceiling for KV operations. Preserve the 20-second search timeout, daily reservation and existing three-write budget. Abort queued starts after terminal failure.
- Exhausted broad-search rate limits, request-length failures and recognized complexity errors use: This search has too many terms. Remove some synonyms or additional terms and try again. Do not expose keys, request URLs or upstream bodies; development diagnostics remain sanitized.
- Headline topics use lowercase common words while preserving supplied acronyms and recognised proper nouns. The Children preset uses <topic> in children; custom include terms use <topic> mentioning <term> or <term>. New-topic sentences begin Research on <topic context> is a new topic. Library and restored titles use the same presentation rules.
- For zero UAE counts, the conditional GCC sentence ends , none from the UAE. Other regional thresholds and counts are unchanged.
- Sub-topic rows show earlier → later counts when the earlier half is below 20 OR growth is strictly greater than 300%; update the conditional card-tooltip explanation to cover both reasons. Exactly 300% retains its percentage when the baseline is at least 20.
