# JobOS

A local, single-user job-search workspace. Built with Node.js 24, SQLite, and a lightweight browser interface. Records are stored on this computer. Requested searches and manual rankings send your saved CV and readable job descriptions to Codex through your existing CLI sign-in. Public search queries use preferences and company names, never CV text.

The primary workflow is junior software job discovery → published HR contacts → a CV and email for each opportunity. See [JOBOS.md](JOBOS.md) for the product goal and usage guide. Applications opens in list view with a direct posting link and tailoring action in every row. Both Applications and Daily opportunities default to all saved offers, latest published first; missing source dates appear last. Recently detected and Best CV fit are optional sort orders.

## Start using it

1. Start the server and open the local URL below.
2. Install and pair the Chrome extension using Settings, then capture real job offers with full descriptions.
3. Open **CV & Codex ranking** and upload your PDF, DOCX, or TXT CV (up to 2 MB). Review the extracted text.
4. Click **Check Codex connection**. If needed, run `codex login` in your normal terminal.
5. Select up to 10 jobs, optionally enable public recruiting-email research, then click **Send to Codex & rank**.
6. Read the ranked results, strengths, gaps, suggested next steps, and source-linked contact emails. Scores are fit estimates, not hiring probabilities. No email is sent and no job application is submitted.

## Search now, contacts and tailored applications

In Applications, **Search now** starts the full job-search workflow immediately. It uses your current saved CV, domains and posting window; the hourly schedule is disabled. Searches run only when you ask or click the button. Recent offers use source-confirmed publication dates within the last 30 days by default. With **Broader coverage** enabled, a second pass checks readable older or undated roles and retains them with availability warnings. One Codex workflow runs at a time. Detected email/profile contacts appear on board cards, in the list and in each opportunity's details, with source evidence in the details.

Choose **Tailor CV & email** on a job card or open **CV & email tailoring**. Upload/paste a standalone main.tex or edit the project-root main.tex in VS Code and click Reload saved main.tex. Create from saved CV makes a starter from your uploaded CV text. Master saves keep backups under data/applications/master-backups and refuse to overwrite a file changed on disk since loading it. The private master is excluded from Git.

Select an opportunity with a full description, choose English/French, and review the recipient name/email. Tailor CV & write email uses the existing Codex CLI sign-in. The model returns plain text replacements for existing positions; the app applies them to your original source. The preamble, packages, colors, margins, fonts, spacing, section order, commands, links and table/bullet structure stay intact. It produces a separate main.tex, outreach.txt and review.txt under data/applications/<draft-id>. Review the claims, questions and rendered layout: changing text can change line wrapping. The master is preserved. Email drafts remain editable and unsent.

When a LaTeX compiler is available, main.pdf is built and offered for download. Windows MiKTeX under LOCALAPPDATA is detected automatically; TEX_BIN can specify an executable. PDF builds run without shell execution or automatic package installation. Unavailable/failed builds retain the .tex and email and show the limitation. Standalone source cannot include external files/images or executable TeX commands; ordinary distribution packages must already be installed. Codex's built-in LaTeX editor can also open the .tex for preview.

Save reviewed draft regenerates files/PDF and confirms you checked the draft against the current master, CV text and job. Copy email or Open in mail app uses your edited subject/body. Attach the reviewed CV/PDF yourself; JobOS never sends the email. Update CV & Codex ranking separately when changing the experience used for job scoring.

## Your daily opportunities

Upload and review your CV once in **CV & Codex ranking**, then save your domains, location, experience level and exclusions in **LinkedIn search**. These preferences persist locally and are read for each requested search. **Posted within** supports the last 24 hours, 7 days, 14 days or 30 days as the primary recent window; no result-count quota is imposed. **Broader coverage** is enabled by default and adds a separate pass for older or undated postings requiring availability review. Open **Daily opportunities** for each job's score, required technologies, evidence of fit, gaps, and contact options on one card. Filter today, the last seven days or all saved jobs, and search by company, role or technology. Dates use Africa/Casablanca.

Strong matches default to 70/100; change the threshold on the daily page. Codex estimates fit using demonstrated skills (50%), relevant experience (30%) and requirements (20%). Explicit location, level and exclusion conflicts reduce suitability. Scores are explained estimates, not hiring probabilities. CV, preference or job-detail changes mark scores for refresh. Missing descriptions stay pending rather than receiving invented scores. Job cards use all stored score history.

