# Local AI workflow and optional free APIs

## Use the local setup

Open **AI models** at <http://127.0.0.1:4317/#models>.

For the complete routine without a coding assistant, read [USER-GUIDE.md](USER-GUIDE.md) or **Help & local setup** in the sidebar. The dedicated download form accepts a model name without changing your current provider; refresh the installed list and explicitly **Use this model** afterward.

1. **Download model** installs Ollama and the selected downloaded model. This computer already has `qwen3:4b`; you do not need another key or another download for it.
2. Install **Docker Desktop** once if it is missing. Under **Local workflow or free APIs**, click **Install / start local search**. On Windows, this starts Docker Desktop when needed. It downloads the official SearXNG image once and starts it at `http://127.0.0.1:8888`. Later clicks reuse the existing container. Only its ignored search-configuration/cache folders are mounted, and its published port is bound to localhost.
3. Click **Use local model + local search**. This saves Ollama for generation and local SearXNG for web discovery. Your existing API keys remain available if you choose them later.
4. Click **Test saved model**, then **Test live search**. These tests use synthetic data/public documentation, never your CV. A partial search-engine outage is shown as limited coverage.
5. Save your CV, master `main.tex` and job preferences, then click **Search now**. After setup, this starts Docker Desktop and the installed local search service automatically when needed on Windows, showing progress before discovery begins. Custom search addresses remain manually managed. Discovery, contact research and CV comparisons use the selected setup. In each opportunity, **Tailor CV & email** opens the offer analysis and drafting tools using that same local model.

The search service runs locally, but fresh postings come from the internet. SearXNG forwards public role/company queries to upstream search engines; job pages are then independently checked. It does not receive your CV. The downloaded model handles contact interpretation, ranking, offer analysis, CV text edits and email drafts on localhost. No hosted AI-search key is required. Website blocks, missing descriptions, country eligibility, hardware/context/time limits and model mistakes still apply. No exhaustive coverage or unlimited website access is promised. [SearXNG search API](https://docs.searxng.org/dev/search_api.html), [official container setup](https://docs.searxng.org/admin/installation-docker.html).

Searches remain manual; no hourly schedule is enabled. Tailored documents remain separate from your master, and emails remain unsent drafts. Closing/deleting offers keeps the existing rediscovery protections.

## Switch to an optional free API

You can keep local search and change only the generation model, or keep the local model and change only the search service. The app never switches providers automatically.

| Choice in AI models | What to enter | What it does |
| --- | --- | --- |
| **Configure free OpenRouter** | Create your own [OpenRouter key](https://openrouter.ai/settings/keys), paste it in **OpenRouter API key**, keep `openrouter/free` or select a listed `:free` model | Hosted generation. This profile rejects paid model IDs and sends no paid fallback list. |
| **Configure Groq** | Create your own [Groq key](https://console.groq.com/keys), paste it in **Groq API key**, save and use **List available models** | Hosted generation with account/model-specific limits. The suggested Qwen model is a preview; test your account's access. |
| **Live search source → Tavily Search · free tier** | Create your own [Tavily key](https://app.tavily.com), paste it in **Tavily Search API key** | Hosted web search, using basic requests. You can retain Ollama for all CV/contact analysis. |

After entering a key, click **Save AI settings**, then **Test saved model** and **Test live search** as appropriate. Choose a model from **List available models**, then save again after changing it. Model choices persist separately per provider. Keys are password fields, stored in ignored `data/ai-credentials.json`; they are not returned to the browser, included in exports or written to logs. Optional `.env` variables are `GROQ_API_KEY`, `OPENROUTER_API_KEY` and `TAVILY_API_KEY`; using the app does not require editing `.env` or restarting JobOS.

Free does not mean unlimited or guaranteed available. OpenRouter's free router uses free models with rate limits; Groq access depends on your account/tier; Tavily currently documents 1,000 free credits/month and one credit per basic search. JobOS does not enroll you in paid plans. If your account already has a paid plan, its terms still apply. Hosted generation sends CV/job input to that chosen service; select Ollama to keep generation local. No API key is created or fabricated by JobOS. [OpenRouter free models](https://openrouter.ai/docs/guides/routing/model-variants/free), [Groq limits](https://console.groq.com/docs/rate-limits), [Tavily credits](https://docs.tavily.com/documentation/api-credits).

## If local setup does not start

Start Docker Desktop and wait for its engine to be running. Keep port 8888 available. From the project terminal:

```powershell
cd C:\Users\ROG\Pictures\ensias\project\JOB
docker desktop start
node scripts/setup-local-search.js
npm start
```

If JobOS is already running, keep its existing server and run only the setup command; do not start a second server. Setup refuses an unrecognized container named `jobos-searxng` instead of deleting or replacing it. To stop the owned service yourself, use `docker stop jobos-searxng`; its files and container remain available for the next setup click. If Docker cannot start, use **Use local model + public search** temporarily; that needs no Docker and uses public LinkedIn/web sources directly. Both routes can encounter website restrictions.

If a model test fails, start/reinstall Ollama or choose a downloaded model in the app. If search fails, check Docker and **Test live search** separately. Captured offers can still be ranked and tailored locally while web discovery is unavailable. Keep the JobOS terminal and local services running while using the app.
