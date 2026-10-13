# JobOS local API

Base URL: `http://127.0.0.1:4317`. Start with Node.js 24 and `npm start` from your normal terminal so Codex can read its existing sign-in. This is a local API, not an endpoint for the current chat or a hosted multi-user service.

## Daily feed

GET /api/opportunities returns {today, timeZone, minimumFit, counts, items}. The same feed is included in GET /api/state. Each item joins the saved job, latest completed ranking and company/CRM contacts. Fields include detectedDay, score (nullable), rankingStatus (current, outdated, pending, description-needed), recommended, technologies, matchedSkills, strengths, gaps, nextStep, emails, recruitmentTeam, website, careersUrl and contact/source status. All stored ranking history is used. Deleted jobs do not appear.

PUT /api/settings persists searchDomains, searchLocation, searchLevel, searchExclude and minimumFit (whole number 0–100; default 70). CV, preference and job fingerprints determine score freshness. Changing the threshold re-filters recommendations without a ranking call; changed matching preferences requeue old scores.

Manual discovery has no result-count quota. Employer research uses sequential batches of six and comparisons use batches of up to ten within 120,000 characters per call. Completed scans expose pendingDescriptions and pendingRankings. The helper logs newly relevant public job details and new contact counts without CV text or pairing tokens. Hourly searching remains disabled.

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

## Codex endpoints

All `/api/codex/*` endpoints require `X-JobOS-Token`, using the pairing token displayed in Settings. They are unavailable to the extension origin. Sign in via `codex login` if the connection check is not ready. `CODEX_BIN` can identify a specific executable path.

- `GET /api/codex/status`: `{ready, message}`. Checks CLI sign-in, without returning credentials.
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

Uses official `codex exec` with a JSON output schema and the CLI's existing authentication. Prompt text goes through stdin rather than shell interpolation. Runs use an isolated working directory, read-only sandbox, disabled shell and multi-agent tools, ephemeral sessions, and no user configuration/plugins. The user-configured model is not explicitly selected; the CLI default is used. Account usage applies. Authentication files are never copied or exposed by JobOS.

CV and selected job text are sent to Codex only on an explicit ranking request. Public contact research is optional. The prompt instructs Codex to search only with employer and role names, never personal CV data. No LinkedIn account passwords, cookies, messages, profile crawling, or job applications are involved.

Contact candidates from web research are independently fetched before display. Only literal emails present on a fetched HTTPS source page are kept; private/reserved network addresses, URL credentials, nonstandard ports, unsafe redirects, oversized responses, and slow sources are blocked. Emails explicitly present in saved descriptions are labeled as such. Publication does not prove recruiter identity, employer affiliation, or deliverability. No message is sent.

## Verification

`npm test` covers mocked Codex runs, schema checks, asynchronous endpoints, authentication, source verification, and file extraction. `node scripts/codex-smoke.js` performs a real ranking using a synthetic CV/job and consumes account usage; it is deliberately separate from the routine test suite.

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

State returns recent tailoring metadata without duplicating full CV/email bodies. Generation is a separate Codex run with web/shell tools disabled. The provider returns plain-text replacements for identified positions in the master; the server rejects commands, duplicate/unknown positions and full-document rewrites, then reconstructs the CV from the unchanged template. New runs expose templateLocked=true. Saving source preserves its supplied whitespace; manual review edits remain possible. PDF compiler failure does not discard the source or email. Failed generations never expose completed artifacts. No email is sent or application submitted.
