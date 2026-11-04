# Step 16 ambiguity and final 422 diagnostics

No live searches or inference were run. The fixture replies are synthetic; the supplied production logs did not include the actual rejected plans, option contents or self-check JSON.

## What can explain the supplied sequence

The old per-call `outcome: success` meant that inference returned parseable, schema-valid JSON. A self-check returning `{"ok":false,"problem":"..."}` was therefore logged as success, then triggered a replan. It was not a semantic approval.

An offline replay reproduces planning → replan → selfCheck → replan → 422:

1. The initial candidate misses autism. It also returns malformed ambiguity and an extra key; those repairs are incidental. Coverage spends its one repair allowance.
2. A 35-neuron replan returns a valid regional plan (35 lies within the supplied 33–37 range).
3. Self-check takes 1.8 seconds and returns valid JSON with `ok:false`, requesting a semantic repair.
4. A 139-neuron, 16.5-second replan again misses autism. Coverage's allowance is already exhausted, so `coverage_before_cleanup` returns 422.

The same replay without ambiguity returns the same 422. Synthetic plan contents and unprovided durations/costs are test inputs, not recovered production facts. This is a possible explanation matching the supplied sequence, not proof that this exact semantic response occurred live.

A second replay uses `ok:true`: the subsequent paper sample has low precision and triggers optional tightening. Its revisions change an immutable topic and ultimately return `tightening_constraints` with `missing:["topic"]`. Thus a real semantic self-check pass also does not guarantee that later stages cannot fail. The original logs cannot distinguish these explanations. New request IDs also prevent combining separate requests accidentally.

## New diagnostics

Every 422 has `failingCheck`, with:

- `check`: `coverage_before_cleanup`, `coverage_after_cleanup`, `self_check`, or `tightening_constraints`.
- `missing`, the exact deterministic missing words/constraints, or the requirements named by the model; the full model problem remains available if it supplied no explicit missing list.
- `rejectedPlan`, `modelPlan` before repair, `repairedPlan`, retained sources, phase, call number, repair kind and remaining repair allowance.

`aiUsage.checks` and `AI plan check` console events also record replan triggers, low-precision tightening triggers, and semantic self-check results. `aiUsage.turns[].semanticOk` distinguishes a semantic rejection from a successfully decoded response. A self-check result without explicit missing concepts is labelled `missingSource: not_provided_by_model`, rather than inventing one.

Before repair, every returned ambiguity records original question, model question, named unclear requirement (or `not_provided` for old replies), raw options and raw ambiguity. These appear in `aiUsage.ambiguities`, the 422's `ambiguities`, and `AI ambiguity returned` console events. Diagnostics share a request ID. Known secrets and credential fields/patterns are redacted recursively; raw diagnostic option contents are not reduced to the ordinary 800-character error preview.

## Recovery and compact output

Both `Is research on autism growing the middle east` and `Is research on autism growing in the Middle East?` deterministically identify autism and Middle East. Exact source spans are restored to the original question's capitalization. A named region restores its full canonical codes and source before grounding, even if the model supplied no place, partial codes or Montenegro. Worldwide options cannot replace it.

A valid covered plan proceeds after checking with a small note when the model flags ambiguity. Invalid options cannot by themselves request a rephrase. A self-check complaining only about ambiguity/trend wording is advisory; genuine missing-concept or immutable-constraint failures still produce the named diagnostics. All paper/expert lists continue through the existing title checks; there is no unchecked list fallback.

The model's ambiguity schema now contains only a requirement (max 60 characters), question (max 120) and 2–3 label strings (max 60 each). Option plans/sources are derived server-side from the validated base. Old full-plan option replies and existing stored choices remain readable. Passing checked reports may satisfy an old expected clarification in eval only when they carry the explicit advisory note; all other topic, region and evidence assertions still apply.

Representative ASCII JSON size comparison for an autism/Middle East ambiguity:

| Ambiguity block only | Before: two complete plans/sources | After: labels only |
| --- | ---: | ---: |
| Serialized bytes | 809 | 188 |
| Estimated output tokens, bytes/4 | 203 | 47 |
| Estimated 70B output neurons | 41.58 | 9.63 |

This is approximately 77% less output for that block. Ordinary unescaped maximum-length ASCII strings produce a 413-character new block; Unicode, escaping and tokenization vary. The whole planner output limit remains 1000 tokens. No daily cap or timeout was changed.

The same planning request's conservative full-turn bound decreases from 426.58 to 347.67 neurons because the prompt/schema no longer duplicates complete option-plan schemas. The charge formula is unchanged. These are local estimates/bounds, not new measured provider usage. The observed 137 versus 42 neurons would correspond to roughly 464 extra output tokens at identical input, but input/context changes also affect cost; the old logs do not establish the cause of the 16-second call.

## Verification and owner deployment

Offline regressions cover the exact two autism questions and `Is children's mental health a growing field in the Middle East, and who's leading it?`, malformed/compact options, region retention, source capitalization, secret redaction, all final-422 checks, both replay paths, cached advisory notes and stored-choice compatibility.

Run `node --test`. Deploy the Worker with `npx wrangler deploy --config worker/wrangler.toml`, then publish updated `site/` through the existing Pages process (`site/query-parser.js` changed). The local eval tool needs no hosting deployment. Existing bindings, secrets and observability remain unchanged.

Try only `Is research on autism growing the middle east`. If it fails, inspect `failingCheck` and `aiUsage.checks`; correlate `AI plan check` and `AI ambiguity returned` logs using the request ID. No production deployment or commit was performed by the agent.
