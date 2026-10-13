# Choose an AI model in JobOS

Open **AI models** in the sidebar, or visit <http://127.0.0.1:4317/#models>. The saved provider is used for the next requested search, employer research, CV ranking and CV/email draft. Switching providers does not launch a search, rewrite old results or fall back to Codex. Historical workflows retain their provider/model metadata.

| Provider | CV ranking and tailoring | Finding current jobs and contacts |
| --- | --- | --- |
| Codex CLI | Existing CLI sign-in; optional model override | Built-in Codex web search |
| Google Gemini API | Gemini API key and model | Choose Gemini + Google Search; uses the same Gemini key |
| Ollama local | Downloaded model on this computer; no inference API key or hosted AI quota | Public LinkedIn + web needs no key; optional hosted search sources require their own keys |
| Kimi / Moonshot API | Moonshot API key and model | Choose public sources without a key, or a hosted search service with its key |
| OpenAI-compatible API / LM Studio | Server address, model and API key if required | Choose public sources without a key, or a hosted search service with its key |

Hosted services have separate billing, account access and quotas. A different provider avoids Codex account usage, but it does not bypass that provider's limits. Compatible servers must support chat completions and JSON responses; arbitrary APIs are not automatically interchangeable.

For downloaded models, start with [LOCAL-SETUP.md](LOCAL-SETUP.md). **Use local model + free search** selects local Ollama and public LinkedIn/web sources. This configuration needs no API key and has no hosted inference quota. Computer resources, context/time budgets and website restrictions still apply. Local inference does not provide unlimited access to LinkedIn or contact-search websites.

## Use Gemini or Kimi

1. Select the provider. The model field starts with a suggested model and accepts another model ID. Gemini defaults to `gemini-3.6-flash` for both generation and search; its synthetic generation test passed live. `gemini-3.8-flash` remains an editable option, but returned temporary HTTP 503 service errors during this check. A catalog entry does not prove account access: our live test found that Gemini 2.5 Flash was still listed but rejected new users. Test your chosen model before starting a workflow. Provider/model switches remain explicit; a failed request does not automatically switch models.
2. Enter the provider's API key in the password field on this page. Do not paste keys into chat.
3. For Gemini, leave **Live search source → Gemini + Google Search** selected. For Kimi, choose Gemini, Ollama web search API or Brave and enter that service's key too. **None** supports CV tools without fresh web searches.
4. Click **Save AI settings**, then **Test saved model**. This sends only a tiny synthetic JSON prompt, not your CV. It tests generation, not live web-search permissions or quota.
   Before searching for jobs, also click **Test live search**. It checks your selected search source with a generic public listing or documentation query and reports source/access/quota errors separately. It does not start a job scan or send CV/saved job text. A public listing probe does not test employer/contact web access.
5. **List available models** reads the saved provider's catalog. Choose a name and save it before use. Account access and model capabilities still need to be checked through the connection test/workflow.
6. Open Applications and click **Search now**, or choose a saved opportunity and **Tailor CV & email**.