Contact research checks published recruitment emails, then public HR names/profiles when no email is available, with confirmed employer career pages as a fallback. General business contacts are labeled with an unconfirmed HR role; unrelated merchandise/support/marketing addresses are omitted from the daily feed. Unknown people and addresses remain unknown. Clicking an email opens your mail application; JobOS does not send messages.

A requested scan accepts all qualifying jobs it finds, without a 5/15/20-result cap. It researches employers in batches of six and ranks readable jobs in batches of up to ten within a 120,000-character input budget, processing every batch in the same scan. Failed batches or unreadable descriptions remain explicitly pending. Source refresh currently checks up to three incomplete saved postings; it does not limit newly discovered results. Searches favor new URLs and include readable structured employer job-detail pages alongside public LinkedIn postings. Research also covers previously saved employers, with seven-day cache for a recruitment route and one-day retry for general-only or empty results. Older research is refreshed to apply current checks.

This is manual discovery. Time and source access limit coverage; it is not an exhaustive index or a real-time subscription. Hidden/unreadable descriptions may still need Chrome capture or pasted text. LinkedIn's authenticated Chrome session is not used by the search.

## Manual search and history

The prior hourly schedule is disabled. Ask Codex to search or click **Search now** when you want new results. Save professional domains and the **Posted within** window in **LinkedIn search**. Default targets cover junior software, backend, frontend, full-stack, AI, data, DevOps and QA in Morocco and eligible remote roles.

**Search history & employers** shows requested workflow progress, source-confirmed recent opportunities, required technologies, company industries/websites and recruiting contacts. New jobs go into Applications, CV comparisons into CV & Codex ranking, and public contacts into People. All previously saved offers remain in Applications. Daily opportunities defaults to recent publication dates; use the visible **Also worth checking** buttons for older and undated roles, or **Publication → All saved** for the full history. These records are not guaranteed to remain open. A readable page, Apply button or future application deadline alone is not proof of active hiring.

No timer launches job searches. The saved Codex task is paused, and the old hourly launcher exits without searching. The manual workflow can start JobOS if necessary and uses the existing signed-in Codex CLI. Each requested search consumes account usage. Source access and runtime limits still prevent guaranteed exhaustive coverage.

To run one scan manually:

```powershell
cd "C:\Users\ROG\Pictures\ensias\project\JOB"
node scripts/run-search.js
```

Searches use public LinkedIn and readable employer postings through web search, not the authenticated Chrome session. Public descriptions are extracted directly when accessible; unavailable descriptions require Chrome capture or pasted text before ranking. Recruiting names and roles require accessible source evidence; published business emails are never guessed and deliverability is unverified. Company industry/website research is labeled for review. No outreach is sent.

After extension updates, open `chrome://extensions` and click **Reload** on JobOS, refresh the LinkedIn job page, then capture again. Version 0.2.0 supports semantic headings in newer layouts, skips global notification headings, retries during loading, and shows missing-field messages above the form.

Codex integration uses a separate official CLI run, not an API into the current chat. For endpoint details and data handling, see [API.md](API.md). Run JobOS from a normal signed-in terminal so the process can access Codex authentication.

## Start

```powershell
npm ci
npm start
```

Open http://127.0.0.1:4317. Node.js 24 or newer is required. The server listens only on the loopback interface. Keep it running while using the app or extension. To stop it, press Ctrl+C in its terminal. SQLite's experimental warning on Node 24 is expected.

## What works

- Applications: create, edit, search, filter, delete, and move through Saved → Applied → Screening → Interview → Offer → Closed. Board and list views share the same records.
- Job details: company, location, compensation, posting URL, description, and notes.
- Contacts: recruiter, hiring-manager, referral, and other contact information and notes.
- Follow-ups: dated reminders linked to jobs, overdue indicators, completion and reopening.
- Discovery: user-triggered Chrome capture, LinkedIn alert-email imports, optional automatic IMAP checks, URL deduplication, and keyword/location/exclusion preferences.
- Career studio: a local keyword comparison and editable outreach templates. These are **not AI outputs**.
- CV & Codex ranking: PDF/DOCX/TXT upload, explained AI rankings, and optional public recruiting-email research with independently checked source pages. No LetsMCP service is required.
- Settings: pairing token, profile, optional browser notifications, and JSON export.

