import { requestJSON } from './ai-client.js';
import { validateLocalSearchUrl } from './ai-config.js';
import { publicUrl } from './public-contacts.js';

export function createSearxngSearch(baseUrl, { fetcher = fetch, searchPause = ms => new Promise(resolve => setTimeout(resolve, ms)), searchNow = Date.now, publicQueryBudgetMs = 120000 } = {}) {
  const base = validateLocalSearchUrl(baseUrl);
  let blocked = null, lastRequest = null;
  return { async query(text, recentDays, { firstPageOnly = false } = {}) {
    if (blocked) throw blocked;
    const rows = [], seen = new Set(), warnings = [], deadline = searchNow() + publicQueryBudgetMs;
    for (let page = 1; ; page++) {
      if (searchNow() >= deadline) { warnings.push('Local SearXNG reached its per-query time budget; coverage is incomplete.'); break; }
      if (lastRequest !== null) await searchPause(Math.max(0, 1500 - (searchNow() - lastRequest)));
      lastRequest = searchNow();
      const url = new URL(base + '/search');
      url.searchParams.set('q', String(text).slice(0, 580)); url.searchParams.set('format', 'json'); url.searchParams.set('pageno', String(page));
      if (recentDays) url.searchParams.set('time_range', recentDays <= 1 ? 'day' : recentDays <= 30 ? 'month' : 'year');
      try {
        const result = await requestJSON(url.href, { fetcher, timeoutMs: 30000, label: 'Local SearXNG' });
        if (!Array.isArray(result.results)) throw new Error('Local SearXNG returned an unsupported result. Enable the JSON format in its settings.');
        if (result.unresponsive_engines?.length) {
          if (!result.results.length) throw new Error('Local SearXNG upstream search engines are unavailable. Coverage is incomplete; retry later or change search source.');
          if (!warnings.length) warnings.push('Some local SearXNG upstream search engines did not respond; coverage is incomplete.');
        }
        let added = 0;
        for (const item of result.results) {
          try { publicUrl(item.url); } catch { continue; }
          if (typeof item.title !== 'string' || seen.has(item.url)) continue;
          seen.add(item.url); added++; rows.push({ title: item.title.slice(0, 400), url: item.url, content: String(item.content || '').slice(0, 3000) });
        }
        if (firstPageOnly || !added) break;
      } catch (cause) {
        blocked = Object.assign(new Error(cause.message), { code: 'SEARCH_SOURCE_BLOCKED' });
        if (!rows.length) throw blocked;
        warnings.push(blocked.message); break;
      }
    }
    return { rows, warnings };
  } };
}
