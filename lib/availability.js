import { parseHTML } from 'linkedom';
import { jobUrl } from './domain.js';
import { fetchPublicText, publicUrl } from './public-contacts.js';
import { randomUUID } from 'node:crypto';
import { isClosureNotice } from '../extension/closure-notice.js';
import { indeedBlocked } from './job-sites.js';

const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
const fold = value => cleanText(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase();
function postingAddress(value) {
  const url = new URL(jobUrl(value));
  return url.origin + url.pathname.replace(/\/$/, '') + url.search;
}

export async function checkPostingAvailability(job, fetchPage = fetchPublicText) {
  const unknown = { status: 'unknown' };
  try {
    const page = await fetchPage(job.url);
    if (postingAddress(page.url) !== postingAddress(job.url) || indeedBlocked(page.text)) return unknown;
    const { document } = parseHTML(page.text);
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical && postingAddress(new URL(canonical, page.url).href) !== postingAddress(job.url)) return unknown;
    if (/authwall|sign in|log in|connexion|security check|access denied|page not found/i.test(document.title || '')) return unknown;
    const hasJobData = [...document.querySelectorAll('script[type="application/ld+json"]')].some(el => /"JobPosting"/.test(el.textContent));
    document.querySelectorAll('script, style, template, noscript, nav, aside, footer, [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"], [class*="similar-job"], [class*="related-job"], [class*="recommendation"], [data-testid*="related"], [data-testid*="recommend"], [itemprop="description"], .description__text, .show-more-less-html__markup, #jobDescriptionText, [data-testid="job-description"]').forEach(el => el.remove());
    const root = document.querySelector('main, [role="main"]') || document.body;
    if (!root || root.querySelector('input[type="password"], iframe[src*="captcha"]')) return unknown;
    const primary = root.querySelector('.top-card-layout, .jobs-unified-top-card, .job-details-jobs-unified-top-card__container--two-pane');
    const scopes = primary ? [primary, ...root.querySelectorAll('[role="alert"], [class*="closed-job"], [class*="closed-status"]')] : [root];
    const visibleText = fold(root.innerText);
    const identified = hasJobData || (visibleText.includes(fold(job.title)) && visibleText.includes(fold(job.company)));
    // A detail URL can turn into a directory of other jobs or a generic landing page.
    // Accept a stand-alone closure heading when the original title has been removed.
    const detailUrl = /^https:\/\/www\.(?:linkedin\.com\/jobs\/view\/\d+\/|indeed\.com\/viewjob\?jk=[0-9a-f]+)$/.test(jobUrl(job.url));
    for (const scope of scopes) {
      for (const el of [...scope.querySelectorAll('h1,h2,h3,p,span,div,li,strong,section,button,figcaption,[role="alert"]'), scope]) {
        if (el.childElementCount > 2) continue;
        const evidence = cleanText(el.innerText);
        if (evidence.length > 180 || !isClosureNotice(evidence)) continue;
        if (identified || detailUrl || el.matches('h1, [role="alert"]') || visibleText === fold(evidence)) return { status: 'closed', evidence };
      }
    }
    return { status: identified ? 'noNotice' : 'unknown' };
  } catch {
    return unknown;
  }
}

function newReport(jobs, mode) {
  const withoutLink = jobs.filter(job => !job.url).length;
  return { id: 'latest', reviewId: randomUUID(), mode, status: 'running', startedAt: new Date().toISOString(), completedAt: null, error: '', total: jobs.length - withoutLink, checked: 0, withoutLink, unknown: 0, noNotice: 0, skipped: 0, matches: [], unverified: [] };
}

function currentJob(store, item) {
  const job = store.get('jobs', item.jobId);
  return job && job.stage !== 'Closed' && job.url === item.url ? job : null;
}

function recordOutcome(store, report, item, result) {
  report.checked++;
  if (!result || !currentJob(store, item)) report.skipped++;
  else if (result.status === 'closed' && isClosureNotice(result.evidence)) {
    report.matches.push({ ...item, evidence: result.evidence, checkedAt: new Date().toISOString() });
  } else if (result.status === 'noNotice') report.noNotice++;
  else { report.unknown++; report.unverified.push(item); }
  if (report.checked === report.total) {
    report.status = 'completed';
    report.completedAt = new Date().toISOString();
  }
  store.put('availabilityChecks', report);
}

const linkedItems = jobs => jobs.filter(job => job.url).map(job => ({ jobId: job.id, url: job.url }));

