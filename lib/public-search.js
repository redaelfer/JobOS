import { parseHTML } from 'linkedom';
import { publicUrl } from './public-contacts.js';

const endpoint = 'https://html.duckduckgo.com/html/';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function blocked(message) {
  const error = new Error(message); error.code = 'PUBLIC_SEARCH_BLOCKED'; return error;
}
export function parsePublicSearch(html, query) {
  if (/anomaly-modal|captcha|unusual traffic|automated requests|bots use DuckDuckGo/i.test(html)) throw blocked('Public web search blocked this request. No challenge was bypassed. Try later or capture offers manually.');
  const { document } = parseHTML(html);
  const anchors = [...document.querySelectorAll('.result__a')];
  if (!anchors.length && !document.querySelector('.no-results, #no-results') && !/no (?:more )?results found/i.test(document.textContent || html)) throw blocked('Public web search returned an unsupported page. No remembered results were accepted.');
  const rows = [];
  for (const anchor of anchors) {
    try {
      let url = new URL(anchor.getAttribute('href'), endpoint);
      if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') url = new URL(url.searchParams.get('uddg'));
      publicUrl(url.href);
      if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) continue;
      rows.push({ title: anchor.textContent.trim().slice(0, 400), url: url.href, content: (anchor.closest('.result')?.querySelector('.result__snippet')?.textContent || '').trim().slice(0, 3000) });
    } catch { /* Only literal public source links are returned. */ }
  }
  let next = null;
  for (const form of document.querySelectorAll('form')) {
    const submit = form.querySelector('input[type="submit"], button[type="submit"]');
    if (!/^next/i.test(submit?.getAttribute('value') || submit?.textContent || '')) continue;
    let target; try { target = new URL(form.getAttribute('action') || endpoint, endpoint); } catch { continue; }
    if (target.origin !== new URL(endpoint).origin || target.pathname !== '/html/') continue;
    const params = new URLSearchParams({ q: query });
    for (const field of form.querySelectorAll('input[type="hidden"]')) {
      const name = field.getAttribute('name'), value = field.getAttribute('value') || '';
      if (['s', 'nextParams', 'v', 'o', 'dc', 'api', 'vqd', 'kl', 'df'].includes(name) && value.length < 1000) params.set(name, value);
    }
    if (/^\d+$/.test(params.get('s') || '')) next = params;
  }
  return { rows, next };
}
export function createPublicSearch({ fetcher = fetch, searchPause = pause, searchNow = Date.now, publicQueryBudgetMs = 120000 } = {}) {
  let lastRequest = null, lastBlock = null;
  async function query(text, recentDays, { firstPageOnly = false } = {}) {
    if (lastBlock) throw lastBlock;
    const query = String(text || '').trim().slice(0, 580), rows = [], seen = new Set(), warnings = [];
    if (!query) throw new Error('A public search query is required.');
    let params = new URLSearchParams({ q: query });
    if (recentDays) params.set('df', recentDays <= 1 ? 'd' : recentDays <= 7 ? 'w' : 'm');
    let offset = -1, post = false;
    const deadline = searchNow() + publicQueryBudgetMs;
    while (params) {
      if (searchNow() >= deadline) { warnings.push('Public search reached its per-query time budget; coverage is incomplete.'); break; }
      try {
        if (lastRequest !== null) await searchPause(Math.max(0, 1500 - (searchNow() - lastRequest)));
        lastRequest = searchNow();
        let response;
        try {
          response = await fetcher(post ? endpoint : endpoint + '?' + params, { method: post ? 'POST' : 'GET', headers: { Accept: 'text/html', 'User-Agent': 'JobOS/0.2 (personal public job research)', ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: post ? params.toString() : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
        } catch { throw blocked('Public web search could not be reached or timed out. Check the connection or capture offers manually.'); }
        if (!response.ok) throw blocked(`Public web search is unavailable (HTTP ${response.status}). Try later or capture offers manually.`);
        if (!/^text\/html/i.test(response.headers.get('content-type') || '')) throw blocked('Public web search returned an unsupported response.');
        const html = await response.text();
        if (html.length > 1000000) throw blocked('Public web search returned an oversized page.');
        const page = parsePublicSearch(html, query);
        let added = 0;
        for (const row of page.rows) if (!seen.has(row.url)) { seen.add(row.url); rows.push(row); added++; }
        const nextOffset = Number(page.next?.get('s'));
        if (firstPageOnly || !page.next || !added || nextOffset <= offset) break;
        offset = nextOffset; params = page.next; post = true;
      } catch (error) {
        if (error.code === 'PUBLIC_SEARCH_BLOCKED') lastBlock = error;
        if (!rows.length) throw error;
        warnings.push(error.message); break;
      }
    }
    return { rows, warnings };
  }
  return { query };
}
