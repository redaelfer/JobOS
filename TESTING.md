# Verification

Latest local result: 90 automated tests passed; JavaScript syntax checks passed. The prior dependency audit reported no known vulnerabilities; no npm dependencies changed in this update.

Codex update: PDF/DOCX/TXT extraction tested with synthetic documents; token-protected background ranking API and provider failure behavior tested; public source address checks and email evidence verification tested. A real Codex CLI run using a synthetic CV and synthetic job completed successfully. The browser connection check also confirmed that the running server can access the signed-in CLI. The current saved CV has since been used in authorized live rankings and hourly scans. Live source-backed email and public HR-profile research has completed successfully. No CV text or token is recorded in test output.

Discovery update: real Codex web search returned three LinkedIn data-engineering postings in Morocco. Independent page checks confirmed title/company for two and marked one as possibly closed. New LinkedIn layout fixtures cover h2 titles, French sections, selected detail isolation, and rejecting “0 notifications” as a title. A user-saved Orange Business job with that incorrect title was corrected to Data Engineer.

Automation tests cover new-job saves, closed-job exclusion, technology extraction, CV ranking, company caching, avoiding repeated ranks, partial failures, contact/role evidence, token protection and API persistence. Browser inspection verified the running hourly dashboard. The first real workflow completed against the user's saved CV and preferences: five new jobs saved, five employers researched, and a CV ranking persisted with no step failures. It preserves source limitations, including uncertain location eligibility and unknown compensation. The hourly Codex heartbeat was active during that historical check; it is now paused and the legacy launcher is disabled.

Daily feed update: unit and integration tests verify Moroccan date boundaries, today/week/all filters, score freshness after CV/domain/job changes, fit thresholds, all-history score lookup, missing-description states, source-backed career links, unrelated-contact filtering, affiliation evidence, hydration backoff, closed saved-job updates, ranking input budgets and duplicate-server startup protection. Browser verification covers daily search, filters, evidence expansion and automatic progress refresh. The first updated live scan saved two additional offers, researched three employers and completed seven CV comparisons without warnings. The final source-refresh/contact-filtering live scan completed without warnings: ten saved jobs, ten current scores, five strong matches at 70/100, two public recruiting profiles and no pending descriptions/rankings. Browser tests verified role/company search, strong-match filtering, score-details expansion, saving the match threshold, and source-linked HR contacts; browser error logs were empty. Screenshot: test-results/screenshots/daily-opportunities.jpg.

Tailoring update: isolated tests cover CV source authentication, standalone/unsafe command validation, optimistic file conflict checks and backups, master preservation, per-job files, edited email persistence, stale/reviewed fingerprints, unavailable providers, single-run guards, PDF header validation, stale PDF removal and authenticated PDF downloads. A real Artefact draft was generated through the browser and compiled using installed MiKTeX. Both A4 pages were rendered and visually reviewed; a split project paragraph was moved to the second page and link boxes were removed. The built-in compiler failed with a platform-directory error; the installed compiler fallback succeeds. The Applications Search now button started a real scan immediately and completed with one new saved offer, one employer researched, zero warnings and no pending descriptions or rankings. Application cards, the list contact column and draft controls were verified in the browser; error logs were empty. The PDF download API returns the verified PDF bytes; this in-app browser did not expose a download event for the blob button, so saving through a normal browser remains a manual check. Screenshot: test-results/screenshots/applications-contacts.png.

## Automated tests

Junior software workflow update (2026-10-08): Applications defaults to list view, every saved offer has a safe posting link and direct tailoring action, and Applications/Daily support latest-publication, recent-detection and current-fit sorting. Tests cover ISO dates and English/French/Arabic relative publication ages, missing dates, retaining lower-fit/older opportunities in the all view, safe links, and source escaping. The browser confirmed list default, 19 rows/links, both sort changes, row-to-tailoring navigation, and a 28-row master editor measuring about 541 × 543 pixels in the current viewport. Screenshot capture was unavailable in the in-app browser, so no new UI screenshot is claimed. The prior screenshots predate this update.

The supplied main.tex was saved byte-for-byte with a previous-source backup. New tests verify that text replacements leave all other source bytes unchanged and reject unknown/duplicate text positions, injected commands and full-document rewrites. A real French Capgemini CV was generated through the updated UI, compiled to one A4 page and visually reviewed against the exact one-page master. Both the preamble and command sequence are identical; the master still matches the supplied attachment exactly. The installed compiler needed titlesec, fontawesome5, babel-french and carlisle; those packages were installed without changing the source. The built-in compiler still reports a platform-directory error; the installed MiKTeX fallback succeeds. The verified CV is saved at output/pdf/capgemini-cv-template.pdf.