export function startAvailabilityCheck(store, fetchPage) {
  const previous = availabilityReport(store);
  if (previous?.status === 'running') return previous;
  const jobs = store.list('jobs').filter(job => job.stage !== 'Closed');
  const report = store.put('availabilityChecks', newReport(jobs, 'public'));
  async function run() {
    for (const item of linkedItems(jobs)) {
      const job = currentJob(store, item);
      recordOutcome(store, report, item, job ? await checkPostingAvailability(job, fetchPage) : null);
    }
    if (!report.total) store.put('availabilityChecks', { ...report, status: 'completed', completedAt: new Date().toISOString() });
  }
  run().catch(() => store.put('availabilityChecks', { ...report, status: 'failed', error: 'The check stopped early. Run it again.' }));
  return report;
}

export function availabilityReport(store) {
  const report = store.get('availabilityChecks', 'latest');
  if (report?.mode === 'browser' && report.status === 'running' && Date.now() > report.expiresAt) {
    return store.put('availabilityChecks', { ...report, status: 'paused', error: 'Browser disconnected. Continue to check the remaining links.' });
  }
  return report;
}

export function closeUnavailableJobs(store, { reviewId, jobIds }) {
  if (!reviewId || !Array.isArray(jobIds) || !jobIds.length || jobIds.some(id => typeof id !== 'string')) throw Error('Choose offers from the completed review.');
  const selected = new Set(jobIds);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const report = store.get('availabilityChecks', 'latest');
    if (report?.status !== 'completed' || (report.reviewId || report.startedAt) !== reviewId) {
      throw Object.assign(Error('The availability review changed. Refresh and review the current list.'), { status: 409 });
    }
    let closed = 0;
    const updatedAt = new Date().toISOString();
    for (const match of report.matches) {
      if (!selected.has(match.jobId)) continue;
      const job = currentJob(store, match);
      if (!job) continue;
      store.put('jobs', { ...job, stage: 'Closed', updatedAt });
      closed++;
    }
    store.db.exec('COMMIT');
    return { closed };
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

const renew = () => Date.now() + 120000;
export function startBrowserReview(store) {
  let report = availabilityReport(store);
  if (report?.status === 'running') return { report };
  const ticket = randomUUID();
  let queue = store.get('browserReviewQueue', 'latest');
  if (!queue || report?.mode !== 'browser' || report.status !== 'paused') {
    const jobs = store.list('jobs').filter(job => job.stage !== 'Closed');
    report = newReport(jobs, 'browser');
    queue = { id: 'latest', items: linkedItems(jobs) };
  }
  store.put('browserReviewQueue', { ...queue, ticket });
  report = store.put('availabilityChecks', { ...report, status: report.total ? 'running' : 'completed', error: '', expiresAt: renew(), completedAt: report.total ? null : new Date().toISOString() });
  return { report, ticket: report.total ? ticket : null };
}

// Only the browser page launched for this run gets the ticket. The cursor makes
// retrying a result harmless and stops an old tab from changing a newer run.
export function browserReviewStep(store, ticket, body) {
  const queue = store.get('browserReviewQueue', 'latest');
  if (!ticket || queue?.ticket !== ticket) throw Object.assign(Error('This review is no longer active.'), { status: 403 });
  const report = availabilityReport(store);
  if (report?.mode !== 'browser' || report.status !== 'running') return { status: report?.status || 'stopped' };
  report.expiresAt = renew();
  if (body.action === 'pause') {
    store.put('availabilityChecks', { ...report, status: 'paused', error: 'Continue the browser check to review the remaining offers.' });
    return { status: 'paused' };
  }
  if (body.action === 'result' && body.index === report.checked) {
    const item = queue.items[report.checked];
    if (!item || body.jobId !== item.jobId || !['closed', 'unknown', 'noNotice'].includes(body.status)) throw Error('Invalid posting result.');
    recordOutcome(store, report, item, { status: body.status, evidence: String(body.evidence || '').slice(0, 180) });
  } else if (!['plan', 'next', 'result'].includes(body.action)) throw Error('Unknown review action.');
  while (report.checked < report.total) {
    const item = queue.items[report.checked];
    const job = currentJob(store, item);
    if (!job) { recordOutcome(store, report, item, null); continue; }
    try { publicUrl(item.url); } catch { recordOutcome(store, report, item, { status: 'unknown' }); continue; }
    store.put('availabilityChecks', report);
    if (body.action === 'plan') {
      const origins = new Set();
      for (const remaining of queue.items.slice(report.checked)) {
        if (!currentJob(store, remaining)) continue;
        try { origins.add(publicUrl(remaining.url).origin + '/*'); } catch { /* Unsupported links count as unverified. */ }
      }
      return { status: 'running', origins: [...origins] };
    }
    return { status: 'running', index: report.checked, total: report.total, job: { ...item, title: job.title, company: job.company } };
  }
  return { status: 'completed' };
}
