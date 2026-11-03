import { parseHTML } from 'linkedom';
import { jobUrl } from './domain.js';
import { indeedJobKey, indeedBlocked } from './job-sites.js';

function unavailable(message) { return Object.assign(new Error(message), { code: 'PUBLIC_SEARCH_BLOCKED' }); }
export function parseIndeedListings(html, base = 'https://ma.indeed.com/jobs') {
  if (indeedBlocked(html)) throw unavailable('Public Indeed requires verification. No challenge was bypassed. Try a configured search API or retry later.');
  const { document } = parseHTML(html), rows = [], seen = new Set();
  for (const anchor of document.querySelectorAll('a[data-jk], a[href*="jk="], a[href*="vjk="]')) {
    let url; try { url = jobUrl(new URL(anchor.getAttribute('href') || '', base).href); } catch { continue; }
    if (!indeedJobKey(url) || seen.has(url)) continue;
    const card = anchor.closest('.job_seen_beacon, .cardOutline, [data-testid="job-card"]') || anchor.parentElement;
    const title = anchor.querySelector('span[title]')?.getAttribute('title') || anchor.textContent.trim();
    const company = card?.querySelector('[data-testid="company-name"], .companyName')?.textContent.trim();
    if (!title || !company) continue;
    seen.add(url); rows.push({ title: `${title} · ${company}`.slice(0, 400), url, content: card.textContent.replace(/\s+/g, ' ').slice(0, 3000) });
  }
  let next = null;
  const href = document.querySelector('a[data-testid="pagination-page-next"], a[aria-label="Next Page"], a[aria-label="Suivant"]')?.getAttribute('href');
  if (href) try { const target = new URL(href, base), source = new URL(base); if (target.origin === source.origin && target.pathname === '/jobs' && !target.username && !target.password) next = target.href; } catch {}
  if (!rows.length && html.trim() && !/no jobs found|did not match any jobs|aucun résultat|aucune offre/i.test(document.textContent || html)) throw unavailable('Public Indeed returned an unreadable listing page. Try a configured search API or retry later.');
  return { rows, next };
}
export function createIndeedPublicSearch({ fetcher = fetch, searchPause = ms => new Promise(resolve => setTimeout(resolve, ms)), searchNow = Date.now, publicQueryBudgetMs = 120000 } = {}) {
  let block = null, lastRequest = null;
  return { async query(text, recentDays, { firstPageOnly = false } = {}) {
    if (block) throw block;
    const first = new URL('https://ma.indeed.com/jobs');
    first.searchParams.set('q', text.replace(/site:indeed\.com(?:\/viewjob)?/g, '').replace(/Morocco Maroc|remote Morocco worldwide EMEA/gi, '').trim());
    first.searchParams.set('l', /remote/i.test(text) ? 'Remote' : 'Morocco'); first.searchParams.set('sort', 'date');
    if (recentDays) first.searchParams.set('fromage', String(recentDays));
    const rows = [], warnings = [], seen = new Set(), visited = new Set(), deadline = searchNow() + publicQueryBudgetMs;
    let next = first.href;
    while (next && !visited.has(next)) {
      if (searchNow() >= deadline) { warnings.push('Public Indeed time budget reached; coverage is incomplete.'); break; }
      visited.add(next);
      try {
        if (lastRequest !== null) await searchPause(Math.max(0, 1500 - (searchNow() - lastRequest)));
        lastRequest = searchNow();
        let response; try { response = await fetcher(next, { headers: { Accept: 'text/html', 'User-Agent': 'JobOS/0.2 (personal public job research)' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); } catch { throw unavailable('Public Indeed could not be reached. Check the connection or try a configured search API.'); }
        if (!response.ok) throw unavailable(`Public Indeed is unavailable (HTTP ${response.status}). Try later or select a search API.`);
        if (!/^text\/html/i.test(response.headers.get('content-type') || '')) throw unavailable('Public Indeed returned an unsupported response.');
        const html = await response.text(); if (html.length > 1000000) throw unavailable('Public Indeed listing is too large.');
        const page = parseIndeedListings(html, next); let added = 0;
        for (const row of page.rows) if (!seen.has(row.url)) { seen.add(row.url); rows.push(row); added++; }
        if (firstPageOnly || !added) break;
        next = page.next;
      } catch (error) { block = error; if (!rows.length) throw error; warnings.push(error.message); break; }
    }
    return { rows, warnings };
  } };
}
