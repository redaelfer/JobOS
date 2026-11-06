import { validateLocalSearchUrl } from './ai-config.js';
import { searchRunSource, searchSourceLabel } from './search-warnings.js';

// Read-only diagnostics. Never print the full workspace response: it contains
// the CV, notes and pairing token. Only the public setup facts below are returned.
export async function diagnoseLocalSetup({ fetcher = fetch, appBase = 'http://127.0.0.1:4317' } = {}) {
  const checks = [];
  let state;
  try {
    const response = await fetcher(appBase + '/api/state', { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(); state = await response.json();
    checks.push({ ok: true, message: 'JobOS is running. Open ' + appBase + '/#models' });
  } catch { checks.push({ ok: false, message: 'JobOS is not reachable. Run npm start in the project folder.' }); }
  try {
    const response = await fetcher('http://127.0.0.1:11434/api/tags', { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(); const result = await response.json();
    const names = (result.models || []).map(model => String(model.name || '')).filter(name => /^[\w][\w.:/-]{0,119}$/.test(name) && !/cloud/i.test(name));
    checks.push({ ok: names.length > 0, message: names.length ? 'Local Ollama models: ' + names.join(', ') + '. A model test is still required to check generation.' : 'Ollama is running but has no downloaded local model. Open AI models → Download model.' });
  } catch { checks.push({ ok: false, message: 'Local Ollama is not reachable. Start it, or use Download model in AI models to install/start it.' }); }
  if (state?.ai) {
    const source = state.ai.provider === 'codex' ? 'codex' : state.ai.searchProvider;
    checks.push({ ok: true, message: 'Selected generation provider: ' + String(state.ai.provider).replace(/[^\w-]/g, '') + '. Selected search: ' + searchSourceLabel(source) + '.' });
    if (source === 'searxng') {
      try {
        const base = validateLocalSearchUrl(state.ai.searchBaseUrl);
        const response = await fetcher(base + '/', { redirect: 'error', signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error();
        checks.push({ ok: true, message: 'Local SearXNG is reachable. Test live search in the app separately; websites can still block queries.' });
      } catch { checks.push({ ok: false, message: 'Local SearXNG is not reachable. Start Docker Desktop, then Install / start local search in AI models.' }); }
    }
    const failed = state.scans?.find(run => run.status === 'failed');
    if (failed) checks.push({ ok: true, message: 'Saved failed-search history used ' + searchSourceLabel(searchRunSource(failed)) + '. Current search uses ' + searchSourceLabel(source) + '. An old error is not a fresh connection test.' });
  }
  return checks;
}
