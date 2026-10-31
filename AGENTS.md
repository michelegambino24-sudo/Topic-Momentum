# AGENTS.md — rules for the coding agent

SPEC.md is the source of truth. Read only the sections the current step needs.

## How we work
- One step from SPEC.md Section 9 per session. Do not start the next step.
- Start with a short plan (max 8 bullet points) and wait for my confirmation before writing code.
- Only read and change the files the step needs. Do not scan or summarise the whole repo.
- Keep replies short: what you changed, how to test it, anything I must do by hand.
- Finish only when `node --test` passes (from step 2 on). Do not commit; I commit myself.

## Code rules
- English for code, comments, UI text and commit messages.
- Website: plain HTML, CSS and JavaScript in `site/`. No frameworks, no npm packages, no build step.
- Worker: plain JavaScript in `worker/`. The only allowed tool is `wrangler` (run with npx). No other dependencies.
- Pure logic goes in `worker/lib.js` so it can be tested.
- Tests use `node --test` and saved responses in `worker/fixtures/`. Tests never call the network.
- Colours and fonts as defined in SPEC.md Section 7. The site must work at phone width.
- User-facing errors are plain sentences that say what happened and what to do.

## Security and cost
- Never write any API key in code, tests, fixtures, README examples or commits. The OpenAlex key exists only as the Worker secret `OPENALEX_KEY`.
- Never add paid services, payment settings or anything that could create a cost.
- Keep the daily cap and the 7-day cache exactly as in SPEC.md Section 4.
- Never put real client or company names in sample data.