The initial workspace is intentionally empty. No fabricated opportunities or job-search statistics are seeded.

## Chrome extension

1. Open Chrome's extension manager (`chrome://extensions`).
2. Enable Developer mode, click **Load unpacked**, and select this project's `extension` folder.
3. In JobOS → Settings, copy the pairing token.
4. Open the extension's **Connection settings**, leave the address as `http://127.0.0.1:4317`, paste the token, and save the connection.
5. Open a specific LinkedIn job, then click the extension. Review/correct the captured fields and click **Save opportunity**.

The extension runs only when you invoke it. It supports job detail pages and selected jobs in LinkedIn search, with structured JobPosting metadata as a fallback. Missing fields remain editable. LinkedIn changes its markup, so extraction is best-effort. Chrome installation and a live authenticated LinkedIn capture still need a user-side smoke test.

LinkedIn prohibits third-party extensions that scrape its pages; using extraction on LinkedIn carries account-policy risk. See https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions. The email workflow does not automate LinkedIn browsing.

## New-offer detection from LinkedIn alerts

1. In **Discover & alerts**, save your preferences and open LinkedIn search.
2. On LinkedIn, create a job alert and enable email delivery.
3. Either download an alert email as `.eml` and import it, or configure automatic mailbox checking below.

Email imports extract **direct LinkedIn job URLs and linked titles**. They do not invent company, location, or description details that cannot be reliably attributed to a specific job. Those fields may require editing. Capturing the same job with the extension enriches the imported record while preserving its stage and notes. Plain pasted URLs produce an opportunity that needs review. Tracking-only redirect links without a job ID are not followed; capture those jobs manually instead.

Matching uses case-insensitive substring rules: any keyword AND any location AND no excluded term. Empty filters are unrestricted. Filters apply when a job is created or edited; changing preferences alone does not rewrite historical alerts. Email jobs with no location will not pass a location filter, so leave it blank for email-title matching and narrow your search on LinkedIn itself. All imported jobs remain in Applications even if they do not match. No matching score or ranking is inferred from an email containing several jobs.

### Optional automatic mailbox checks

Copy `.env.example` to `.env`, enter your mailbox's IMAP configuration, and restart the server:

```dotenv
IMAP_HOST=imap.your-provider.com
IMAP_PORT=993
IMAP_USER=you@example.com
IMAP_PASSWORD=your-app-password
IMAP_FOLDER=INBOX
```

Use a provider-supported app password. Providers requiring OAuth-only authentication are not supported yet. Secrets belong in `.env`, never in source control or chat. IMAP uses TLS and opens the folder read-only; it does not mark messages read or send email.

The server checks at startup and every five minutes. It scans at most the latest 100 messages from a LinkedIn sender within the last seven days, skips messages larger than 1 MB, and deduplicates opportunities by canonical URL. Sender filtering is a convenience, not authentication of an email. No links in messages are fetched. Errors are shown in the workspace. The computer and Node process must stay on; this is not an always-on hosted service.

### Notifications

The workspace shows matching alerts and overdue follow-ups. Optional browser notifications run every 30 seconds **while a JobOS page is open** and permission is granted. Each reminder/match notifies once per browser profile. They are not OS-scheduled alarms and will not fire after the app is closed. Mailbox ingestion can continue with the page closed if the server stays running.

## Data and security boundaries

- SQLite database: `data/jobos.sqlite` (created on first start). Settings and pairing identity persist across restarts.
- Back up the database after stopping the server, or use **Export workspace** for JSON. JSON export is an archive; an in-app restore workflow is not included.
- The local database is not encrypted. Protect it with your device account and disk encryption as appropriate.
- The extension stores its pairing token in Chrome's local extension storage. Tokens are excluded from JSON exports.
- The server checks Host and Origin, serves only an explicit static-file allowlist, and limits extension requests to the token-protected capture route.
- Designed for one trusted local user. Do not expose this server publicly; it has no multi-user authentication.

## Development and checks

```powershell
npm run dev
npm run check
npm test
npm audit --omit=dev
```

Tests use isolated databases and synthetic email/LinkedIn fixtures. See `TESTING.md` for verification coverage and remaining live-integration checks.

Files: `server.js` (HTTP API), `lib/` (database, matching, MIME/IMAP), `public/` (interface), `extension/` (Chrome MV3), `test/` (automated tests).