Keys can also be supplied through `.env`: `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `AI_API_KEY`, `OLLAMA_API_KEY` for Ollama web search, and `BRAVE_API_KEY`. Restart JobOS after changing `.env`. Keys entered in the app apply immediately and override the corresponding environment key. Blank fields keep existing keys; **Remove saved key** clears only the app's copy.

### Fill the private .env file in VS Code

The workspace now includes a private `.env` copied from `.env.example`, with empty key fields. Real keys must come from your provider accounts; JobOS cannot create them for you. Edit `.env`; keep `.env.example` free of secrets.

For the currently selected Gemini provider:

1. Open [Google AI Studio's API Keys page](https://aistudio.google.com/apikey), sign in, and create or copy a key for your project. Follow the page's project setup if this is your first key.
2. In the root `.env`, fill `GEMINI_API_KEY=` with that key. You can write `GEMINI_API_KEY="your_actual_key"`; replace the example text with the real value. Leave unused provider and mailbox variables blank.
3. Save `.env`, stop the running app in its terminal with Ctrl+C, then run `npm start` from the project directory. Environment values are read at server startup.
4. Open **AI models** and select Gemini, the desired model, and **Gemini + Google Search**. Save the settings and click **Test saved model**. The key field should report **Loaded from .env / environment** without displaying the secret.
5. Before **Search now**, also click **Test live search** and check that it succeeds. A successful generation test alone does not test web-search permissions or future quota. CV/email drafting needs generation access, independently of web search.

For Kimi, create a key in the [Kimi platform console](https://platform.kimi.ai) and fill `MOONSHOT_API_KEY`. For a local model that needs web search, fill either `GEMINI_API_KEY`, `OLLAMA_API_KEY` or `BRAVE_API_KEY` and select the corresponding live search service. `AI_API_KEY` belongs to the custom compatible server, if it requires one. You do not need to fill every key.

An app-saved key takes precedence over `.env`. To switch that provider to the environment value, check **Remove saved key** in AI models and save; the `.env` key remains available. The file is excluded by `.gitignore` and its contents are not returned by the app.

### If search fails after the model test passes

Open **AI models → Reload saved settings** to load the current server settings. Check both **Model** (CV/ranking generation) and **Gemini search model** (Google Search): these are separate fields. An older open form cannot overwrite newer settings; reload it after a conflict instead of saving old values again. Refresh the browser to load the latest controls.

During the 2026-10-13 live checks, Gemini 3.6 generation passed but Google Search returned **HTTP 429 RESOURCE_EXHAUSTED** with a quota/plan message. This is an account/service limit; changing the CV or adding another key from the same project does not establish new quota. Check [your Google AI Studio limits](https://aistudio.google.com/rate-limit?timeRange=last-28-days) and [Google's rate-limit guide](https://ai.google.dev/gemini-api/docs/rate-limits) for the active project. The response did not identify the exhausted counter or reset time, so the app cannot promise when retrying will work or whether a billing change is needed.

You can keep Gemini for generation and explicitly choose another **Live search source**, such as **Ollama web search API** with `OLLAMA_API_KEY` or **Brave Search API** with `BRAVE_API_KEY`. Save and test that source before starting a scan. These services have their own account access, quotas and terms. The app does not change providers or enable paid billing automatically.

To use Ollama's search service while keeping Gemini for CV tools:

1. Create an API key in your [Ollama account](https://ollama.com/settings/keys).
2. In **AI models**, keep **Provider → Google Gemini API** and **Model → gemini-3.6-flash**. Change **Live search source → Ollama web search API**.
3. Enter the key in **Ollama web-search API key**, then **Save AI settings**. App-entered keys apply immediately; no server restart is needed. Alternatively, set `OLLAMA_API_KEY` privately in `.env` and restart JobOS.
4. Run **Test saved model** and **Test live search**. Start **Search now** after both succeed. This setup still uses Gemini generation during discovery, comparisons and drafting, so those requests need available Gemini quota too.

Ollama web search is a hosted service. It does not require downloading a local model, and downloading a model does not provide its search key. [Official search authentication guide](https://docs.ollama.com/capabilities/web-search). Gemini web-search quota errors now show these setup instructions and a direct Google quota link in the model-test result and saved workflow status. Errors from other services are not labeled as Google quota failures.

The Search needs attention panel retains the previous failed attempt. Changing settings does not clear or rerun that report; **Test live search** checks the current configuration. Retry **Search now** after the live-search test succeeds.

## Download and use a local model

1. Open **AI models** and click **Install / download local model**. The default Ollama profile is `qwen3:4b`. To choose another model, select Ollama, enter its name and save first.
2. Leave JobOS running while setup downloads. It can require several GB and shows download progress. The button reuses Ollama if it is already running; otherwise it downloads the official Windows portable runtime, checks the release's SHA-256 checksum, and starts it locally. The runtime and models use ignored `data/ollama/` storage for the portable installation.
3. After completion, select **Ollama · local**, model `qwen3:4b`, server `http://127.0.0.1:11434`, and click **Save AI settings** and **Test saved model**.
4. Choose **Public LinkedIn + web · no API key** for key-free discovery, or add a hosted search service's key if you explicitly choose one. The downloaded model itself has no web browser. With **None**, ranking and CV/email drafting remain usable locally. Public source blocks do not prevent ranking or tailoring captured jobs.
5. Keep the local model server running while using it. JobOS can restart its already installed portable runtime after a reboot; connection checks do not silently download missing software.

Qwen3 4B is a modest starting model, not a guarantee of accurate tailoring or ranking. This computer has about 32 GB RAM; GPU acceleration was not confirmed. CPU inference and long CVs can be slow. A larger model/context consumes more memory. The app rejects oversized local input instead of silently truncating your CV; increase **Local context tokens** or use another provider when needed.

To use an existing LM Studio or another compatible server, choose **OpenAI-compatible API / LM Studio**, enter its exact loaded model ID and address such as `http://127.0.0.1:1234/v1`, save and test. Start that server separately.

## Data and workflow rules

- Ollama's local provider sends generation input to the configured loopback server. API providers receive CV/job text for ranking and tailoring. Public search queries contain only saved professional domains, public job locations and employer/role terms.
- App-entered keys are stored in ignored `data/ai-credentials.json`, separately from the database. They are not encrypted, echoed back to the browser, included in exports or placed in URLs/logs. Model requests sanitize provider errors rather than displaying their raw response bodies.
- Job discovery still runs only on request. Source publication dates, older/undated review labels, deletion memory, closed stages and deduplication remain enforced. Search results and contact claims are independently checked against readable public sources.
- There is no fixed job-count quota. Search-engine pagination, inaccessible sources, model output limits and runtime still limit coverage. API/local discovery has a 25-minute query-loop budget; source checks or the current model request can extend total runtime. Warnings identify incomplete searches. No exhaustive or real-time coverage is promised.
- Tailoring uses only text replacements in the current `main.tex`. The master and formatting are preserved; output is saved separately. Review facts and the compiled PDF before sending. Email remains an unsent draft.
- Search, research, ranking, drafting, connection tests and model installation share the active-workflow guard. Wait for completion before changing provider. Provider errors never trigger a silent switch back to Codex.
- Codex's connection check verifies CLI sign-in only. Other providers' **Test saved model** makes a small generation request; it can use a small amount of that provider's quota. A successful test does not guarantee later quota or source access.

## Official references

- [Ollama Windows setup](https://docs.ollama.com/windows), [local chat API](https://docs.ollama.com/api/chat), [Qwen3 4B model](https://ollama.com/library/qwen3:4b), [Ollama web search and required API key](https://docs.ollama.com/capabilities/web-search).
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Google Search grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search), [get a Gemini key](https://aistudio.google.com/apikey).
- [Kimi API overview](https://platform.kimi.ai/docs/overview), [JSON mode](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api), [Kimi K2.6](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart).
- [Brave Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get).

Model IDs and account availability can change. Use the editable model field/catalog and test your saved configuration. See [TESTING.md](TESTING.md) for live checks and remaining integration limits.