The latest hourly search used all eight saved domains, saved five additional offers and seven contacts with zero warnings. Nine comparisons made stale by the broader preferences were refreshed separately; all 19 saved offers now have current scores and no pending comparisons. Public email delivery, employment affiliation and vacancy availability remain unverified beyond the retained evidence.

Run `npm test` and `npm run check`. Tests cover:

- Canonical LinkedIn URLs, duplicate captures, invalid/malicious URLs and required fields.
- All application stages, partial updates, notes, deletes, and duplicate edit conflicts.
- Keyword/location/exclusion rules and alert read status.
- Contacts, reminder dates, completion/reopening, related-record cleanup.
- SQLite durability across reopening, including pairing-token persistence.
- Token-protected capture, extension-origin restrictions, arbitrary-origin/Host rejection, export token exclusion.
- Static routes, content-security policy, invalid JSON and unsupported content types.
- HTML and plain-text emails, MIME quoted-printable decoding, title extraction, duplicate job links, lookalike hosts, and avoiding cross-job keyword contamination.
- IMAP configuration failure and simulated TLS/read-only polling, UID selection, message count/size limits, and cleanup on connection failure.
- LinkedIn authenticated/public-page DOM fixtures, structured-data fallback, malformed metadata, invalid page/host rejection, and manifest permissions.
- Resume skill boundaries, matched/missing keywords, score calculation, and no-score behavior when no known skills are found.

## Browser verification

Performed in the Codex in-app browser with disposable QA records:

- Create a job, reload it, switch to list view, change its stage to Interview, verify counters.
- Create a linked overdue follow-up, view it, mark it complete.
- Create a contact and verify it appears.
- Compare a resume: React, TypeScript, SQL found; Docker missing; expected 75% coverage.
- Generate an editable outreach draft from the selected job and entered experience.
- Save matching preferences; import a synthetic LinkedIn email; verify a matching alert.
- Attempt a mailbox check without configuration and verify actionable setup feedback.
- Search opportunities and filter by stage; inspect mobile and desktop layouts.
- Save a profile and download a JSON export through the browser.

Disposable QA records were removed after verification. A screenshot of the populated QA board is saved in `test-results/screenshots/desktop-qa.jpg`.

## Requires user configuration / not verified live

- Installing the unpacked extension in Chrome and extracting from the user's live LinkedIn account. Automated extraction fixtures do not guarantee compatibility with every LinkedIn page variant.
- Connecting to a real mailbox with the user's credentials and receiving a real LinkedIn email. The IMAP adapter is tested with a simulated client.
- OS/browser notification delivery; permission is not granted automatically. Notification timing requires the page to remain open.

No authenticated LinkedIn crawling, application submission, email sending, or mailbox access was performed during tests. Public searches, saved-CV rankings and the Artefact tailoring workflow were exercised live with the user's authorization; isolated automated tests use synthetic data.

## Manual search and recent-publication update — 2026-10-08

The former hourly task's saved status is PAUSED. The legacy run-hourly.js entry point reports skipped and performs no network/server/search work. JobOS scheduling metadata is cleared to Manual only; all 28 saved offers are preserved. The supported manual command is node scripts/run-search.js.

Verification covers 25 accepted discovery results with no quota; exclusion of four-month-old, unknown-date, future and unrelated-domain results; confirmation of displayed/structured publication dates rather than AI/index ages; multilingual relative ages; research of more than six employers; every comparison batch for more than ten jobs; the 120,000-character per-call input budget; and preservation of historical records/scores. A real HTTP scan API test persisted 25 synthetic offers and current comparisons across three batches. Actual app.js handlers were tested in an isolated JSDOM runtime: no search starts on page load, Save domains persists the posting window, manual submit has no limit/CV query fields, Search now triggers one requested scan, and the feed defaults to recent postings with All saved/Date unconfirmed views available.

Live browser visual verification could not run: the connected-surface inventory is empty and the in-app browser provider reports unavailable. No live search was initiated merely to test the new UI. Existing source links, employer affiliation, vacancy availability and email delivery remain subject to review. Source-relative dates/repost ages are approximate. No result-count cap is imposed, but provider runtime, output and public source access still bound search coverage.

