# Step 16 counter and planner diagnostics

No live inference or OpenAlex searches were run. Synthetic reply fixtures are not captured production replies.

## Findings and offline replay

The saved evaluation has two measured planning calls for each of gamification/primary mathematics (92.728 neurons total), CRISPR/sickle cell (94.580), air pollution/asthma (80.644), sleep/memory/teenagers (81.562) and epigenetics/pregnancy (94.518). The old code recorded measured usage before decoding/validation. Transport errors/timeouts would mark it unmeasured. These five therefore failed during decoding or validation; their discarded exceptions/replies cannot be recovered.

The actual service was replayed offline for all five questions:

| Synthetic reply | Before | After |
| --- | --- | --- |
| Markdown fenced JSON | Both attempts fail decoding | Accept framing, validate all fields |
| Complete JSON followed by prose | Both attempts fail decoding | Accept first complete object; reject multiple JSON values |
| Missing optional year field | Both attempts fail validation | Default/repair before validation |
| Empty required term group | Both attempts fail validation | Drop malformed group, then check required-concept coverage; re-plan or ask for rephrasing |
| Wrong optional field type | Both attempts fail validation | Drop/default before validation |
| Truncated JSON | Both attempts fail decoding | Reject with diagnostics; valid retry succeeds |

There is no evidence identifying the exact original variant. Source paths now accept `plan.` prefixes and numeric bracket indices. A literal single-concept question can recover its exact topic/year sources without invented expansions or choices. Retries receive validation feedback. Schema validation remains strict.

Each failure records stage, attempt number, call number, category, error name, short message, JSON parseability and up to 800 redacted reply characters in `aiUsage.errors` and `console.log`. Known OpenAlex credentials and common credential/token patterns are redacted before truncation. No headers or environment values are logged. Eval preserves errors across clarification requests. Workers observability was absent; it is now enabled with sampling rate 1. No paid settings are enabled.

## Budget from the preceding correction (before the nullable-place schema)

| Quantity | Before | After |
| --- | ---: | ---: |
| Per-search ceiling | 600 | 2,400 |
| Initial reservation | 600 | 600 |
| Extra reservation | None | 600 increments before calls |
| Daily neuron cap | 9,000 | 9,000 |
| AI admission ceiling | 50 | 50 |
| First social-media planning upper bound | 352.1457 | 354.865836 |
| Four calls with that planning payload | 1,408.5828; blocked | 1,419.463344; fits |

The slightly larger bound comes from clearer source-path instructions. The unchanged formula uses UTF-8 input bytes plus 256 framing tokens and maximum output tokens. At 1,000 output tokens, output alone reserves 204.805 neurons. Unknown usage remains conservatively charged and unmeasured; measured usage replaces estimates. Each extension must fit under `used + reserved <= 9000`. Settlement releases unused reservations. Existing KV eventual consistency across isolates remains; no counters were reset.

## Admin inspection and deployment

`dailyKey()` in `worker/lib.js` selects UTC dates for `ai:usage:YYYY-MM-DD`, `ai:count:YYYY-MM-DD`, and `count:YYYY-MM-DD`. Missing keys start at zero; records expire after 172800 seconds. UTC midnight is 01:00 Rome in winter, 02:00 in summer. Reset messages use Europe/Rome, including DST changes.

From the project root, `node tools/daily-counters.mjs` reads today's three counters using existing Wrangler admin authorization. It runs no searches, AI or writes and creates no public endpoint. Null values mean missing keys, treated as zero.

Owner steps:

1. `node --test`
2. `npx wrangler deploy --config worker/wrangler.toml` (Worker and observability)
3. Publish the updated `site/` through the existing GitHub Pages process; `site/query-parser.js` removes empty comma parts.
4. Optionally inspect counters with `node tools/daily-counters.mjs`.
5. Try one question: **How is research on CRISPR for sickle cell disease growing?** It was one of the five retry failures. Normal live allowances apply. If it fails, inspect `aiUsage.errors` in the response or Workers Logs. To save an eval, put only this question in the editable eval list and run `node tools/eval-questions.mjs --limit 1`.

No new secrets, bindings or services are required. Seven-day caches and source caps remain unchanged. The battery-recycling question's missing literal topic/year sources recover offline without clarification. Persistent coverage/self-check failure returns HTTP 422 with a rephrase message. Every successful clarification has 2–3 grounded ready options.


## Follow-up: invented place codes in toddler-language planning

