# Deterministic geography — step 16

The only membership/alias configuration is `site/places.js`. Both browser and Worker use it. No inference is needed to resolve a place, and model-returned codes/modes are ignored. Country names come from local English locale data, supplemented by common aliases and demonyms in that file.

Author locations is the default, including Europe, Middle East, MENA, Nordic countries and Balkans. Only clearly regional subject wording selects mentions, for example “research about European policy” or “studies on Europe as a topic.” Unclear wording remains author locations. The visible switch changes the mode while preserving the selected country set. Repeating the question restores its code-selected default.

Membership choices:

- Middle East: Bahrain, Egypt, Iran, Iraq, Israel, Jordan, Kuwait, Lebanon, Oman, Palestine, Qatar, Saudi Arabia, Syria, Turkey, UAE, Yemen (16).
- MENA: Middle East plus Algeria, Libya, Morocco, Tunisia (20); no Sudan.
- GCC/Gulf: Bahrain, Kuwait, Oman, Qatar, Saudi Arabia, UAE (6).
- Broader Europe: 49 supported ISO countries, including Russia, Turkey, Cyprus, Armenia, Azerbaijan and Georgia. Kosovo's non-ISO code XK is outside the existing country catalogue.
- EU: 27; Nordic: Denmark, Finland, Iceland, Norway, Sweden. Balkans includes Albania, Bosnia and Herzegovina, Bulgaria, Croatia, Greece, Montenegro, North Macedonia, Romania, Serbia, Slovenia, Turkey.
- Other explicit memberships are editable defaults: Africa 54 sovereign-state codes; North Africa includes Sudan; Sub-Saharan Africa is the remaining 48. South Asia uses the eight SAARC countries. North America includes Central America and the Caribbean. Latin America uses 20 Latin-language countries. Regions can overlap.

Two places combine as a union; worldwide/global overrides the union with no country filter. Mentions mode searches the selected region/country aliases, rather than automatically adding every member-country name. This keeps the switch literal and large-union source URLs bounded. Existing explicitly selected legacy keyword presets retain their previous behavior.

After changing aliases or membership, bump `version` in `site/places.js` and deploy both Worker and site together. Versioned links refuse changed definitions rather than silently using new membership. Existing compatible author-code cache identities remain readable; new interpretation keys bypass old model-chosen geography. Cache freshness and all daily/per-search caps are unchanged.

Deploy the Worker first with `npx wrangler deploy --config worker/wrangler.toml`, then publish the updated `site/` files, including new `places.js` and its script tag in `app.html`. No new secrets or dependencies. No production deployment is performed by this offline change.

One live check after deployment: “Is research on autism growing in the Middle East?” The chip should say “Authors based in: Middle East (16 countries)”. Click the switch: it should say “Mentioned in title/abstract: Middle East (16 countries)” and retain the same region. Run this only when ready to use a normal checked-search allowance.

Follow-up regressions in `worker/grounded-eval.test.js` replay the supplied topic-blanking fields (`repairedPlan.topic: autism research`, `rejectedPlan.topic: empty`, missing autism). Missing/nonliteral source text could make grounding erase the topic; repair now recovers exact autism as its source without adding any subject words. The complete original production replies were not available: reconstructed fixture fields are marked as such. Both the model-place and no-model-place variants produce topic autism research, the code-owned Middle East 16-country filter, authored mode, 2010-to-present, and no clarification/replan.

Self-check can block only on a quoted requirement from the question. Unstated populations and trend-only complaints are advisory; mixed objections pass only quoted requirements into bounded replanning. Logs retain both blocking and ignored requirements. This correction changes neither caps nor the paper-title evidence checks.
