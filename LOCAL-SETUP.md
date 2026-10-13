# Run JobOS with a downloaded local model

Use **Ollama · local** for generation, rankings and CV/email drafts. The model runs on this computer and does not use Gemini or Codex requests. Local inference has no hosted AI request quota; speed, available RAM/VRAM, model context and app timeouts still apply. Finding new public offers needs internet. LinkedIn and search engines can block or limit access, independently of the local model.

## This computer's completed setup — 2026-10-13

Ollama's verified portable Windows runtime and `qwen3:4b` are installed in this project's `data/ollama/` directory. The model download is about 2.33 GiB. JobOS is configured for **Ollama · local**, `http://127.0.0.1:11434`, 32,768 context tokens, and **Public LinkedIn + web · no API key**. Docker is not used. Existing `.env` keys were preserved and are not needed by this configuration.

Live local checks passed: synthetic JSON connection in 8 seconds, one synthetic job ranking in 33 seconds, and synthetic text-only CV/email drafting in 80 seconds. The app rejected no output in those checks. Ollama reported zero GPU memory allocated, so these checks ran on CPU; longer inputs can take more time.

During the public-source checks, readable DuckDuckGo and LinkedIn results were initially available, but later requests hit a DuckDuckGo challenge and LinkedIn HTTP 429. Their future availability is unconfirmed. Use the Chrome capture/saved-offer workflow below while public searching is blocked. No full live job scan was performed for installation, and the synthetic checks did not use or change your CV.

## Start JobOS

Open a PowerShell terminal in VS Code:

```powershell
cd "C:\Users\ROG\Pictures\ensias\project\JOB"
npm.cmd start
```

Open <http://127.0.0.1:4317/#models>. Keep the terminal running. If it reports that port 4317 is already in use, JobOS is probably already running: check the existing app before starting another copy.

## Install through the app

1. Open **AI models**. The default local model is `qwen3:4b`; its model profile remains separate from hosted providers. To choose `qwen3:8b`, select Ollama, edit Model and save first. Larger models require more memory and download space.
2. Click **Install / download local model**. JobOS downloads the official Windows portable runtime into ignored `data/ollama/`, verifies the release SHA-256 before extracting it, starts a hidden local server and downloads the chosen model. The portable server binds to `127.0.0.1:11434`, stores models in the project and disables Ollama cloud features. Keep JobOS running during setup.
3. If downloading is interrupted, click the same button again. Runtime segments are retained and resumed; the complete runtime must still pass its official checksum. Ollama also resumes model-layer downloads. A failed progress report never means the model is ready.
4. After completion, click **Use local model + free search**. It selects **Ollama · local**, its saved model and **Public LinkedIn + web · no API key**. This action changes settings only; it does not download another model or start a job scan.
5. Click **Test saved model**. A synthetic JSON prompt verifies local generation. Then click **Test live search** for a generic public LinkedIn listing probe. A successful listing probe does not test contact searches or guarantee future access.
6. Use **Search now** when the model and source tests pass. Search remains manual. Public LinkedIn listings are read for LinkedIn queries; DuckDuckGo is used for employer pages and public HR/contact queries. Each source is identified and blocked sources produce warnings. No paid engine is selected automatically, no challenge is bypassed and no authenticated LinkedIn session is used.

No API key is required for this configuration. Existing Gemini keys can stay in `.env`; the local provider does not use them for inference. Selecting **None · CV tools only** removes internet discovery while retaining local ranking and drafting for saved offers.

## If public searching is blocked

HTTP 429 means a source is limiting requests. A challenge/sign-in page is also an access failure. The app stops requesting that blocked source for the current workflow, retains source-confirmed results already read and labels incomplete coverage. It cannot reset website limits or promise when access will return. A new manual attempt may still fail; repeated retries are not a solution.

You can continue with your current saved offers or capture a job through the Chrome extension while browsing it yourself. Review the posting link and full description in Applications. Use local **CV & AI ranking** and **Tailor CV & email** without a live-search key. Emails published in a captured description remain usable evidence; other recruiting contacts stay unknown unless a readable public source confirms them. Confirmed career-page links remain a fallback. No messages or applications are sent.

## Manual Ollama installation if the app installer fails

Install the official [Ollama Windows application](https://ollama.com/download/windows), then open a **new** VS Code terminal so PATH updates are available. [Windows installation guide](https://docs.ollama.com/windows).

```powershell
ollama --version
ollama pull qwen3:4b
ollama list
```

The Windows application normally starts the server in the background. If the connection is unavailable, run `ollama serve` in another terminal and leave it running. An address-in-use error usually means it is already serving; check before starting a second server.

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

In JobOS select **Provider → Ollama · local**, **Model → qwen3:4b**, **Model server address → http://127.0.0.1:11434**, and **Live search source → Public LinkedIn + web · no API key**. Save and test. No inference API key is needed. The app reuses a server already running at that address.

If using JobOS's existing portable runtime instead:

```powershell
$env:OLLAMA_HOST = "127.0.0.1:11434"
$env:OLLAMA_MODELS = Join-Path (Get-Location) "data\ollama\models"
$env:OLLAMA_NO_CLOUD = "1"
.\data\ollama\runtime\ollama.exe serve
```

Leave that terminal open, then use a second terminal to download/list a model through the same server:

```powershell
.\data\ollama\runtime\ollama.exe pull qwen3:4b
.\data\ollama\runtime\ollama.exe list
```

## If generation is slow or fails

- Start with Qwen3 4B. An 8B model can improve results but needs more memory; it is a separate download. Review generated facts with either model. [Qwen3 4B](https://ollama.com/library/qwen3:4b).
- Check memory and GPU usage. CPU inference can be slow, especially with a long CV. Local generation streams its response internally and allows up to 20 minutes per request; hosted generation retains its five-minute limit. Incomplete or timed-out output never becomes a successful result. The on-demand scan compares local jobs one at a time and processes every eligible batch.
- **Input too large**: increase Local context tokens if memory permits, or rank fewer selected offers per request. The app does not truncate the CV silently.
- **Invalid JSON / incomplete structured data**: retry a small request or install a stronger local model. The app rejects unusable output rather than accepting invented or malformed results.
- Tailored CVs keep the current root `main.tex` format. The master remains intact; outputs are separate. Check facts and the rendered PDF before sending the editable email draft yourself.

Local discovery reads title, company, publication date and description directly from current source markup/JobPosting data, then applies source/date/domain checks. It does not ask the CPU model to rewrite entire posting descriptions. The local model is still used for CV fit and drafting. This distinction reduces discovery latency without inventing missing source facts.

See [TESTING.md](TESTING.md) for actual installation, model, web-source and UI verification results in this workspace.
