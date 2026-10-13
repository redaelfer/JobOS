import { parseHTML } from 'linkedom';
import { jobUrl } from './domain.js';

function unavailable(message) { const error = new Error(message); error.code = 'PUBLIC_SEARCH_BLOCKED'; return error; }
export function parseLinkedInListings(html) {
  if (/captcha|checkpoint|authwall/i.test(html)) throw unavailable('Public LinkedIn listings are blocked or require sign-in. Capture offers manually; no access restriction was bypassed.');
  const { document } = parseHTML(html), rows = [];
  for (const card of document.querySelectorAll('.base-search-card, .job-search-card')) {
    const anchor = card.querySelector('a[href*="/jobs/view/"]'), title = card.querySelector('.base-search-card__title')?.textContent.trim(), company = card.querySelector('.base-search-card__subtitle')?.textContent.trim();
    if (!anchor || !title || !company) continue;
    let url; try { url = jobUrl(anchor.getAttribute('href')); } catch { continue; }
    if (!/^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/\d+\/$/.test(url)) continue;
    rows.push({ title: `${title} · ${company}`.slice(0, 400), url, content: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 3000) });
  }
  if (!rows.length && html.trim() && !/no results|no matching|no jobs|base-search-card|job-search-card/i.test(html)) throw unavailable('Public LinkedIn returned an unreadable listing page. Capture offers manually or retry later.');
  return rows;
}
export function createLinkedInPublicSearch({ fetcher = fetch, searchPause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), searchNow = Date.now, publicQueryBudgetMs = 120000 } = {}) {
  let lastRequest = null, lastBlock = null;
  async function query(text, recentDays, { firstPageOnly = false } = {}) {
    if (lastBlock) throw lastBlock;
    const remote = /remote/i.test(text), keywords = text.replace(/site:linkedin\.com\/jobs\/view/g, '').replace(/Morocco Maroc|remote Morocco worldwide EMEA/gi, '').trim().slice(0, 580);
    const rows = [], seen = new Set(), warnings = [], deadline = searchNow() + publicQueryBudgetMs;
    for (let start = 0; ; start += 25) {
      if (searchNow() >= deadline) { warnings.push('Public LinkedIn listing time budget reached; coverage is incomplete.'); break; }
      try {
        if (lastRequest !== null) await searchPause(Math.max(0, 1500 - (searchNow() - lastRequest)));
        lastRequest = searchNow();
        const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
        url.searchParams.set('keywords', keywords); url.searchParams.set('start', String(start));
        url.searchParams.set('sortBy', 'DD');
        if (remote) { url.searchParams.set('location', 'Worldwide'); url.searchParams.set('f_WT', '2'); }
        else if (/Morocco|Maroc/i.test(text)) url.searchParams.set('location', 'Morocco');
        if (recentDays) url.searchParams.set('f_TPR', 'r' + recentDays * 86400);
        let response;
        try { response = await fetcher(url.href, { headers: { Accept: 'text/html', 'User-Agent': 'JobOS/0.2 (personal public job research)' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
        catch { throw unavailable('Public LinkedIn could not be reached or timed out. Check the connection or capture offers manually.'); }
        if (!response.ok) throw unavailable(`Public LinkedIn listings are unavailable (HTTP ${response.status}). Try later or capture offers manually.`);
        if (!/^text\/html/i.test(response.headers.get('content-type') || '')) throw unavailable('Public LinkedIn returned an unsupported response.');
        const html = await response.text(); if (html.length > 1000000) throw unavailable('Public LinkedIn listing page is too large.');
        const page = parseLinkedInListings(html); let added = 0;
        for (const row of page) if (!seen.has(row.url)) { rows.push(row); seen.add(row.url); added++; }
        if (firstPageOnly || !added) break;
      } catch (error) { lastBlock = error; if (!rows.length) throw error; warnings.push(error.message); break; }
    }
    return { rows, warnings };
  }
  return { query };
}
