# Run and maintain JobOS without a coding assistant

JobOS is a normal local application. You do not need this chat, Codex CLI, a coding assistant subscription or a hosted generation API to run it with downloaded Ollama models. Keep this guide with the project; **Help & local setup** inside the app also contains the essential steps.

## Start it

Prerequisites: Node.js 24 or newer, this project folder, and its npm dependencies. The optional SearXNG route also requires Docker Desktop. Install dependencies once with internet access:

```powershell
cd C:\Users\ROG\Pictures\ensias\project\JOB
npm ci
npm start
```

On later starts, run only `npm start` in that folder. Keep this terminal open. Open <http://127.0.0.1:4317/>. If the app already opens, do not start a second server. To stop JobOS, press Ctrl+C in its server terminal. This keeps saved data. Docker/Ollama are separate services and may keep running.

On Windows, you can also double-click **START-JOBOS.cmd** after installing dependencies. If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` in every command below; no execution-policy change is needed. For example, `npm.cmd run doctor`.

To check services from another terminal:

```powershell
npm run doctor
```

Doctor uses local HTTP checks and prints setup facts only. It does not generate text, search public sites, send a CV or consume an AI API quota. A service being reachable does not establish model quality or live website access.

## Choose Indeed coverage

For graduate employment searches across LinkedIn and Indeed, add `PFE, stage, internship, intern, stagiaire` to **Exclude terms** and save your search preferences. This excludes internship openings, including **projet de fin d’études**, **stage de fin d’études** and pre-employment internships. Previous internships mentioned as accepted experience in a regular job do not exclude that job. Start a fresh search after changing these terms; a paused Indeed run keeps its old preference snapshot.

For Indeed search coverage, open **Settings → Search preferences → Indeed search connection** and select **Indeed opportunities → Morocco roles + junior remote**, then **Save Indeed settings**. The next manual Search now includes relevant Morocco roles even without “junior” in the title, excludes explicit advanced requirements, and keeps remote roles only with junior/entry-level evidence and no recognized country restriction excluding Morocco. Read the eligibility warnings before applying. Existing saved offers stay available for your own review; this setting does not clean them up automatically or change LinkedIn searches.

## Download a model from the app

1. Open **AI models** in the sidebar.
2. Find **Download models on this computer**. This form is separate from the provider/API-key form.
3. In **Model to download**, select `qwen3:4b` for the smaller starter, or `qwen3:8b` if you have more memory and accept a larger download. You can enter another local text model's exact name from the [official Ollama library](https://ollama.com/library). Cloud models are rejected by this local download workflow.
4. Click **Download model**. The app installs/starts its official portable Ollama runtime when needed, downloads the model and shows progress. Leave JobOS running. Retrying a partially downloaded model reuses available download data.
5. Wait for completion, click **Refresh installed models**, then **Use this model** next to the downloaded model.
6. Click **Test saved model**. It uses a tiny synthetic JSON prompt, not your CV. A successful test checks basic generation, not every future prompt or the quality of its advice.

Downloading alone keeps the active provider, search choice and keys unchanged. **Use this model** selects local Ollama at `127.0.0.1:11434` and preserves the search choice. Installed models stay on this computer across app restarts. Larger models need more disk/RAM/VRAM; context length and output length add memory/time costs. The current official Qwen3 catalog lists about 2.5 GB for 4B and 5.2 GB for 8B, excluding context/runtime overhead. [Official catalog](https://ollama.com/library/qwen3).

Terminal alternative while JobOS is running:

```powershell
npm run model:download -- qwen3:4b
```

To download and explicitly select that model:

```powershell
npm run model:download -- qwen3:4b --use
```

These commands use the same authenticated download workflow and show progress. They do not require a coding model or an Ollama command on PATH. Use another terminal for them; keep the JobOS server terminal running. A conflicting active AI workflow is rejected. After switching, test the model in the app.

## Search LinkedIn, then Indeed

1. Restart JobOS after updating the code. In **Chrome**, open `chrome://extensions` and reload the unpacked **JobOS** extension. Its version must be **0.4.1** or newer. For first installation, Load unpacked selects the `extension` folder in this project.
2. Open [JobOS](http://127.0.0.1:4317/) in the same Chrome profile and refresh the page. The Codex in-app browser cannot run the Chrome extension.
3. In **Settings → Search preferences → Indeed search connection**, leave **Chrome session** selected. Check Indeed browser setup only checks extension presence; live access can still fail.
4. Click **Search now** once. LinkedIn/company careers run first. Partial successes remain saved even if a source is throttled. The Indeed controller opens afterward; on first use, click **Allow access to Indeed**.
5. Keep Chrome, the JobOS server and the controller open. You do not have to open Indeed in advance. If asked to verify/sign in, use **Open Indeed tab**, complete it yourself, return to the controller and click **Resume**. JobOS never solves a challenge.
6. Unsupported layouts and loading timeouts are skipped automatically, with their links and missing-field reasons saved for **Indeed search review** on Offers after the search finishes. These pages are not added as detected jobs. Verification, sign-in, unexpected navigation and connection loss still pause; **Stop Indeed · keep saved offers** ends just that step. A paused search does not hold the AI-model lock. Resume uses the preferences captured when that search began. After a server/browser restart, use **Open / resume Indeed** in JobOS to continue the saved cursor. **Start a new search** ends the paused Indeed step, keeps its saved offers/contacts and searches again from LinkedIn using your current preferences. Paused does not mean loading.

Readable roles are checked against saved fields/level/exclusions and the date window. Older/undated roles remain marked for review when broader coverage is enabled. Posting identity deduplicates variants; closed, expired and deleted offers stay excluded, while a distinct posting at the same employer may appear. Recruiting research uses the separate configured web source and can still be blocked. Nothing is applied to or sent automatically.

To use your configured search API or the older public-server path instead, choose **Configured search provider** and Save Indeed source before a new run. Opening Indeed manually does not fix HTTP 403 in that mode because server requests do not use Chrome cookies. No route guarantees exhaustive coverage or bypasses site restrictions.

## Close several offers together

To show just one site's offers, click **LinkedIn** or **Indeed** in the Source buttons above the list. **All sources** shows all posting sites again, including employer pages. This combines with your other filters and does not change where Search now searches.

In **Offers**, tick the boxes in the rightmost **Select** column. Click **Close selected (N)** above the list to close them in one click. The header checkbox selects every visible eligible offer; **Clear selection** unchecks them. Filters remove hidden offers from the selection, and newly detected offers stay unchecked. Contacts, notes and CV/email drafts remain saved. Use **Stage → Closed** to see or reopen closed offers. A different posting from the same company can still appear.

If the app says a selected offer changed, refresh and select again. No offers in that request were closed. Bulk closing is separate from **Expire all confirmed**, which archives postings with reviewed closure evidence.

## Choose search independently

Downloaded models process text; they do not contain current vacancies or provide unlimited access to LinkedIn.

For local SearXNG:

1. Install Docker Desktop once if it is missing.
2. In **AI models**, click **Install / start local search**.
3. Click **Use local model + local search**.
4. Click **Test live search**. It sends a generic public query, not the CV.

If you prefer no Docker, click **Use local model + public search** and **Test live search**. It requests public LinkedIn/web sources directly. Both routes require internet for new jobs and can be blocked by websites. SearXNG runs locally but forwards public role/company terms to upstream engines; it does not receive CV input. Partial upstream outages are labeled rather than hidden.

Terminal setup alternative:

```powershell
docker desktop start
node scripts/setup-local-search.js
```

The SearXNG service is bound to `127.0.0.1:8888`. Its container is named `jobos-searxng`. Setup reuses the owned container and its configuration; it does not delete an unrelated container with that name.

After this one-time setup, **Search now** automatically starts Docker Desktop on Windows and the installed JobOS search container if needed. Progress appears in the current search while the Docker engine starts, with a two-minute readiness limit. Keep JobOS open. If startup fails, open Docker Desktop to complete any initial setup or check its error, then retry. Search does not install Docker or download a missing container image; use **Install / start local search** for initial setup. A custom search port/address remains manually managed. The app does not start services when you merely open it, and does not enable scheduled searches. Docker may keep running after a search finishes.

## Understand the repeated HTTP 429 error

`Ollama web search ... HTTP 429` identifies **hosted Ollama search**, not downloaded Ollama generation. An earlier saved run can still display that error after you switch sources. Search reports show the saved attempt's date/source and your **current** source. Old records are preserved; a settings change does not retry them.

Check **AI models → Live search source**. For the local setup it should be **Local SearXNG · no API key**, with `http://127.0.0.1:8888`, or choose the public route. Test the current setup. Then start a new search yourself. Do not repeatedly retry an exhausted hosted API; its error does not tell you when the quota resets.

## Daily use

1. In **Settings → Search preferences**, save your domains, experience level, location and date window once. A new workspace starts with data science, ML, AI engineering, full-stack and data engineering; graduate/entry level; Morocco and eligible remote roles; and 30 days. Existing preferences are kept.
2. Open **Offers** and click **Search now**. No CV is needed and searches are manual. Verified batches appear as they arrive. Choose **New in last search** to isolate what was actually added. If a source fails, retry just that source; its results join the original search. LinkedIn has no fixed result quota. Indeed stops at 100 distinct matching offers per search; it may check more pages to find them. Older/undated postings are marked for availability review; an unknown date is not a new publication.
3. Read the posting, keywords and contact evidence. Published recruiting addresses appear first. Employer lookup runs separately. A general business address, a contact published for an earlier vacancy, or an unconfirmed professional profile is not a verified HR email.
4. For a role you want, click **Tailor CV & email**. Save your accurate master `main.tex` once via **Settings → Master main.tex & drafts**. JobOS analyzes the requirements and drafts using this master, without a second CV upload. The offer language is selected by default (French/English); change it if needed. Review the separate CV and use **Copy recipient**, **Copy subject** and **Copy body**. Nothing is sent automatically.
5. Use **Close** to skip an offer. Use **Check saved offers in browser** to find postings that explicitly stopped accepting applications. Review each notice and link, then select **Move to Expired** or **Expire all confirmed**. See archived postings with **Stage → Expired**. The archive keeps contacts, notes and drafts; jobs you already applied for also keep their application stage. A different posting from that employer can still appear.

PDF compilation needs an installed/configured LaTeX compiler. If PDF compilation is unavailable, the separate `.tex` source and editable email can still be reviewed; see the draft's notes. Do not overwrite the master to fix a tailored draft. Never accept invented qualifications or contact details from a model.

### Check whether saved offers still accept applications

1. Use the Chrome profile where you open LinkedIn. At `chrome://extensions`, reload the **JobOS — job capture & Indeed search** extension after updating it. For a first installation, choose **Developer mode → Load unpacked** and select the project's `extension` folder. Refresh the JobOS tab.
2. In **Applications → Application availability**, click **Check saved offers in browser**. If Chrome requests access, review the listed posting sites and allow them. Keep the JobOS review tab open while it checks each posting.
3. Review the notice and posting link. Click **Move to Expired**, or **Expire all confirmed** after the check finishes. Blocked/unreadable pages remain available only for manual review. An expired posting is not a rejection; Applied and later stages are preserved.

## Optional API alternatives

For a separate local gateway shared by JobOS, Codex CLI and Claude Code, see [FREELLMAPI.md](FREELLMAPI.md). It starts with downloaded Ollama; cloud providers remain explicit choices with their own quotas. The guide includes local launch commands, private key management and the small model's coding limitations.

For coding independently of the app, open the separate sibling app at C:\Users\ROG\Pictures\ensias\project\freellmapi (see [gateway guide](FREELLMAPI.md)) in VS Code. From that folder use `npm.cmd start`, `npm.cmd run codex` or `npm.cmd run claude`; pass `-- --cwd "C:\path\to\your-project"` to choose the project to work on. It contains the gateway source/private state and launchers, while sharing the installed Ollama service/weights.

In **AI models**, use **Configure Groq** or **Configure free OpenRouter**, or choose an existing provider. Create a key in your own account, paste it into the password field, and **Save AI settings**. You can select **Tavily Search · free tier** separately and enter its search key. Test generation and search independently. No `.env` edit or server restart is needed for app-saved keys.

Keys are private local files, never returned to the browser or included in workspace exports. Free APIs have account-specific quotas; this app does not guarantee current access or enable paid plans. OpenRouter's profile accepts only its free router or `:free` models. Hosted generation receives the CV/job input you submit; select local Ollama to keep generation local. See [LOCAL-AI-WORKFLOW.md](LOCAL-AI-WORKFLOW.md) for account links and limits.

## Troubleshooting without an assistant

| Symptom | Action |
| --- | --- |
| Browser cannot open JobOS | Run `npm start` in this folder and leave it open. Run `npm run doctor` in a second terminal. |
| Port 4317 is already in use | Open the existing app/server first. Stop only your known JobOS server with Ctrl+C if you need to restart it. |
| Dependencies missing | With internet, run `npm ci`, then `npm start`. |
| Ollama unreachable | Use the app's Download model control to install/start it, or start an existing official Ollama installation; refresh installed models. |
| No installed models | Download `qwen3:4b`, wait for success, then refresh and select it. |
| Model download failed | Check model name, internet and free disk space; retry the same name. Cloud tags are not local downloads. |
| Model fails on a long CV | Keep the full truthful input; choose another downloaded model/context setting or explicitly select an API provider. Larger context uses more memory. The app rejects oversized/unfinished input/output instead of silently truncating it. |
| SearXNG unreachable | Start Docker Desktop, then Install / start local search. Check that port 8888 is free. |
| Search engine or job page blocked | No challenge is bypassed. Retry later or capture an offer manually. Local analysis of saved full descriptions can continue. |
| Old HTTP 429 still displayed | Read the attempt date/source and current source. Test the current setup; the old report is not automatically rerun or erased. |
| Settings conflict | Click Reload saved settings before saving a stale form. Do not paste keys into chat. |
| Browser shows old controls | Refresh the page after updating/restarting the app. |

## Offline use, backups and project checks

With Node, dependencies, an installed model and Ollama running, saved records and local analysis/drafts do not need a hosted LLM account. New models, new vacancies, contact research and missing LaTeX packages need internet. An API provider needs its service/account access even if this app runs locally.

Back up the project and its private `data/`, master `main.tex`, and `.env` to a private location. Keep secrets and CV files out of Git/public uploads. The workspace export is useful for records but is not a complete service/model/draft/credential backup. Stop JobOS before copying its database files; preserve related SQLite WAL/SHM files if present. Downloaded portable Ollama models and SearXNG configuration/cache live under ignored data folders; an independently installed Ollama may store its models elsewhere.

After changing application code, run:

```powershell
npm test
npm run check
```

These tests/checks do not require a coding assistant. Keep this guide and [LOCAL-AI-WORKFLOW.md](LOCAL-AI-WORKFLOW.md) available even if you lose access to hosted AI services.


## Capture an Indeed offer manually

Open the full Indeed offer, then click the JobOS extension. Version **0.4.1+** reads both the older layout and the newer standalone posting layout. Review the filled title, company, location, posting URL and description, then click **Save opportunity**. If the page was still loading, use **Capture current job again**. Capture reads the visible posting and does not open an application or send your CV. After updating extension files, reload JobOS at `chrome://extensions` and reopen its popup; for a running search, resume from JobOS to open the updated controller.
