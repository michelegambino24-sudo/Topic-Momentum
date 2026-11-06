# Security, privacy and enterprise-readiness audit

Date: 6 Nov 2026. Scope: this repository (`site/`, `worker/`, `tools/`, CI) after moving the AI checks from Cloudflare Workers AI to the OpenAI API.
No secret values appear in this report. Nothing was deployed, rotated, deleted or pushed. Nothing was committed.

**Not validated:** the OpenAI integration was tested with mocked responses only. No real OpenAI or OpenAlex call was made, so run one real search before relying on it (see "Before you deploy").

## 1. Architecture and data flow

| Part | What it is |
|---|---|
| Website | Static HTML/JS in `site/`, published by GitHub Pages from a **public** repository (the workflow uploads only `site/`). |
| API | One Cloudflare Worker (`workers.dev` URL) with one KV namespace `TMM`. |
| External services | OpenAlex (paper counts, authors, titles) and OpenAI (search planning and title judging). No Cloudflare AI is used any more. |
| Browser storage | `localStorage`: "My library", the last opened topic, the AI-check switch. |

Data flow: browser → Worker `/api/search` → OpenAI (the user's sentence, then candidate paper titles) and OpenAlex (search terms). Results are cached in KV.

## 2. Findings

Severity is for the planned use (colleagues at a consulting firm, possibly confidential topics). "Confirmed" means seen in the code or files.

| # | Severity | Status | Finding | Action |
|---|---|---|---|---|
| 1 | **High** | Confirmed | The real **OpenAlex key** was inside a tracked local state file (`.impeccable/journal-state/.../*.sqlite-wal`, a Wrangler trace store). It is in the current files and in 1 commit of the history. The repository is public, so treat the key as **potentially compromised**. | **You:** rotate the OpenAlex key, then update the Worker secret. **Done locally:** the 21 state files were removed from the Git index and `.impeccable/journal-state/` was added to `.gitignore` (not committed). Purging history is optional after rotation and needs a force-push, which needs your approval. |
| 2 | **High** (for confidential use) | Confirmed | **No authentication.** Anyone on the internet can call `/api/search`, `/api/topic` and `/api/library`. The `Origin` check only blocks browsers on other sites; requests without an `Origin` header are accepted and the header can be faked. | Do not process confidential or client topics yet. Put the site and the Worker behind company SSO (e.g. Cloudflare Access) and enforce it in the Worker. |
| 3 | **High** (for confidential use) | Confirmed | **The Library is public and shared.** Every topic anyone searches is indexed and listed by `/api/library`, so one person's research topics are visible to everyone, including outsiders. | Per-user or per-team libraries behind login, or turn the shared Library off for internal use. |
| 4 | Medium | Confirmed | **Cost and availability abuse.** A public caller can use up the daily AI allowance (70 AI searches, about US$1 a day by default). Spending is bounded, but colleagues would be locked out for the day. There is no per-visitor rate limit. | Cloudflare rate-limiting rule, or the SSO in #2. Lower or raise `AI_DAILY_BUDGET_UNITS` as needed. |
| 5 | Medium | Confirmed | **Questions end up in logs.** The Worker logs the user's sentence, the plans and up to 800 characters of model replies, and observability is sampled at 100%. | Log content only in development, or switch observability off. This changes your debugging, so I did not do it without asking. |
| 6 | Medium | Confirmed | **Stored data.** Sentences are kept in KV for 7 days (AI records), reports for up to 60 days, and the Library index has no expiry. There is no delete function. | Decide a retention period and add a delete or "do not save" option. |
| 7 | Medium | Requires Infrastructure Verification | **OpenAI as a data processor.** Questions and paper titles go to OpenAI. Retention, training use, data-processing terms and any zero-data-retention setting depend on the OpenAI organization and project, not on this code. The code sends `store: false`. | Use a company OpenAI project with an agreed data policy before real client data. |
| 8 | Low | Potential | **Prompt injection through paper titles** (text from OpenAlex goes to the judge). Impact is limited: the model has no tools, answers must be plain JSON or integer IDs checked by code, `<` and `>` are escaped, and nothing from the model is executed. A crafted title could at most change which papers are marked as checked. | Accept, and keep the "titles, not full papers" notice. |
| 9 | Low | Confirmed | No Content-Security-Policy on the site (GitHub Pages cannot set headers). Output is escaped before `innerHTML`; no unescaped user text was found in the spot check. | Add a meta CSP after testing it in a browser. **Done:** the Worker now sends `X-Content-Type-Options: nosniff`. |
| 10 | Low | Confirmed | Repository hygiene: 232 tool files in `.agents/`, plus `.claude-backup/` and `.impeccable/` are tracked. GitHub Actions are pinned by tag, not by commit hash. `tools/measure-evidence.mjs` still targets Cloudflare Workers AI and is obsolete. | Remove or ignore unneeded folders; pin actions; retire the old tool. |
| 11 | Info | Good | The OpenAlex key is read only from a Worker secret. Error responses are generic. Secrets are redacted in logs. No hardcoded passwords, tokens or database strings were found in the files or in Git history (other than #1). No Cloudflare AI token exists in the repo. | none |

Not applicable here: SQL/NoSQL injection (no SQL; KV keys are validated and hashed), uploaded files, user accounts and object-level authorization (there are no accounts yet; this is the gap behind #2 and #3).

## 3. OpenAI integration: what changed

- New `worker/openai.js` calls `https://api.openai.com/v1/chat/completions` from the Worker only. The key comes from the secret `OPENAI_API_KEY`; the browser never sees it.
- The backend alone chooses the model and limits (output capped at 4000 tokens, `store:false`, a 45 s timeout, no redirects, a fixed request shape). Users cannot set any of these.
- Provider errors are reduced to the HTTP status, because OpenAI error text can echo part of a key. A missing or blank key fails safely: AI checks are off, counts and saved reports still work.
- The old Workers AI binding and Cloudflare model names are gone from `wrangler.toml` and from `ai.js`. The rest of Cloudflare (Worker, KV) is unchanged.
- **Cost guard:** usage is counted from the tokens OpenAI reports (1 unit = US$0.00001). Limits: about US$0.03 per search, about US$1 per day (`AI_DAILY_BUDGET_UNITS`), 70 AI searches per day. If OpenAI reports no usage, the code charges its conservative upper bound.
- `gpt-4o-mini` is the default (`OPENAI_MODEL`). If you change the model, also update the two price variables so the guard stays accurate.

## 4. Where the key lives

The Worker runs on Cloudflare, so a file on your laptop cannot serve it. Therefore:

- **Production:** `npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml` (hidden prompt). It works from any computer, because the site calls your online Worker.
- **Local testing:** `worker/.dev.vars` (Git ignores it; `.dev.vars.example` has placeholders). Someone who clones the repo must add their own key to run the Worker locally.
- **Company key later:** run the same command with the new key. No code change.
- **Recommended for the company:** a dedicated OpenAI *project* (not a personal key) with a monthly budget and usage alerts, separate dev, staging and production Workers each with its own key and KV namespace, and key rotation done by the Worker admin.

## 5. What is needed before colleagues use it

1. Rotate the OpenAlex key (#1).
2. Login for everyone (SSO with MFA), enforced in the Worker, plus per-user or per-team Library (#2, #3).
3. Rate limiting (#4).
4. Retention rules, delete option, content-free logs (#5, #6).
5. Company OpenAI project and data-processing terms (#7).
6. Separate dev, staging and production, and an owner for each secret.
Until then, use only public, non-client topics.

## 6. Validation

- `node --test`: 682 tests pass (674 before; 8 Cloudflare-specific tests were rewritten, 8 new tests cover the OpenAI adapter: request shape, missing key, key only in the header, cost from tokens, error redaction, truncated replies).
- Secret scan of the working tree and Git history: no key-shaped strings except the fake test key in `worker/openai.test.js`, and the finding in #1.
- Interface checked in Chromium (desktop and phone width): one example button that never repeats back-to-back; replay button inside the demo; no script errors; no horizontal scroll.

## Before you deploy (owner steps)

1. Rotate the OpenAlex key; update `OPENALEX_KEY`.
2. `npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml`
3. `npx wrangler deploy --config worker/wrangler.toml`, then run one real search and check the OpenAI usage page.
4. Check in the Cloudflare dashboard that no old AI binding or token remains.
5. Commit and push the site and Worker changes.
