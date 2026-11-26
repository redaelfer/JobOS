# JobOS

The [separate FreeLLMAPI app](FREELLMAPI.md) has its own gateway, private state and Codex/Claude Code launch commands. It lives at `../freellmapi`, beside `JOB`. Open it as its own VS Code folder. Select **Configure FreeLLMAPI** inside JobOS to use the same gateway for app workflows.

Optional [FreeLLMAPI gateway and coding launchers](FREELLMAPI.md) connect downloaded Ollama to JobOS, Codex CLI and Claude Code without replacing your normal sign-ins. Local generation is the default gateway route; cloud model selection and keys remain explicit. See the guide for tested compatibility limits.

A local, single-user job-search workspace. Built with Node.js 24, SQLite, and a lightweight browser interface. Records are stored on this computer. New workspaces use local Ollama and key-free public search. In **AI models**, use downloaded Ollama with local SearXNG, or choose Groq, free OpenRouter models, Gemini, Kimi, Codex or a compatible server. Add and switch API keys in the app. Ranking and tailoring send CV/job text to that chosen model; Ollama uses the local server. Public search queries use preferences and company names, never CV text. See [LOCAL-AI-WORKFLOW.md](LOCAL-AI-WORKFLOW.md) for local setup, optional free APIs and recovery.

**No coding assistant required:** use **Help & local setup** in the sidebar or keep [USER-GUIDE.md](USER-GUIDE.md). The app includes a dedicated model-download form and installed-model selector. Windows users can start with `START-JOBOS.cmd`; `npm run doctor` diagnoses local services, and `npm run model:download -- qwen3:4b` downloads through the running app without a coding-model account.

For generation without hosted AI quotas, download Qwen3 in **AI models**, then choose **Use local model + public search**. This uses local Ollama and public LinkedIn/web sources without an API key. Computer resources and website access still limit it. [LOCAL-SETUP.md](LOCAL-SETUP.md) includes automatic setup, restart/resume steps and a manual fallback.

## Start using it

1. In **Settings → Search preferences**, save your domains, experience level, location and date window once. A new workspace starts with data science, ML, AI engineering, full-stack and data engineering; graduate/entry level; Morocco and eligible remote roles; and 30 days. Existing preferences are kept.
2. Open **Offers** and click **Search now**. No CV is needed and searches are manual. Verified batches appear as they arrive. Choose **New in last search** to isolate what was actually added. If a source fails, retry just that source; its results join the original search. LinkedIn has no fixed result quota. Indeed stops at 100 distinct matching offers per search; it may check more pages to find them. Older/undated postings are marked for availability review; an unknown date is not a new publication.
3. Read the posting, keywords and contact evidence. Published recruiting addresses appear first. Employer lookup runs separately. A general business address, a contact published for an earlier vacancy, or an unconfirmed professional profile is not a verified HR email.
4. For a role you want, click **Tailor CV & email**. Save your accurate master `main.tex` once via **Settings → Master main.tex & drafts**. JobOS analyzes the requirements and drafts using this master, without a second CV upload. The offer language is selected by default (French/English); change it if needed. Review the separate CV and use **Copy recipient**, **Copy subject** and **Copy body**. Nothing is sent automatically.
5. Use **Close** to skip an offer. Use **Check saved offers in browser** to find postings that explicitly stopped accepting applications. Review each notice and link, then select **Move to Expired** or **Expire all confirmed**. See archived postings with **Stage → Expired**. The archive keeps contacts, notes and drafts; jobs you already applied for also keep their application stage. A different posting from that employer can still appear.

## Tailoring and local models

Choose **Tailor CV & email** on a job card or open **CV & email tailoring**. Upload/paste a standalone main.tex or edit the project-root main.tex in VS Code and click Reload saved main.tex. Create from saved CV makes a starter from your uploaded CV text. Master saves keep backups under data/applications/master-backups and refuse to overwrite a file changed on disk since loading it. The private master is excluded from Git.

Select an opportunity with a full description, choose English/French, and review the recipient name/email. Tailor CV & write email uses your selected model. The model returns plain text replacements for existing positions; the app applies them to your original source. The preamble, packages, colors, margins, fonts, spacing, section order, commands, links and table/bullet structure stay intact. It produces a separate main.tex, outreach.txt and review.txt under data/applications/<draft-id>. Review the claims, questions and rendered layout: changing text can change line wrapping. The master is preserved. Email drafts remain editable and unsent.

**Analyze offer first** previews the key requirements, source quotes, CV evidence, gaps and separate priorities for the CV and email. It creates no application files. **Tailor CV & write email** uses a current selected analysis, or analyzes first automatically; changed CV/job/language/model inputs refresh it. A requirement without confirmed master-CV evidence is flagged for clarification rather than added as a qualification. The analysis uses the saved full job description, not a new web search, and remains an AI interpretation to review.

Local Ollama requests up to eight concise edits to selected descriptive text and a short email, using the complete CV and job inputs with repeated template context removed. Text containing numeric facts, credential/status references or contact details stays intact, and replacements cannot introduce new digits. The app explicitly reports when the CV is kept unchanged; the analysis and email can still be offer-specific. New failures identify connection, context, unfinished output or invalid edits without displaying private provider content. Keep the local server running and wait for the current workflow to finish before retrying. Earlier generic failure messages remain in draft history.

When a LaTeX compiler is available, main.pdf is built and offered for download. Windows MiKTeX under LOCALAPPDATA is detected automatically; TEX_BIN can specify an executable. PDF builds run without shell execution or automatic package installation. Unavailable/failed builds retain the .tex and email and show the limitation. Standalone source cannot include external files/images or executable TeX commands; ordinary distribution packages must already be installed. Codex's built-in LaTeX editor can also open the .tex for preview.

Save reviewed draft regenerates files/PDF and confirms you checked the draft against the current master, CV text and job. Copy recipient, subject and body separately, or Open in mail app uses your edited subject/body. Attach the reviewed CV/PDF yourself; JobOS never sends the email. Update CV & AI ranking separately when changing the experience used for job scoring.

## Offers and contacts

The Offers inbox shows posting links, publication dates, technology tags, contacts and a one-click Close. **Company contacts** remains available even when no roles are active. Manual CV ranking and historical scores are optional under **More**.

## Indeed through Chrome

Search now checks LinkedIn/company careers first, then Indeed using JobOS extension **0.4+** in Chrome. Reload the unpacked extension, refresh JobOS in Chrome, and allow Indeed site access on first use. Keep its controller tab open. Unreadable pages are skipped automatically and their links appear in the final Indeed search review. Verification/sign-in still pause the run; handle those yourself and Resume. Stopping preserves all saved offers. The browser cursor survives a server restart; no CV, cookies or account credentials are sent to the local discovery endpoint. See [USER-GUIDE.md](USER-GUIDE.md) for setup and the optional server-provider mode.

## Manual search and history

**More → Search history & employers** retains earlier reports. A partial search does not erase offers already saved. Search and local setup details are in [JOBOS.md](JOBOS.md).

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
- CV & AI ranking: PDF/DOCX/TXT upload, explained AI rankings, and optional public recruiting-email research with independently checked source pages. No LetsMCP service is required.
- AI models: saved provider/model profiles, private API keys, connection tests/catalogs, live search selection, and explicit portable Ollama/model downloads with progress.
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
- App-entered AI keys: ignored `data/ai-credentials.json`, separate from SQLite and never included in exports. These keys are not encrypted. Local portable model files are stored under ignored `data/ollama/`.
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