The owner supplied production previews with WJ and WZ. Both fail the strict country allowlist check in validateAIPlan; deleting the code makes all visible plan fields pass. That check ran before the existing geography grounding could remove an invented place. The complete source/year tails were not supplied: worker/fixtures/invented-place-replies.json labels its reconstructed tails explicitly. No full production reply is claimed.

The model boundary now repairs optional fields before calling the strict internal validator. Unnamed places and invalid codes are dropped, optional terms/groups/exclusions are cleaned, optional dates are defaulted or recovered from explicit question dates, extra keys are removed and sources reindexed. Missing/unusable topics remain invalid model replies. Required-concept coverage and self-check still run after repair. Place-drop events appear in Workers Logs as AI plan repaired and in aiUsage.repairs, with safe field/action/reason metadata. Failed-reply previews are 800 characters, redacted before truncation.

Offline regression coverage includes both WJ/WZ variants, all five earlier questions with WJ added, valid authored Gulf codes, optional-field/default repairs, missing/invalid topics, dates, source indices, console logs and secret redaction. The original strict validator remains available for cached/internal plan checks.

For this follow-up, redeploy only the Worker with npx wrangler deploy --config worker/wrangler.toml. The existing observability setting is retained. No site files changed. The updated local eval tool preserves aiUsage.repairs automatically; it needs no deployment. No new bindings or secrets. Test only: How is research on screen time and language development in toddlers changing? If a place is dropped, inspect AI plan repaired events or aiUsage.repairs; any remaining invalid reply includes the expanded redacted preview in aiUsage.errors. Daily 9000-neuron, 50-AI-attempt and source caps/cache rules are unchanged.


## Option A: timeout accounting and stage timing

Planning, repair and tightening now use AI_TIMEOUT_MS=25000; judging and self-check retain 12000 via AI_CHECK_TIMEOUT_MS. AI_PREPARATION_MS=90000 is wired to the preparation deadline and source cancellation. The existing browser/eval 110-second deadline leaves response/settlement headroom. Only the relevant timeout ends a call; the separate 14-call limit has ai_call_limit rather than a timeout reason. No automatic timeout retries.

Each AI call completed log and aiUsage.turns item records stage, source phase, model, attempt/call, ms, timeoutMs, outcome/reason, neurons, measured and costBasis. Stage totals add ms. AI search completed adds a terminal reason and total duration; eval preserves the same data. A self-check timeout returns HTTP 200 with planOnly and a persistent plan/note, no paper/expert lists, no further checking and no successful evidence cache write. A valid plan remains available even if the total deadline expires during its self-check.

When a call returns usage.neurons, the app charges that reported amount. If the reply has no usage, or the call times out before a reply arrives, the app charges its existing conservative upper bound: input UTF-8 bytes plus 256 framing tokens, plus maximum output tokens, using the documented per-model rates. Such charges are labelled estimated. The daily ledger is an app admission guard, not a Cloudflare invoice. Promise.race does not cancel remote inference, so provider cost after timeout is unknown. The previous ~767 counter increase alone cannot identify which stage was billed or prove 767 actual provider neurons. Removing timeout retries avoids starting a second overlapping call.

The full-question fixture example previously calculated 347.959 planning + 53.130 self-check + 98.402 five title batches = 499.490 conservative neurons, or 849.076 with one coverage repair. These are payload-specific upper bounds, not measured success costs. Earlier pre-self-check successful searches averaged ~82 measured neurons; no new-flow live measurements are claimed. Planning/repair dominates the conservative example. Daily admission, source caps and neuron limits remain unchanged.

Lower unmeasured-charge proposal (NOT applied): estimate input tokens as UTF-8 bytes / 4 + 256 framing tokens while keeping the output maximum. For the current toddler-language planning prompt this yields 245.714 instead of 347.959 neurons, a reduction of 102.245 (~29%). Output alone still contributes 204.805 at 1000 tokens. The four-byte ratio is an English-text heuristic, not a safe tokenizer upper bound. It would need measured validation/accounting safeguards before use under the 9000 guard; no unknown charge is silently replaced with an assumed normal-call cost.

Owner deployment: npx wrangler deploy --config worker/wrangler.toml, then publish updated site/ through the existing Pages process (site/app.js and site/query-parser.js changed). Existing Workers Logs observability is retained; no new bindings/secrets. The local eval tool needs no hosting deployment. Test just: How is research on screen time and language development in toddlers changing? A completed report has checked lists; a self-check timeout displays the validated plan and advisory note. Inspect AI call completed / AI search completed logs or aiUsage.turns for the exact stage timings and measured/estimated costs. No live searches were run by the agent.
