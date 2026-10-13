# JobOS local API

Base URL: `http://127.0.0.1:4317`. Start with Node.js 24 and `npm start`. When Codex is selected, use your normal terminal so it can read its existing sign-in. This is a local API, not an endpoint for the current chat or a hosted multi-user service. The saved AI provider supplies generation; `/api/codex/*` workflow paths remain for compatibility and dispatch to that provider.

## AI providers and private credentials

All `/api/ai/*` routes require `X-JobOS-Token` and reject Chrome extension origins. Settings support `codex`, `ollama`, `gemini`, `kimi` and `compatible`. The UI is `/#models`; [AI-MODELS.md](AI-MODELS.md) covers setup.

- `GET /api/ai/config`: public configuration, provider presets/label and API-key status (`configured`, `source`). Never returns secret values.
- `PUT /api/ai/config`: `{expectedRevision?, provider, model, baseUrl, contextTokens, searchProvider, searchModel, keys?, clearKeys?}`. Saves the selected provider's profile and shared search settings; existing profiles are retained. Returns public configuration with a non-secret `revision` hash. Browser requests must send the form's loaded revision; outdated forms return HTTP 409 without changing models or credentials. Local scripts without an Origin header retain compatibility, but should also pass the revision from `GET /api/ai/config`. HTTP 409 also applies while a workflow/download/test is active. Empty key values preserve existing keys; `clearKeys` removes only saved keys, not `.env` fallback keys.
- `GET /api/ai/models`: `{models:["model-id"]}` from the selected provider. Codex returns an empty catalog. This reads model metadata without sending CVs or starting job discovery.
- `POST /api/ai/test`: `{}`. Returns `{ready,message,provider,model,providerLabel}`. Alternative providers receive a tiny synthetic JSON prompt; no CV/job data. Codex checks CLI sign-in only. Shares the active-workflow guard. HTTP 200 with `ready:false` reports a connection/configuration issue; a positive result is not a search-quota guarantee.
- `POST /api/ai/search-test`: `{expectedRevision?}`. Tests the selected live search source with a public Node.js documentation query, or a generic junior-software listing query for public LinkedIn; no CV, candidate information or saved job text is passed. Public/Brave probes read the first page only. Returns `{ready,message,searchProvider,searchModel,searchSuggestions?}` without saving jobs, rankings or scan reports. Gemini requires grounding evidence; empty/unusable sources fail the test. A LinkedIn listing test does not establish employer/contact search access. Uses the active-workflow guard. Codex uses built-in search and has no separate search-service test. Both test endpoints reject a supplied outdated revision with HTTP 409.
- `POST /api/ai/local/setup`: `{}`. Returns HTTP 202 `{id,status}`. Explicitly installs/starts the official portable Windows Ollama runtime if needed and downloads the saved Ollama-profile model. Progress is available in `GET /api/state → modelDownloads[0]`. Does not switch providers or start a job search. Uses local `http://127.0.0.1:11434`, SHA-256-verified official release bytes and ignored `data/ollama/` storage; reuses already running Ollama. Shares the active-workflow guard.

