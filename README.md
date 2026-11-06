# Topic Momentum Meter

Plain HTML/CSS/JavaScript in `site/`, with a Cloudflare Worker and KV in `worker/`.
Visitors need no account or key. The Worker runs on Cloudflare Workers Free with free KV,
the site on GitHub Pages from this public repository. AI checks call the OpenAI API, which is
pay-as-you-go: the daily spending guard below limits it.
The cap remains 90 new attempts per UTC day, including failed source attempts;
cached reports remain fresh for seven days. KV counters can slightly overshoot
under concurrent requests. No dependencies or site build step are required.

## Publish from Windows PowerShell

Run each command separately and check its result before continuing. Install a
current Node.js LTS with npm and Git first if needed. Never put the OpenAlex key
in a command, a file, a screenshot, Git, or chat. Only enter it at Wrangler's
interactive hidden secret prompt below. Namespace IDs and Worker URLs are public
configuration, not secrets.

1. Open PowerShell in the project:

   ```powershell
   Set-Location 'C:\Users\miche\Desktop\Topic-Momentum'
   ```

   Check that the prompt ends in `Topic-Momentum`.

2. Run the offline tests:

   ```powershell
   node --test
   ```

   Check that failures are zero.

3. Check secret files are not tracked:

   ```powershell
   git ls-files -- ':(glob)**/.dev.vars' ':(glob)**/.dev.vars.*' ':(glob)**/.wrangler/**' ':!.dev.vars.example' ':!worker/.dev.vars.example'
   ```

   Check that there is no output. Do not deploy if a real secret file is tracked.
   `.gitignore` excludes local Wrangler state and secret files; the example is
   allowed only because it contains no real credential. Review repository changes
   locally before publishing. Never share output containing a credential.

4. Create/verify a free account at <https://dash.cloudflare.com/sign-up>, verify
   your email, and keep Workers on the Free plan. No domain purchase is needed.
   In Workers & Pages, choose a workers.dev subdomain if prompted. Authenticate:

   ```powershell
   npx wrangler login
   ```

   Check the browser authorization succeeds for the intended account.

5. Create the single production KV namespace:

   ```powershell
   npx wrangler kv namespace create TMM --config worker/wrangler.toml
   ```

   Check it succeeds and note the namespace ID. If `TMM` already exists, reuse its
   ID from the dashboard instead of creating another namespace.

6. Open the configuration:

   ```powershell
   notepad worker/wrangler.toml
   ```

   Replace only the all-zero KV `id` with the ID from step 5. Check the binding is
   `TMM`, `workers_dev = true`, and `ALLOWED_ORIGIN` is exactly
   `https://michelegambino24-sudo.github.io` (no path or trailing slash).
   Keep `NEW_TOPICS_PER_DAY = "90"`. Do not add `ENVIRONMENT=dev` to production.
   Save and close. No key belongs here.

7. Deploy the Worker:

   ```powershell
   npx wrangler deploy --config worker/wrangler.toml
   ```

   Check the TMM binding, exact allowed origin, and workers.dev URL in the output.
   Check there is no `ENVIRONMENT=dev` binding. This first deploy has no key, so
   new topic requests cannot call OpenAlex yet.

8. Set the secret:

   ```powershell
   npx wrangler secret put OPENALEX_KEY --config worker/wrangler.toml
   ```

   Enter the key only at the hidden interactive prompt. Do not append it to the
   command or save it to a file. Check Wrangler confirms the secret was uploaded.
   This command deploys a new Worker version with the secret.

   **AI checks use OpenAI.** Set its key the same way, once per environment:

   ```powershell
   npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.toml
   ```

   The key lives only in the Worker, never in `site/` or Git. Moving from your personal key
   to a company-managed key means running the same command with the new key: no code
   changes. For local testing copy `worker/.dev.vars.example` to `worker/.dev.vars`
   (Git ignores it) and fill in your own values. The model and the price used for the
   spending guard are the `OPENAI_*` variables in `worker/wrangler.toml`; the daily
   limit is `AI_DAILY_BUDGET_UNITS` (1 unit = US$0.00001, so 100000 is about US$1 a
   day). Without the key the site still works for counts, and AI checks stay off.
   Security findings and open decisions are in `SECURITY_AUDIT.md`.

9. Configure the public URL:

   ```powershell
   notepad site/config.js
   ```

   Replace `https://topic-momentum-meter.YOUR-SUBDOMAIN.workers.dev` with the exact
   HTTPS URL printed by deploy (no trailing slash). Check the local selection
   remains in place: file pages, localhost and loopback use port 8787; hosted pages
   use the deployed URL. Save and close.

10. Open `<your deployed Worker URL>/api/library` in the browser. Check it returns
    a JSON array (`[]` is normal before any reports). This reads KV without using
    OpenAlex. Direct navigation has no Origin header and is allowed. Browser
    requests from the configured GitHub origin are allowed; `Origin: null` and
    localhost are accepted only with `ENVIRONMENT=dev`.

11. Rerun tests:

    ```powershell
    node --test
    ```

    Check failures are zero. Review, commit and push the changes yourself; this
    project deliberately leaves commits to the owner.

12. In the public GitHub repository, open Settings > Pages > Build and deployment
    and select **GitHub Actions** as the source. The supplied workflow uploads
    only `site/`; branch-based publishing cannot select an arbitrary `site/`
    folder. After pushing to `main`, check **Actions > Publish site** succeeds.
    If you pushed before enabling Pages, use **Run workflow** on `main`.

13. Open <https://michelegambino24-sudo.github.io/Topic-Momentum/>. Check Library
    loads without a service error, then search for a topic. A successful new
    search consumes one daily attempt; repeat it to check the cached report.
    Check both pages at phone width. In Cloudflare Worker Settings, verify the
    only key is an encrypted `OPENALEX_KEY` secret and no dev environment variable
    is set. Never expose the secret value to verify it.

## Local use after publishing

### Filter a topic

Enter a main topic and optional synonyms. In **Must also include**, enter
comma-separated alternatives. For example, topic `neurotechnology`, synonym
`neural implant`, and additional terms `children, child` search for
`(neurotechnology OR "neural implant") AND (child OR children)` in titles and
abstracts. Every chart, count and paper uses this combined search.

**Children 0–9** fills related search terms without submitting. It does not
verify participant ages; check those in each paper. Filtered reports show the
combination in the title and headline and are saved as **Variants** under their
main topic in Library. Opening a saved variant uses the cache.

### Start locally

Open `site/app.html` (the tool; `site/index.html` is the landing page) from your PC, or serve it on localhost. It automatically
uses `http://127.0.0.1:8787`. To start the local Worker:

```powershell
npx wrangler dev --local --config worker/wrangler.toml --var ENVIRONMENT:dev
```

Check Wrangler reports a local listener. This does not copy the production secret
to your PC. Library and cached local data can work without a key; fresh local
OpenAlex requests need a separately available local secret. This publishing guide
does not ask you to create a local key file. For a live topic search without
storing a local secret, use the published site.

## Reference

- [Cloudflare KV commands](https://developers.cloudflare.com/workers/wrangler/commands/kv/)
- [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
