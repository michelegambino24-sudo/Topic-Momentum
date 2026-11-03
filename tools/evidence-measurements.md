# Checked evidence — historical live measurement report

These measurements predate the new source-grounding, self-check and clarification flow. They are not measurements of the current implementation. No live requests were made during this correction. After deployment and tomorrow’s reset, run `node tools/eval-questions.mjs --limit 8`; it reports every re-plan and self-check, plus both requests when an explicit fixture clarification is answered.

Measured on 3 Nov 2026 using the actual Worker, live AI and OpenAlex, with isolated benchmark KV. No fixture judgments were used. The canonical eight questions are independent of the editable demo list.

| Question | Measured neurons |
| --- | ---: |
| social media, kids, attention | 110.74 |
| Is children’s mental health a growing field in the Middle East, and who’s leading it? | 89.62 |
| Does gamification help primary school pupils learn mathematics? | 79.87 |
| How is research on CRISPR for sickle cell disease growing? | 81.41 |
| What research links air pollution to asthma in children? | 81.45 |
| How does sleep affect memory in teenagers? | 77.49 |
| Which researchers study epigenetics during pregnancy? | 93.86 |
| How is research on battery recycling developing since 2020? | 43.42 |

Total: 657.87. Average: 82.23. Maximum: 110.74.

Planning/tightening: @cf/meta/llama-3.3-70b-instruct-fp8-fast. Judging: @cf/qwen/qwen3-30b-a3b-fp8, with thinking disabled and JSON verified live. The exact Kahoot and piano negative titles both failed; the positive primary-school mathematics title passed.

All-70B completed checks reached 230.40 neurons; 40 at that cost project to 9,215.93. The conditional hybrid route was therefore used. Fifty checks at the final observed hybrid maximum project to 5536.84 neurons. AI_SEARCHES_PER_DAY is 50; an independent actual-usage ledger enforces the 9,000-neuron app budget and settles unused in-flight reservations. These are measured sample costs, not a promise that every future question costs the same.

The Middle East question was rechecked after removing a redundant custom place group. It now has one regional constraint and verified author counts of 18, 17 and 16. The first broad social-media question returned no directly matching checked candidate titles; it correctly shows the few-papers, insufficient-experts and low-precision notices instead of padding.

The existing OpenAlex attempt cap remains 30/day. The temporary preview reached it during evaluation; no production counter was reset or raised. Exact cached reports still open without AI/source calls. The final eight complete measurements used an isolated in-memory KV ledger and existing credentials in memory. No production Worker deployment, login, paid settings, new account or package was introduced.

Raw measured per-model usage, plans, reliability, shown papers/experts, and the superseded-row history are in evidence-measurements-final.json. The comparison preview is in evidence-measurements-final-70b.json. Offline tests validate this evidence without network calls.

After publishing the Worker and site, run:

```powershell
node tools/eval-questions.mjs --limit 1
node tools/eval-questions.mjs
```

Run fresh source searches after the normal source allowance resets if today’s cap has been reached. Cached interpretation runs correctly report zero new neurons.