Final validation: 101 isolated tests passed (0 failures); npm run check passed. The application server was restarted to load the updated search policy. The running API retains 28 user offers and reports Manual only with a 30-day publication window.

## Broader coverage with recent-first results — 2026-10-08

This supersedes the recent-only default described in the preceding update. The primary window remains 30 days. Broader coverage is enabled by default and performs a second sequential pass for older/undated direct postings with currently readable, source-confirmed title/company and a full description. Unsupported, closed, expired and future-dated entries are excluded. Supplemental records have explicit availability warnings; an Apply control or future deadline is not treated as proof of active hiring. Recent-only discovery remains available by disabling the checkbox. The hourly task and legacy launcher remain disabled.

New isolated checks cover three result categories, source/closure evidence, sequential provider calls, deduplication, preservation of successful results when either pass fails, checkbox persistence including explicit false, availability metadata and score freshness, and actual frontend review buttons. The review panel appears before the main list so older and undated records are visible without scrolling past every recent card. Existing CV templates, contacts, notes and saved records remain intact. Live browser verification remains unavailable in this session; actual app event handlers are exercised through the isolated JSDOM tests. No live job scan is started merely to verify the feature.

Broader-coverage validation: 109 tests passed with zero failures; npm run check passed. The connected browser remains unavailable, so visual layout is unverified. Sequential provider calls and client review controls were verified with isolated fixtures.

## Clear background workflow status — 2026-10-08

Every page now shows the active workflow name, current step, elapsed minutes and last successful status check. Completion, failures and loss of the local server connection are explicit; a read-only Refresh status action preserves edited forms. All Codex start controls share the busy/connection guard. State requests time out after ten seconds, periodic polling does not overlap, and connection recovery is retried without starting a new search. Provider reasoning, CV contents and credentials are not streamed to the status panel or logs.

The actual app.js handlers were exercised in JSDOM for a 13-minute scan, completion while an input remains focused, failed/recovered status polling, shared workflow blocking, read-only manual refresh without losing edits, and safe display of failed CV drafts. All 113 isolated tests passed; npm run check passed. Live HTTP checks confirm the running server serves the updated JavaScript and styles. The user-requested scan completed in approximately 13 minutes with eight new offers, five researched employers, no scan warnings and no remaining CV comparisons. The local state has 34 saved offers and no running workflows; no new live search was started for this change.

Visual browser verification was attempted through Computer Use, but the connected surface inventory is empty and the in-app browser reports unavailable. The status layout remains visually unverified. Refresh the browser to load the updated client; the server does not need restarting for these static-file changes.

## Deleted/closed offer deduplication and publication windows — 2026-10-08

Deleted posting URLs are now remembered in the ignored local SQLite database. The offer, reminders and alerts are removed transactionally, while the minimal URL/deletion timestamp record persists. Tests cover canonical LinkedIn ID variants, employer tracking URL variants, app restart persistence, capture, email imports, historical result saves, conflicting URL edits, provider-returned excluded results, and deletion while a scan awaits its provider. Deleted offers do not return to the feed or ranking queue. Rediscovered closed offers keep their ID, stage and notes, without becoming new results or triggering comparison/research; distinct posting IDs with identical title/company are still accepted.

Applications has a Publication dropdown with All saved (default), 24-hour/7/14/30-day windows and Date unconfirmed. Daily has the same explicit windows alongside its saved search window and review categories. Isolated tests exercise source-date boundaries, relative dates, unknown/future dates, publication versus detection, list/board transitions, combined stage filters and read-only frontend interactions. Previously deleted historical search cards have no Save action.

All 124 isolated tests passed (zero failures); npm run check passed. The idle local server was restarted in the normal environment without initiating a search. Live HTTP checks confirm deletion-memory support and the new publication filter are served; all 35 offers, contacts, reminders, alerts, preferences and saved CV were preserved across restart. Browser verification was attempted through Computer Use, but no connected browser/app surface is available; layout remains visually unverified.

Limits: deleted offers from before this change cannot be reliably reconstructed; records without a URL have no durable posting identity. Distinct repost IDs or LinkedIn/employer URLs are not merged by speculative title/company matching. Unknown source dates remain visible through All saved/Date unconfirmed, and relative dates remain approximate. No job search, email send or application submission was performed for verification.
