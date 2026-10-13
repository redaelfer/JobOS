# JobOS: junior software engineering job search

JobOS helps a junior software engineer find LinkedIn job offers, identify a person or published recruitment address to contact, and prepare a truthful CV and email for each opportunity. It keeps the whole workflow in one local workspace.

## Main workflow

1. Choose a provider in **AI models**: Codex, Gemini, Kimi, local Ollama or a compatible API. Save and test the model; configure a live search source when using a provider other than Codex. For generation without hosted quotas, download Ollama/Qwen3 and click **Use local model + free search**; this selects public LinkedIn/web sources without API keys. Websites can still restrict access. See [AI-MODELS.md](AI-MODELS.md) and [LOCAL-SETUP.md](LOCAL-SETUP.md). Save the current CV in **CV & AI ranking** and keep the original LaTeX template in the project's `main.tex` through **CV & email tailoring**. When experience changes, update both sources; the template is authoritative for tailored documents.
2. Set professional domains in **LinkedIn search**. The broad junior search covers software engineering, backend, frontend, full-stack, AI, data, DevOps and QA/test automation. Locations remain Morocco and remote roles. The search checks country eligibility rather than treating every remote job as worldwide.
3. Ask Codex to search or click **Search now**. Searches run only on request; the hourly schedule is disabled. It uses the current saved preferences and **Posted within** window (default last 30 days), deduplicates source URLs, and prioritizes domain-relevant postings whose publication date is confirmed on the source. **Broader coverage** is enabled by default: a second sequential pass looks for readable older or undated postings that may still be hiring. They need a source-confirmed title/company and full description, and cannot be explicitly closed or expired. They are retained for availability review, never presented as fresh or confirmed open. It checks readable public LinkedIn and official employer postings, researches new and saved employers, and refreshes CV comparisons when their inputs change. There is no fixed number of jobs per search. Employer research and CV comparisons run sequentially in batches until all eligible returned records have been processed.
4. Open **Applications**. List view is the default. Each row includes its posting link, contact evidence, stage, publication text and **Tailor CV & email**. All saved opportunities remain visible; the fit threshold labels strong matches without hiding lower scores. Board view is still available.
5. Review the contacts. Prefer published recruiting emails. If none is confirmed, use a public recruiter/HR profile or the confirmed company application page. Evidence does not establish current affiliation or email delivery. JobOS never constructs guessed email addresses.
6. Select an opportunity in **CV & email tailoring**, choose French or English, check the recipient, and generate a draft. Download the CV source/PDF, email and review notes, check the facts and layout, then send the application yourself.
7. Move the opportunity through Saved, Applied, Screening, Interview, Offer or Closed and schedule a follow-up when useful.

## Newest offers first

In **Applications**, choose **Publication → Last 24 hours / Last 7 days / Last 14 days / Last 30 days** to filter by the source's posting date. **Sort → Latest posted** puts the newest known publication date first. These filters work in list and board views and combine with stage/text filters. **All saved** is the Applications default and keeps older, closed and lower-fit records available; **Date unconfirmed** isolates offers whose publication date is missing. The same explicit publication windows are available in Daily opportunities. Discovery date is not used as a substitute for a missing publication date.

Applications and Daily opportunities default to **Latest posted**, using dates published by the source. Relative dates are approximate; missing dates appear last and never imply a new posting. **Recently detected** sorts when JobOS found the offer; **Best CV fit** sorts current comparisons first. A job found today may have been published months ago. Daily opportunities opens with **Publication: Last 30 days** (or your saved shorter window). The **Also worth checking** panel highlights older saved postings and postings with no confirmed date. Use its review buttons or **Publication → Older — check availability / Date unconfirmed** to review them. **All saved** retains the full history. Turn off **Broader coverage** in LinkedIn search if you want future discovery restricted to recent postings. Detection-date and strong-match filters remain available. Recently detected never means recently posted.

## Deleted and closed offers

Deleting an offer removes it from the workspace and remembers its canonical posting URL in the local database. Future searches, late results from an already-running search, email imports, Chrome capture and manual saves skip that posting instead of recreating it. Alternate LinkedIn links for the same numeric posting ID match the same remembered offer. Previously deleted results in old search reports are labeled and have no Save action. The memory survives a restart and is included in workspace exports; it stores only the URL and deletion date, not the deleted description or CV.

Closing an offer keeps its current record, notes and stage. Rediscovery can refresh source details but never reopens the application or counts it as new. You can reopen a closed application yourself by changing its stage. Distinct posting IDs/URLs remain separate opportunities, even when the employer and title are the same; the app does not guess that different postings are duplicates. An offer with no URL cannot be reliably remembered by posting identity. Deletions made before this feature have no saved deletion memory and cannot reliably be reconstructed.

## Preserve the CV template

The supplied template is saved as the master `main.tex`. AI returns plain text replacements for existing text positions, not a new LaTeX document. JobOS applies those replacements to the original source, preserving the preamble, packages, colors, fonts, margins, commands, comments, spacing, hyperlinks, section order, bullet structure and tables. Invalid slot IDs, duplicate replacements and LaTeX commands in replacements are rejected.

The master is never overwritten by a tailored result. Each result is saved under `data/applications/<draft-id>/`; master changes have backups under `data/applications/master-backups/`. Changing the master marks earlier drafts as needing review. Manual edits remain possible. Text changes can affect line wrapping and page count, so a compiled PDF still needs a visual check; the app does not shrink fonts or change margins to force a fit.

## Check a running task

The status panel on every page identifies the active task (search, CV comparison, CV draft or local-model download), its provider/model, current workflow step, elapsed minutes and last successful status check. A full scan can take more than ten minutes because discovery, source checks, employer research and comparisons run sequentially. Codex uses a separate non-interactive CLI process; other providers use their API or local model server. These tasks do not call this chat, and you can continue chatting while the app works. Use **View details** for the report or **Refresh status** for a read-only check that preserves edited form fields. The app warns when it cannot reach the local server, disables new AI workflows until the status is known, and retries automatically. A successful status check confirms the server responded; it does not prove the provider is making progress. Provider changes and model downloads share the workflow guard. Hourly searches remain disabled.

## Honest limits

On-demand public searches have no result-count quota, but time, provider output and source access still limit coverage. They cannot guarantee every opportunity or real-time detection and may miss private or inaccessible postings. Relative posting dates and repost ages are approximate; they do not prove the date a vacancy was originally opened. An accessible page or Apply button does not prove that the vacancy remains open. Fit scores are explained estimates, not ATS results or hiring probabilities. Search queries exclude CV text and candidate contact details. Draft generation and ranking use the selected model: a configured local Ollama server or the chosen hosted provider. Alternative providers do not consume Codex usage and have their own access/quotas; failures never silently fall back. No emails or applications are sent automatically.

## Run and verify

```powershell
cd C:\Users\ROG\Pictures\ensias\project\JOB
npm start
```

Open `http://127.0.0.1:4317/`. To run a complete search manually from the terminal, use `node scripts/run-search.js`. The old `scripts/run-hourly.js` only reports that scheduled searching is disabled and performs no search. `npm test` and `npm run check` verify the app; `TESTING.md` records browser and document checks.