`keys` names are `gemini`, `kimi`, `compatible`, `ollamaSearch` and `brave`; environment fallbacks are `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `AI_API_KEY`, `OLLAMA_API_KEY` and `BRAVE_API_KEY`. App-entered secrets live in ignored `data/ai-credentials.json`, separately from SQLite. They are unencrypted local secrets and excluded from state, responses and exports. Raw provider error bodies are not exposed. Test fixtures use synthetic keys only.

Local Ollama generation uses the native chat endpoint, strict JSON schema output and configurable context (8,192–131,072 tokens, default 32,768). Gemini uses structured JSON generation with `generationConfig.responseFormat.text.mimeType: "APPLICATION_JSON"` (the REST enum, not a MIME string) and the JSON schema. Gemini generation/search default to `gemini-3.6-flash`; model catalog entries do not guarantee account access. Kimi/compatible servers use chat completions with JSON mode and local schema validation. Model URLs are validated; Ollama is loopback-only, hosted custom endpoints must use public HTTPS, and requests reject redirects. Invalid/truncated outputs are rejected. Hosted providers receive CV/job inputs on explicit generation requests; local inputs stay with the loopback model server. No silent fallback occurs. HTTP 5xx errors are reported as temporary provider service failures rather than configuration failures.

Ollama generation uses an internal NDJSON stream with a 20-minute request deadline, a two-megabyte response ceiling and strict final completion/schema checks. UTF-8 fragments are decoded across chunk boundaries; partial data and raw provider errors are never stored or logged. Timeout and interrupted-connection messages are distinct. Hosted generation retains its five-minute deadline. Source discovery for Ollama extracts posting facts directly from readable markup/JobPosting data and verifies them against the retrieved page before policy filtering; it makes no generation request to copy descriptions. Local employer research uses one source per model call, and scan CV comparisons use one job per call, processing all eligible batches without a result-count cap.

`searchProvider` is `none`, `linkedin`, `public`, `gemini`, `ollama` or `brave`. Codex uses built-in search independently. `linkedin` reads public LinkedIn listing pages for LinkedIn queries and DuckDuckGo HTML results for employer/contact queries, without keys or authenticated browsing. `public` uses DuckDuckGo alone without a key. Both paginate readable results sequentially with pacing, canonical URL deduplication and a two-minute per-query budget. Blocks/challenges are reported and never bypassed; saved partial sources survive, and that source is not requested again within the same workflow. Other public sources can still be processed. Hosted search sources require their own keys. Local ranking/tailoring work with `none`. Gemini search requires grounding evidence, and its suggestions are retained for display. Brave pagination is sequential while additional pages are available, within its API pagination ceiling. Ollama web search has its provider's per-query result cap. The app imposes no fixed total job count and covers all saved domains with multiple queries. Independent source/date/closure checks remain authoritative; public listing dates and engine freshness filters do not replace direct posting evidence. API/local discovery uses a 25-minute query-loop budget; current requests/source checks may extend total runtime. Warnings describe incomplete coverage.

Discovery stops issuing further hosted provider queries after HTTP 400/401/403/404/429 or 5xx instead of repeating the same failing request across every domain and coverage pass. A blocked public website is cached as unavailable for that workflow without preventing another explicitly configured public source from returning readable jobs. Successful partial results are retained. A failed scan remains historical evidence after settings change; it is not automatically rerun or erased. The model test and live-search test are separate because a working generation key does not establish Google Search quota/access.

Large runtime downloads use four range connections, retain completed segments for resumption, and verify the entire release SHA-256 before extraction/execution. A sequential partial download can seed complete segments; the final checksum remains mandatory. Model downloads are handled by Ollama's resumable pull. See [LOCAL-SETUP.md](LOCAL-SETUP.md) for the automatic and manual local workflow.

All new search, scan, ranking and tailoring runs retain `provider`, `model` and `providerLabel`. Changing models does not change old reports or automatically rerank saved jobs. Interrupted model-download metadata is marked failed on server restart; already installed portable Ollama can be restarted without downloading during a later connection check.

## Daily feed

GET /api/opportunities returns {today, timeZone, minimumFit, counts, items}. The same feed is included in GET /api/state. Each item joins the saved job, latest completed ranking and company/CRM contacts. Fields include detectedDay, score (nullable), rankingStatus (current, outdated, pending, description-needed), recommended, technologies, matchedSkills, strengths, gaps, nextStep, emails, recruitmentTeam, website, careersUrl and contact/source status. All stored ranking history is used. Deleted jobs do not appear.

PUT /api/settings persists searchDomains, searchLocation, searchLevel, searchExclude and minimumFit (whole number 0–100; default 70). CV, preference and job fingerprints determine score freshness. Changing the threshold re-filters recommendations without a ranking call; changed matching preferences requeue old scores.

Manual discovery has no result-count quota. Employer research uses sequential batches of six and comparisons use batches of up to ten within 120,000 characters per call for hosted providers. Ollama's per-batch budget is derived from its context setting; oversized generation inputs are rejected instead of truncated. Completed scans expose pendingDescriptions and pendingRankings. The helper logs newly relevant public job details and new contact counts without CV text or pairing tokens. Hourly searching remains disabled.

## Deleted-posting memory

`DELETE /api/jobs/:id` removes the offer and its reminders/alerts in a transaction and stores `{id, url, deletedAt}` under `dismissedJobs` when it has a posting URL. `id` is a hash of the canonical URL. LinkedIn URL variants resolve to the same numeric posting ID. `GET /api/state` includes `dismissedJobUrls`; workspace exports include `dismissedJobs` so backups retain the memory.

Ingestion through `POST /api/jobs`, `/api/capture`, historical search-result saves and email imports cannot recreate a remembered deleted posting. Individual save/capture requests return HTTP 200 with `{job:null, created:false, skipped:true, reason}`. Email imports do not count ignored postings as newly imported. Changing another saved offer's URL to a dismissed posting returns HTTP 409. Searches receive `excludedUrls`; results are also checked locally rather than relying on the provider to honor exclusions. Running scans check current deletion memory before ingestion and ranking. Closed saved offers retain their existing ID, stage and notes during rediscovery; only an explicit stage edit can reopen them.

Deletion memory begins with deletions after this update and persists in the local SQLite database. No URL-less or speculative company/title identity matching is performed. Publication filters in Applications and Daily use source dates, never detection dates, and support 24 hours, 7, 14 and 30 days, All saved and Date unconfirmed.

## CV upload

`POST /api/resume`, JSON body:

```json
{"filename":"cv.pdf","contentBase64":"BASE64_FILE_CONTENT"}
```

Supports PDF with selectable text, DOCX, and UTF-8 TXT, up to 2 MB. Returns `filename`, extracted `text`, and `characters`. Saves only the text and filename. No OCR. Review the extraction in the UI before analysis.

You can also save text with `PUT /api/settings` and `{"resume":"YOUR CV TEXT"}`.

## Generation endpoints (legacy Codex paths)

All `/api/codex/*` endpoints require `X-JobOS-Token`, using the pairing token displayed in Settings. They are unavailable to the extension origin. They use the selected backend. For Codex, sign in via `codex login` if the connection check is not ready; `CODEX_BIN` can identify a specific executable path. Other providers use saved AI settings without invoking the CLI.

- `GET /api/codex/status`: `{ready, message, provider, model, providerLabel}`. Checks selected-provider configuration/local-model availability or Codex CLI sign-in, without returning credentials. Use `/api/ai/test` for a synthetic generation test of alternative providers.
- `POST /api/codex/rank`: starts an asynchronous run; returns HTTP 202 with `{id, status}`.
- `GET /api/codex/rank/:id`: returns `running`, `completed`, or `failed`, with a report or actionable error.

Ranking request:

```json
{"jobIds":["SAVED_JOB_ID"],"researchContacts":true}
```

Select 1–10 distinct saved jobs. Each needs at least 40 characters of description. The saved CV must have at least 40 characters. Total CV and description input is capped at 120,000 characters. One run can be active at a time; concurrent starts return 409. Failed sign-in returns 503. Invalid input returns 400. Runs interrupted by a server restart are marked failed.

Completed response includes `summary` and `rankings` sorted by descending score. Each result contains `jobId`, `title`, `company`, `score`, `fit`, `strengths`, `gaps`, `nextStep`, and `contacts`. A contact includes its `email`, `sourceUrl`, and evidence status. Scores are qualitative fit estimates, not ATS scores or hiring probabilities. Results are snapshots; re-run after changing the CV or job.

PowerShell example (run with JobOS already started):

```powershell
$jobosBase = 'http://127.0.0.1:4317'
$jobosState = Invoke-RestMethod "$jobosBase/api/state"
$jobosHeaders = @{ 'X-JobOS-Token' = $jobosState.settings.token }
$jobosJobs = @($jobosState.jobs | Where-Object { $_.description.Length -ge 40 } | Select-Object -First 10)
$jobosBody = @{ jobIds = @($jobosJobs.id); researchContacts = $true } | ConvertTo-Json
$jobosRun = Invoke-RestMethod "$jobosBase/api/codex/rank" -Method Post -Headers $jobosHeaders -ContentType 'application/json' -Body $jobosBody
Invoke-RestMethod "$jobosBase/api/codex/rank/$($jobosRun.id)" -Headers $jobosHeaders
```

## What the Codex connection does

When Codex is selected, uses official `codex exec` with a JSON output schema and the CLI's existing authentication. Prompt text goes through stdin rather than shell interpolation. Runs use an isolated working directory, read-only sandbox, disabled shell and multi-agent tools, ephemeral sessions, and no user configuration/plugins. A blank Codex model uses the CLI default; a saved model ID is passed explicitly. Account usage applies. Authentication files are never copied or exposed by JobOS. Alternative providers use their own transport and do not invoke this CLI.

CV and selected job text are supplied to the selected model only on an explicit generation request, including the comparison step of a requested scan. Public contact research is optional for ranking. API/local contact research builds separate public company/role queries; no CV is passed to web search. Codex receives the same prohibition against personal CV queries. No LinkedIn account passwords, cookies, messages, profile crawling, or job applications are involved.

Contact candidates from web research are independently fetched before display. Only literal emails present on a fetched HTTPS source page are kept; private/reserved network addresses, URL credentials, nonstandard ports, unsafe redirects, oversized responses, and slow sources are blocked. Emails explicitly present in saved descriptions are labeled as such. Publication does not prove recruiter identity, employer affiliation, or deliverability. No message is sent.

## Verification

`npm test` covers mocked Codex/API/local generation, provider selection/key privacy, schema and template checks, search pagination/grounding, asynchronous endpoints, authentication, source verification, verified portable setup/download progress and file extraction. `node scripts/codex-smoke.js` performs a real Codex ranking using a synthetic CV/job and consumes account usage; it is deliberately separate from the routine test suite. See `TESTING.md` for paid/local integrations not yet exercised live.

## Discovery and automation

- `POST /api/codex/search`: `{domains, location, level, exclude, maxAgeDays, includeReview}` starts manual public LinkedIn discovery. Domains are comma-separated professional fields; 1–8 domains are supported. `maxAgeDays` is 1–30 (default 30). The legacy `limit` field is ignored; returned job counts are not capped. Recent results must match saved domains and have a source-confirmed publication date in the requested window. `includeReview` defaults to true: a second sequential provider pass retains readable older/undated job details for availability review. False requests recent-only discovery. Closure notices/expired deadlines exclude new roles; inaccessible or unsupported supplemental pages are excluded. Partial pass failures return warnings while preserving successful results. No CV is passed to search.
- `GET /api/codex/search/:id`: reads search status and source-linked results.
- `POST /api/codex/search/:id/save`: `{index}` saves a result to Applications with URL deduplication.
- `POST /api/codex/scan`: starts the complete manually requested workflow using current saved preferences/CV and posting window.
- `GET /api/codex/scan/:id`: reads progress and scan summary.

These require the same `X-JobOS-Token`. Search, ranking, and automation share a single-run guard. Scans save new offers, skip potentially closed listings, research every uncached employer sequentially in batches of six, verify public team/contact evidence, and compare every eligible unranked description in sequential batches of up to ten within the per-call input budget. Partial failures preserve saved jobs and appear as warnings. The UI reads companies/scans from `/api/state`. Jobs preserve `discoveryBucket` (recent, older-review or undated-review), `availabilityStatus` and source-backed `availabilityEvidence`. Feed items expose publication categories and review counts; changed source availability/details mark prior comparisons stale without erasing notes. `searchIncludeReview` persists the broader-coverage setting.

`node scripts/run-search.js` manually orchestrates a scan and polls completion. It starts the server with a hidden Node process if unavailable. The prior `jobos-hourly-job-search` schedule is paused. `scripts/run-hourly.js` is a disabled compatibility entry point and never starts a search. There is no browser timer that launches scans.

## Tailored CV and email packages

All routes below require X-JobOS-Token. CV source is a private, standalone project-root main.tex.

- GET /api/codex/cv-source: source, hash, exists and filename.
- PUT /api/codex/cv-source: {source, expectedHash}; validates single-file LaTeX, backs up prior source, returns 409 after conflicting on-disk changes.
- POST /api/codex/cv-source/starter: creates from saved CV text only if no master exists.
- POST /api/codex/tailor: {jobId, language: English or French, recipientEmail?, recipientName?}; returns 202 with id/status. Requires a readable saved job and master CV; combined input capped at 160,000 characters. Uses the shared search/ranking/scan guard.
- GET /api/codex/tailor/:id: run, source, email, change notes/questions, files, compilation state and stale flag.
- PUT /api/codex/tailor/:id: {latex?, email:{subject,body}?, recipientEmail?, confirmCurrentInputs?}; updates editable artifacts and rebuilds PDF. confirmCurrentInputs=true records human review against current master/CV/job fingerprints.
- GET /api/codex/tailor/:id/files/:filename: token-protected download of main.tex, outreach.txt, review.txt or successfully built main.pdf. The PDF is served as application/pdf. Other paths are rejected.

State returns recent tailoring metadata without duplicating full CV/email bodies. Generation uses the selected model without web/shell tools; Codex uses a separate restricted CLI run. The provider returns plain-text replacements for identified positions in the master; the server rejects commands, duplicate/unknown positions and full-document rewrites, then reconstructs the CV from the unchanged template. New runs expose templateLocked=true. Saving source preserves its supplied whitespace; manual review edits remain possible. PDF compiler failure does not discard the source or email. Failed generations never expose completed artifacts. No email is sent or application submitted.
