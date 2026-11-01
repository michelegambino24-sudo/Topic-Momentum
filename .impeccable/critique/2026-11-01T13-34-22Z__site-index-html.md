---
target: site report page and library
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\miche\\Desktop\\Topic-Momentum\\site\\index.html"
target_fingerprint: "sha256:a5db83a996a316bd891d37e578f6d432da4fbea5eb6821073d7fd63731676f7f"
target_path: "C:\\Users\\miche\\Desktop\\Topic-Momentum\\site\\index.html"
timestamp: 2026-11-01T13-34-22Z
slug: site-index-html
closed: true
---
⚠️ DEGRADED: single-context (sub-agents declined by user)

Target: site/index.html, site/styles.css and site/app.js; report and Library. Evidence: supplied current-site screenshots 1–2 and UX references 3–5. No live browser inspection claimed.

Design specificity: The research content is specific and useful, but its presentation is an editorial stack rather than a focused analytics workspace. The biggest opportunity is to make the verdict, quantities and trajectory readable together.

Design health (provisional source/screenshot assessment): 24/40, Acceptable.

| Heuristic | Score /4 | Main observation |
|---|---:|---|
| System status | 3 | Loading, errors and saved-data status exist; status copy occupies persistent space. |
| Match to real world | 3 | Research terms are clear; metric explanations require scanning. |
| User control | 3 | Filters, navigation and personal removal exist; saving is implicit. |
| Consistency | 2 | Multiple type systems and panel treatments compete. |
| Error prevention | 3 | Year validation and labelled controls exist. |
| Recognition | 2 | Growth context and actions are dispersed. |
| Efficiency | 2 | Report evidence is below a large search block; Library is difficult to compare. |
| Minimalism | 1 | Repeated eyebrow labels, arrows and explanatory prose add noise. |
| Error recovery | 3 | Plain messages and retry preserve a path forward. |
| Contextual help | 2 | Explanations are present but lack concise on-demand metric help. |

Ranked findings:
1. P1: The search and introductory area displaces the evidence. In screenshot 1 the report title only appears near the bottom; no main metrics or chart are visible. Compress the search workspace and put three metrics with the chart immediately after the topic heading. Use distill/layout.
2. P1: The verdict, numbers, headline and chart are separate islands. The fourth KPI also mixes a sub-topic name with numeric quantities. Group the three numbers with the line chart, and place Momentum alongside experts and countries. Preserve fastest-sub-topic information in the unified topic table. Use distill/layout.
3. P2: Library cards make comparison expensive. renderLibrary builds large standalone cards; name, growth and spark do not share row columns. Screenshot 2 shows excess introductory space even in the empty state. Use aligned rows with compact sparklines, preserving tabs, filters, search, sort, saved children and removal. Use distill/layout.
4. P2: Type and ornamental labels compete with data. Three font families, tracked micro labels, arrows, a dark headline banner and small metadata interrupt scanning. Use the requested single system family, two weights, tabular figures and restrained green palette. Use typeset/polish.
5. P2: Useful actions and explanations are scattered. Export is in the chart panel, Copy in the headline banner, and Save is implicit. Put export/save in the topic header, Copy in Momentum and explanations in keyboard/touch-accessible question-mark tooltips. Preserve every underlying feature and all source/freshness information. Use clarify/polish.

What works: explicit search/range controls and shortcuts; substantive regional/source content; clear empty/error states and a useful personal/shared Library distinction.

Cognitive load: too many separately framed regions and repeated labels before the result. The five year presets are intentional shortcuts and should remain. Emotional journey: searching looks approachable, but the result is delayed; finding trustworthy evidence takes further scanning.

Persona risks: a time-pressed analyst must scroll before judging momentum; a first-time colleague has to connect the growth window to the headline; keyboard and low-vision users need readable labels and focusable help rather than hover-only tooltips. Mobile/zoom behavior has not been visually tested.

Detector: 15 findings associated with site/index.html and its stylesheet: 7 undersized UI text, 3 tiny text, 1 low-contrast placeholder (4.47:1), 1 font heuristic, 1 kicker, 1 palette heuristic, 1 stripe advisory. Palette/font flags alone do not establish poor UX or AI authorship. The stripe is the intentional year-to-date hatch, not arbitrary decoration; preserve its data meaning when replacing the chart. Detector locations are line 0, so selectors/source inspection are needed for fixes.

Plan pending confirmation:
1. Adopt the exact supplied palette and one system family with two weights; record the replacement presentation in SPEC.md Section 7 and DESIGN.md.
2. Compact all existing search controls at the top; retain presets, Children 0–9, synonyms and include behavior. Put topic title, field/range and Export CSV/Save controls together.
3. Combine Papers, Growth and Papers in the relevant year with the line/area chart; retain original values, dynamic growth label, precise counts and partial-year meaning through accessible help.
4. Build the three-card Momentum/experts/countries row and two-card journals/papers row. Reveal additional experts and countries without discarding data. Copy retains its current content.
5. Consolidate Sub-topics and Explore next into the two-column row layout, retaining all existing destinations and inherited filters/ranges. Give the Library aligned name/spark/growth rows while preserving controls and relationships.
6. Move source/sample notes to the footer, remove ornamental labels/arrows and dot-separated explanations, and put explanations into accessible help. Keep loading/error/empty states. Update tests, run node --test and verify desktop/phone rendering through permitted headless tools. No Worker calculation/API/cache changes and no commit.

Question: May I proceed with this presentation-only plan?
