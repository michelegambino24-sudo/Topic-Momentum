# Step 16 counter and planner diagnostics

No live inference or OpenAlex searches were run. Synthetic reply fixtures are not captured production replies.

## Findings and offline replay

The saved evaluation has two measured planning calls for each of gamification/primary mathematics (92.728 neurons total), CRISPR/sickle cell (94.580), air pollution/asthma (80.644), sleep/memory/teenagers (81.562) and epigenetics/pregnancy (94.518). The old code recorded measured usage before decoding/validation. Transport errors/timeouts would mark it unmeasured. These five therefore failed during decoding or validation; their discarded exceptions/replies cannot be recovered.

The actual service was replayed offline for all five questions:

| Synthetic reply | Before | After |
| --- | --- | --- |
| Markdown fenced JSON | Both attempts fail decoding | Accept framing, validate all fields |
| Complete JSON followed by prose | Both attempts fail decoding | Accept first complete object; reject multiple JSON values |
| Missing required field | Both attempts fail validation | Reject with diagnostics; valid retry succeeds |
| Empty required term group | Both attempts fail validation | Reject with diagnostics; valid retry succeeds |
| Wrong field type | Both attempts fail validation | Reject with diagnostics; valid retry succeeds |
| Truncated JSON | Both attempts fail decoding | Reject with diagnostics; valid retry succeeds |

There is no evidence identifying the exact original variant. Source paths now accept `plan.` prefixes and numeric bracket indices. A literal single-concept question can recover its exact topic/year sources without invented expansions or choices. Retries receive validation feedback. Schema validation remains strict.

Each failure records stage, attempt number, call number, category, error name, short message, JSON parseability and up to 300 reply characters in `aiUsage.errors` and `console.log`. Known OpenAlex credentials and common credential/token patterns are redacted before truncation. No headers or environment values are logged. Eval preserves errors across clarification requests. Workers observability was absent; it is now enabled with sampling rate 1. No paid settings are enabled.

## Budget

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
