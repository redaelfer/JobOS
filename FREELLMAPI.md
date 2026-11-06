# Connect JobOS to the separate FreeLLMAPI app

FreeLLMAPI is its own application beside JobOS:

```text
C:\Users\ROG\Pictures\ensias\project\
  JOB\          JobOS application
  freellmapi\   Separate gateway, provider keys and coding launchers
```

Open **C:\Users\ROG\Pictures\ensias\project\freellmapi** as its own VS Code folder. Its [README](../freellmapi/README.md) contains full standalone setup and recovery instructions. JobOS uses the gateway's local HTTP API; neither application's normal startup imports the other's code.

## Start the separate app

```powershell
cd C:\Users\ROG\Pictures\ensias\project\freellmapi
npm.cmd start
```

Open <http://127.0.0.1:3001/>. Open that app's ignored `data/gateway/private.json` privately in your editor and use its `email` and `password` to log in. Add provider keys from your own accounts in the dashboard. The gateway client `apiKey` is separate from upstream provider keys. Never paste these values into chat or commit them.

FreeLLMAPI routes requests; it does not create cloud credits or remove provider quotas. Its catalog can include paid models. Check each upstream account/model before choosing it. Cloud selections send the submitted prompts/code/CV content to that provider. Local Ollama remains the default coding route; API/cloud routes can be configured through the dashboard even when Ollama is unavailable.

## Use the gateway inside JobOS

1. Start JobOS normally from JOB with `npm.cmd start`.
2. Open **AI models → Configure FreeLLMAPI**.
3. Keep model `local-ollama-jobos-coderlatest` and server `http://127.0.0.1:3001/v1` for the prepared local model. The gateway client key is already saved; leave its password field blank to retain it.
4. Keep **Local SearXNG** (Docker running) or a no-key public search source. Model choice and web retrieval are independent.
5. Click **Save AI settings → Test saved model → Test live search**.
6. Use **Search now** for discovery/contacts/ranking, or analyze/tailor a saved offer in **CV & email tailoring**.

For a different gateway model, save the FreeLLMAPI profile, click **List available models**, copy its exact catalog ID into Model, save and test again. Changing providers does not start a search or rerank old records. Searches stay manual, and email drafts remain unsent.

## Use Codex or Claude Code independently

From the **separate freellmapi folder**, choose one:

```powershell
npm.cmd run codex -- --cwd "C:\path\to\your-project"
npm.cmd run claude -- --cwd "C:\path\to\your-project"
```

You can also enter any project folder in PowerShell and invoke the Claude gateway launcher by its absolute path; it uses that current folder and automatic routing without either flag:

```powershell
cd "C:\path\to\your-project"
node "C:\Users\ROG\Pictures\ensias\project\freellmapi\scripts\code.js" claude
```

This launches a separate gateway-configured Claude session. A plain `claude` command is not globally redirected by these launchers. The absolute-path entry was live-tested from an independent temporary folder with spaces: automatic routing and a real file read passed.

Claude defaults to `auto:coding-quality`. This named chain currently admits Google Gemini 3.5 Flash and 3.6 Flash with a configured key, tool support and a catalog context of at least 131,072 tokens. The gateway lists both at 1,048,576 tokens. Claude uses a 131,072-token window by default. The first audit that correctly found the planted Git bug ran on 3.5. The folder-scope test ran on 3.6. A model's dashboard score alone does not measure whether it followed a coding instruction correctly.

The launcher creates the named chain from eligible models enabled in the dashboard. It respects a disabled member. On startup it checks the chain and stops if an unapproved model or automatic enrollment is enabled. When both Google routes exhaust their allowance, the gateway reports the failure. Both use the same provider, so provider-wide quota can affect them together. The older `claude-code` chain and Default remain available for deliberate use. Check the dashboard's request history to see which model served each turn.

Start a **fresh** session from the repository you intend to work on. The interactive launcher prints the resolved Windows working folder and gateway route before Claude opens. For another repository under `project`, change to that sibling folder in PowerShell and run the same absolute launcher command. `Get-Location` shows your terminal's working directory immediately. For code review, ask for the Git commands and evidence that separate a working-tree change from a committed change.

