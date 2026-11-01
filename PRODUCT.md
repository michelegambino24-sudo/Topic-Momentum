# Topic Momentum Meter

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are strategy consultants and analysts in foresight and innovation teams, plus colleagues with whom they share the link. They are not researchers. They scan results between other tasks and need numbers they can trust and defend in front of a client.

Their main job is to decide which research topics are genuinely emerging and worth recommending as conference, webinar or event themes, and which experts could speak about them.

## Product Purpose

Turn a research-topic search into a defensible client slide or short brief: a momentum verdict, a headline backed by real counts, a growth chart, experts to consider inviting, rising sub-topics as candidate themes, and the UAE/GCC position.

The user's success target is an answer in under 10 seconds, with almost no reading. This is a product goal, not a measured performance claim. The verdict and growth chart should be understandable at a glance; the underlying evidence must be available for scrutiny.

## Positioning

A free, account-free research momentum tool combining OpenAlex publication counts, topic growth, potential speakers and regional context in one report. It supports an analyst's recommendation; it does not generate research claims using AI. No comparative market or performance claims have been established.

## Operating Context

- Users move quickly between research, client slides and short briefs. They copy a defensible headline, export yearly counts as CSV for a chart, and review expert and paper links as supporting evidence.
- Topic exploration includes synonyms, optional grouped “Must also include” alternatives, year ranges, suggested terms and sub-topics. Shared links and exploration preserve the relevant search context.
- My library is specific to the browser and stores compact report summaries locally. Users can remove their own saved cards. All topics is the shared index of default-range, unfiltered main topics and sub-topics; include variants and non-default ranges are excluded from its public response.
- UAE and GCC counts are a factual part of the decision, rather than decorative regional context. Expert counts reflect the selected range, with the documented active-since-2020 exception for open ranges starting before 2020.

## Capabilities and Constraints

[SPEC.md](SPEC.md) is the source of truth for functionality, calculations, API behavior and implementation steps. This document records durable product context; it does not override the spec or [AGENTS.md](AGENTS.md).

- Reports expose totals, yearly counts, growth and momentum, experts, sub-topics, countries, UAE/GCC counts, journals and most cited papers. Counts come from OpenAlex; illustrative sample data must remain clearly identified.
- From/To ranges combine with include alternatives. Growth uses complete years within a sufficiently long range, with five-year fallback for shorter ranges. Sub-topic comparisons and count-only cases follow the spec. Labels must explain which window a number represents.
- The website uses plain HTML, CSS and JavaScript in `site/`, with no framework, packages or build step. A plain JavaScript Cloudflare Worker and one KV namespace supply the API. GitHub Pages and free Cloudflare services are the intended hosting setup; no paid services or billing changes.
- Visitors need no account, key or payment. The OpenAlex credential belongs only in the Worker secret, never in the site, repository, documentation examples or fixtures.
- The default daily cap is 90 attempts per UTC day; failed source attempts count. Seven-day report freshness, v2 cache keys, 60-day v2 retention, saved-link rebuilding and legacy fallback follow SPEC.md. Availability and freshness must be communicated honestly.
- Keep public Library exposure separate from personal browsing history. Excluding variants from the public index is a server requirement, not merely a page filter; do not promise that cached reports are access-controlled.
- Tests run offline with `node --test` and saved fixtures. No real client or company names in sample data. The owner commits changes; the agent does not.

## Brand Commitments

The product name is Topic Momentum Meter. UI text is English. Preserve the established identity and the binding design requirements in SPEC.md Section 7.

The voice should be clear, factual and concise, suited to analysts preparing client-facing material. Errors explain what happened and what the user can do next in plain sentences. Do not introduce invented evidence, marketing claims or assurances of accuracy that the data cannot support.

## Evidence on Hand

- [SPEC.md](SPEC.md): approved product behavior, metrics and operating constraints.
- [site/index.html](site/index.html), [site/app.js](site/app.js) and [site/styles.css](site/styles.css): incumbent interface and report workflows.
- [worker/lib.js](worker/lib.js): inspectable query and metric logic; [worker/fixtures/](worker/fixtures/) contains offline test responses, not client proof or a live performance benchmark.
- [site/sample-topic.js](site/sample-topic.js): fictional, illustrative sample content.
- OpenAlex counts, expert links and paper links provide report evidence. Do not present the number of papers as proof of speaker availability, suitability, research quality or client relevance.

## Product Principles

1. Put the momentum verdict and growth chart within a quick scan; keep supporting detail available when needed.
2. Make conclusions defensible: preserve source links, explicit date windows, accurate labels and freshness information.
3. Help users produce a client-ready recommendation, chart and expert shortlist without repetitive data gathering.
4. Preserve search context across exploration, saved reports and sharing, while respecting the distinction between My library and the public index.
5. Keep access free and friction low within the documented cost, cache and daily-limit constraints.

## Accessibility & Inclusion

The site must work at phone width. Preserve keyboard access, associated input labels, visible focus, the skip link and meaningful status/error messages already supported by the interface. Provide information in text as well as charts and color. No particular accessibility certification or conformance level has been confirmed.
