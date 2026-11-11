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

1. **CV & AI ranking:** upload/paste your real CV text and save it.
2. **CV & email tailoring:** paste/upload your standalone master `main.tex` and save it. Keep this master accurate. Tailored results change its text positions and are saved separately; formatting is not redesigned.
3. **Job search:** save your domains, junior experience level, Morocco/eligible remote preferences, exclusions and posting window. Default recent coverage is 30 days. Broader coverage can also retain older/undated postings for availability review.
4. Click **Search now**. The app searches the selected sources, checks readable descriptions, deduplicates, researches source-backed recruitment contacts and compares offers with the saved CV. No fixed number of results is promised. No hourly search is enabled.
5. **Daily opportunities / Applications:** inspect posting links, source publication dates, eligibility, CV fit/gaps and contact evidence. A low fit score does not remove a saved offer. Missing emails are not guessed.
6. Click **Tailor CV & email** on an offer, choose French/English and **Analyze offer first**. Review the key requirements, quoted evidence and missing/uncertain qualifications. Generate the CV/email draft, inspect facts and the compiled PDF, then send it yourself.
7. Click **Close** on an unwanted offer. It keeps its ID, stage and notes during rediscovery. Reopen it through Stage. Deleting an offer remembers its posting identity so future imports/searches skip it.

PDF compilation needs an installed/configured LaTeX compiler. If PDF compilation is unavailable, the separate `.tex` source and editable email can still be reviewed; see the draft's notes. Do not overwrite the master to fix a tailored draft. Never accept invented qualifications or contact details from a model.

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