The gateway ranks eligible coding routes using its dashboard strategy, task type and observed availability. Session affinity prefers the last successful model while it remains usable. On retryable quota/provider failures before output, it cools down that route and tries another eligible member. An empty/exhausted coding chain reports an error rather than reverting to the general pool. This is a ranking heuristic, not a guarantee of correct code or the best answer. Mid-response failures may still need a retry. Check gateway request/attempt records for the actual upstream; the Claude model label alone is not proof.

Codex retains its saved local default; add `--model auto` to opt into the general gateway pool. Either launcher accepts `--model "EXACT_MODEL_ID"` to pin a route. Claude now resolves explicit catalog IDs into strict generated `pin-…` chains, working around an installed Anthropic-adapter issue that treated some canonical IDs as general auto routing. Unknown IDs stop the launcher. Local endpoint IDs stay scoped to their selected endpoint. For local Claude, use `--model local-ollama-jobos-coderlatest`; the 4B model remains experimental for coding. For explicit model changes, restart with `--model` rather than choosing another catalog ID in Claude's in-session menu, which bypasses the launcher resolution. Automatic coding routing may send included code/tool content to any enabled member of the coding chain. Check provider free allowances and disable unwanted routes there.

List configured models with `npm.cmd run models`. JobOS does not need to be running. Run one local model workflow at a time to avoid GPU contention. Normal tool approvals and existing Codex/Claude sign-ins are preserved. JobOS's own saved provider/model is unchanged by these terminal defaults; use the named route in AI models to select the same quality chain.

Claude's coding pool uses a 131,072-token context to leave more room for its tool definitions and conversation; explicit/local selections retain a conservative 32,768-token default. Output defaults to 4,096 tokens. The `CLAUDE_CODE_MAX_CONTEXT_TOKENS` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variables can override these session values. Compaction stays enabled. The earlier "Request too large (max 32MB)" screenshot was reproduced with a 54 KB synthetic request: the gateway rejected context/token allowance, not HTTP byte size. Restart in a fresh session after the change; an existing session retains its old model selection and potentially degraded summary. If every route is too small, compact history or enable a route with enough allowance rather than raising the HTTP body limit.

To use the two Google routes in JobOS, open **AI models → Configure FreeLLMAPI**, enter `auto:coding-quality` in **Model**, save and test. This sends model inputs to Google through your gateway. Select `local-ollama-jobos-coderlatest` for local inference.

Gemini 3.5 Flash correctly identified the arithmetic bug and the branch divergence in a disposable Git repository. A fallback model in the older chain confused the uncommitted change with a commit. See [TESTING.md](TESTING.md) for the evidence.

Both clients passed reply-only connection checks with the local 4B model, but earlier file-tool checks timed out. Autonomous coding with this model/gateway combination remains experimental; inspect changes and run tests. See the separate app's README for official protocol references and the non-Claude-model support limitation in Claude Code.

## Optional JobOS terminal shortcuts

Existing `npm.cmd run gateway:start`, `gateway:models`, `gateway:codex` and `gateway:claude` commands in JOB locate the sibling app only when explicitly invoked. Their absence does not stop JobOS or its isolated test suite. For another installation location, set `FREELLMAPI_DIR` in JobOS's private .env, for example `FREELLMAPI_DIR=../freellmapi`.

`npm.cmd run gateway:setup` is an explicit compatibility action that can import existing JobOS Gemini/Groq/OpenRouter keys and store the gateway client key in JobOS. Normal standalone startup reads its own private configuration and never reads JobOS's CV or credentials. App-saved direct-provider keys and dashboard upstream keys remain separate stores.

Private gateway state and locally installed Claude Code belong to the separate app's ignored data directory. This computer's local Ollama service currently reuses the previously downloaded weights/runtime; its location is private configuration and can be changed to a normal installed Ollama service. No multi-GB weights were duplicated by relocating the gateway.
