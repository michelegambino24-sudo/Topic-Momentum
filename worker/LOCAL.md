# Step 3: local cache and library

From PowerShell, start the Worker:

```powershell
Set-Location 'C:\Users\miche\Desktop\Topic-Momentum\worker'
npx wrangler dev --local --var ENVIRONMENT:dev
```

KV runs on your computer without a Cloudflare account. Keep your existing local
OpenAlex secret setup. In step 6, replace the all-zero `id` under
`[[kv_namespaces]]` in `worker/wrangler.toml` with your real `TMM` namespace ID.
No namespace creation or deployment is needed now.

## Check the topic cache

In another PowerShell window, call the Worker directly, without opening the site:

```powershell
$topicUrl = 'http://127.0.0.1:8787/api/topic?q=lunar%20moss%20computing'
(Invoke-RestMethod -Uri $topicUrl).cached
(Invoke-RestMethod -Uri $topicUrl).cached
```

For a new successful search, the first answer is `False`; the second is `True`
and returns much faster, without OpenAlex requests or a counter increment.
If the first answer is already `True`, that topic is already stored locally.
Restarting the Worker keeps the local cache. A source error is counted but is
never saved as a report.

To inspect the saved topic index:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/library' | ConvertTo-Json -Depth 10
```

## Reset local KV

Stop the Worker with Ctrl+C. Then run:

```powershell
Remove-Item -LiteralPath 'C:\Users\miche\Desktop\Topic-Momentum\worker\.wrangler\state' -Recurse -Force
```

Restart the Worker with the command above. This resets the local topic cache,
library index and daily counters. The folder is recreated automatically.
If you used `--persist-to`, clear that directory instead.
[Cloudflare documents local persistence and reset here](https://developers.cloudflare.com/workers/local-development/local-data/#where-local-data-gets-stored).

## Storage rules

- Freshness lasts exactly seven days from the saved timestamp. Old reports stay
  stored for fallback. At the daily cap, an expired report is returned with
  `cached: true`, `stale: true`, and its original `updated` date.
- `NEW_TOPICS_PER_DAY` defaults to 90 attempts per UTC day. Reservation happens
  before OpenAlex calls; source failures still consume an attempt. Setting it to
  `0` disables new source requests while keeping cached reports available.
- A successful new report uses at most three KV writes: counter, report, index.
  An ordinary cache hit uses no writes. A hit can repair a missing index entry
  or a parent relationship with one index write.
- KV contains reports, topic metadata, parent/child IDs and aggregate daily
  attempt counts. No IP addresses, cookies, user agents or visitor identities
  are stored by this Worker.
- Sub-topic IDs combine the normalised parent search terms with the validated
  OpenAlex ID, independently of the display title. The parent is inferred from
  the terms if omitted; a conflicting supplied parent is rejected. If a child
  is requested before its parent, its `parent` is recorded immediately and the
  parent's `children` list is filled when that parent report is saved.
- KV counters and index updates are not globally atomic. Same-isolate operations
  are serialised, but concurrent requests across isolates can overshoot the
  cap or temporarily miss an index update. A later cached search repairs its
  entry. Storage failures return a plain 503 message; failed counter writes
  stop the request before it reaches OpenAlex.

Run all offline checks from the repository root with `node --test`.
