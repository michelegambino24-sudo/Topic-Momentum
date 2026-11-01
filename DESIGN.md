---
name: Topic Momentum Meter
description: Restrained research analytics with clear evidence and fast comparison.
colors:
  page: "#F4F6F1"
  card: "#FFFFFF"
  border: "#D3D8CF"
  chart: "#7E8B63"
  action: "#5F6B47"
  text: "#1F2A1C"
  secondary: "#5E6859"
  positive: "#4A5538"
  negative: "#B5483C"
  soft: "#EDF0E7"
typography:
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(28px, 3vw, 38px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  metric:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(28px, 3.3vw, 42px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
rounded:
  control: "6px"
  panel: "12px"
spacing:
  tight: "8px"
  control: "12px"
  group: "16px"
  panel: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "10px 24px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.positive}"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

## Overview

This is a working research analytics interface. Its visual authority is the user's approved palette, system typography and report/Library composition, implemented in `site/`. The supplied Exploding Topics screenshots informed hierarchy and comparison patterns, not branding or product claims.

The plain Topic Momentum Meter wordmark, clear numeric alignment and quiet dividers carry the identity. Product purpose and audience remain governed by PRODUCT.md; report calculations remain governed by SPEC.md.

## Colors

Use page and card surfaces to separate the workspace from evidence. Border is the shared divider color. Action identifies links, buttons, selection and the active momentum segment. Secondary covers explanatory text and placeholders and meets 4.5:1 on white.

**The chart-only color rule.** Chart green belongs to geometry and low-opacity area fill, never text. Positive and negative carry the sign of growth; words and numbers must remain understandable without color.

## Typography

One system family, two weights: regular for content and semibold for hierarchy and quantities. All numbers use tabular figures. There are no external font requests or display/monospace families.

Titles are sentence case. Body and rows use a stable, compact scale; metadata remains readable at 13–14px. Metrics reduce to 25px on narrow phones; unavailable growth uses smaller text rather than pretending to be a numeric quantity. Headline prose has a comfortable maximum measure of 65–75 characters.

**The single-voice rule.** Hierarchy comes from size, weight, space and alignment. Do not add uppercase eyebrow labels or a second family to create distinction.

## Layout

The centered workspace has a maximum outer width of 1384px with 32px desktop padding, reducing to 20px and then 16px. Shared gaps are 16–32px. The report and Library use aligned content edges and numeric columns.

At wide sizes, supporting evidence uses three columns, publications two, and topic rows two. At intermediate sizes Momentum spans the supporting row. At phone sizes these groups stack and topic rows become one column. The Library field filter becomes a horizontal strip. Search retains one primary action and progressively discloses advanced options.

## Elevation & Depth

Panels are flat, bounded by a single thin border; they do not have resting shadows. Only transient help and status messages use soft downward shadows. Focus uses a visible two-pixel action-colored outline with a three-pixel offset.

## Shapes

Panels have gently rounded corners. Inputs and buttons use smaller rounded corners; question-mark controls are circular. Data rows remain flat with thin separators. There are no decorative icons, arrows, emoji, gradients, textures or brand symbols. The Saved check mark is a functional state indicator. The compact top bar uses action green, white text and a white active underline.

## Components

- **Search:** topic and Measure momentum are primary. More options is a native disclosure; relevant saved filters open it automatically. Keep all filter explanations available through help.
- **Controls:** primary actions have filled action color; secondary actions use white and a border; tertiary actions are underlined text. Preserve hover, active, disabled and focus states.
- **Help:** question-mark buttons have expanded touch targets, accessible descriptions, hover/keyboard focus/click/tap behavior and Escape dismissal. Help stays within the viewport.
- **Growth display:** use New topic when the first year of the actual growth window has fewer than 20 papers or 2% of the final complete year. Place the actual endpoint counts underneath the KPI. Preserve the underlying rate and sort; save endpoint metadata for short-range Library entries.
- **Metrics and chart:** three quantities share one panel. The SVG line preserves exact counts and has sparse labels, a light dashed grid and low-opacity fill. A partial current year uses a dashed final segment, lighter point and year-to-date tooltip. Never imply it is a complete-year change.
- **Momentum:** a compact labelled scale fills only the actual active segment. Unavailable growth leaves all segments unfilled and states the reason in text.
- **Evidence lists:** experts and countries initially show five records and expand in place. Thin country bars supplement counts; they do not replace them.
- **Supporting lists:** experts, countries, journals and papers default to five, expanding in place. Supporting cards align to the top and retain their natural content heights. Paper titles and right-aligned citations share one line; muted authors, journal and year follow on the second.
- **Saved state:** filled action green with a white check and Saved, distinct from the bordered Export CSV.
- **Rows:** topic and Library entries align names and quantities. Library rows use tight name/field lines and grouped indentation for sub-topics and range/include variants. Sparklines use stored range bounds and `spark` values only; fallback growth carries 5y. A missing parent is a heading, not a counted report. Personal removal is small and muted, visible on hover/focus or always on touch. Report sub-topic rows require current-report counts and growth (including legitimate null growth), and all use the same weight.
- **Status:** source, sample and freshness information appears in the footer. Loading and actionable errors remain visible through the existing status path.

## Do's and Don'ts

- **Do** preserve every data value, source link, filter and saved-report behavior while changing presentation.
- **Do** keep the current partial year visually and verbally distinct.
- **Do** verify long titles, unavailable growth, empty lists and narrow viewports.
- **Don't** use chart green for text or introduce additional font families/weights.
- **Don't** add decorative labels above headings, arrow icons or repeated notice banners.
- **Don't** drop records merely to keep a list at five items, or fabricate a sparkline for missing data.

## Copy formatting

Use capitalised report titles and place periods only in subtitles. Format visible dates as 1 Nov 2026; signed percentages use a real minus and whole numbers from 10% upwards, one decimal below 10%. Growth and New topic have independent help, and the chart has a concise dashed-year explanation. Library counters say topics, sub-topics and saved versions. All generated sentence examples live in COPY.md.
