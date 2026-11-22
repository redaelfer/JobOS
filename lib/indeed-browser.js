import { randomUUID, createHash } from 'node:crypto';
import { automationPreferences } from './profile.js';
import { searchQueries } from './web-search.js';
import { selectSearchMatches } from './search-policy.js';
import { INDEED_MOROCCO_SCOPE, INDEED_REMOTE_REGION } from './indeed-policy.js';
import { clean, jobUrl, extractTechnologies } from './domain.js';
import { indeedJobKey } from './job-sites.js';

const kind = 'indeedBrowserRuns';
const hash = value => createHash('sha256').update(String(value || '')).digest('hex');
const unfinished = run => ['waiting_browser', 'running', 'paused'].includes(run?.status);
const failure = message => Object.assign(new Error(message), { status: 409 });
export function indeedNavigation(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['ma.indeed.com', 'www.indeed.com'].includes(u.hostname) || u.port || u.username || u.password) return '';
    const key = indeedJobKey(u.href);
    return key ? `${u.origin}/viewjob?jk=${key}` : '';
  } catch { return ''; }
}

// vjk selects a preview in the results pane; it does not change the search.
// Retain filters (including unknown ones), region and page offset, while ignoring
// only presentation/tracking fields. Never equate a posting or application page.
export function indeedListingIdentity(value, { ignorePage = false } = {}) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['ma.indeed.com', 'www.indeed.com'].includes(u.hostname) || u.port || u.username || u.password || !/^\/jobs\/?$/.test(u.pathname)) return '';
    const params = new URLSearchParams(u.search);
    for (const name of [...params.keys()]) {
      if (['vjk', 'vjs', 'tk', 'from', 'advn', 'adid'].includes(name) || name.startsWith('utm_')) params.delete(name);
    }
    for (const name of ['q', 'l', 'sort', 'fromage', 'start']) if (params.getAll(name).length > 1) return '';
    if (!params.get('q')?.trim()) return '';
    const offset = params.get('start');
    if (offset !== null && (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)))) return '';
    if (ignorePage || offset === null || Number(offset) === 0) params.delete('start');
    else params.set('start', String(Number(offset)));
    params.sort();
    return `${u.origin}/jobs?${params}`;
  } catch { return ''; }
}

const sameListing = (a, b, options) => {
  const identity = indeedListingIdentity(a, options);
  return !!identity && identity === indeedListingIdentity(b, options);
};
export function indeedQueries(preferences) {
  return [false, ...(preferences.includeReview === false ? [] : [true])].flatMap(review => searchQueries({ ...preferences, jobSite: 'indeed' }).map(query => {
    const scoped = preferences.indeedOpportunityScope === INDEED_MOROCCO_SCOPE;
    const remote = query.includes('remote Morocco worldwide EMEA') || query.includes(INDEED_REMOTE_REGION);
    const q = query.replace('site:indeed.com/viewjob', '').replace('Morocco Maroc', '').replace('remote Morocco worldwide EMEA', '').replace(INDEED_REMOTE_REGION, '(Morocco OR worldwide OR EMEA)').trim();
    const url = new URL(remote ? 'https://www.indeed.com/jobs' : 'https://ma.indeed.com/jobs');
    url.searchParams.set('q', q); url.searchParams.set('l', remote ? 'Remote' : scoped ? 'Morocco' : preferences.location.replace(/\s*(and|et)\s*remote.*$/i, '') || 'Morocco');
    url.searchParams.set('sort', 'date');
    if (!review) url.searchParams.set('fromage', String(preferences.maxAgeDays));
    return { type: 'listing', url: url.href, review, remote };
  }));
}

// Durable browser cursor. Pages are data, never instructions. Tickets authorize only
// one scan and one expected task; the workspace token/CV never reach Indeed.
export function indeedBrowser(store, { saveJob, isExcluded, busy = () => false, changed = () => {}, now = Date.now } = {}) {
  const read = id => store.get(kind, id);
  const write = run => store.put(kind, run);
  function sync(run) {
    const scan = store.get('scans', run.id);
    const jobs = run.savedIds.map(id => store.get('jobs', id)).filter(j => j && !isExcluded(j));
    const source = { jobSite: 'indeed', status: run.status === 'completed' ? (run.unknown ? 'partial' : 'completed') : run.status === 'skipped' ? 'skipped' : run.status, jobCount: jobs.length, checked: run.checked, unreadable: run.unknown };
    const final = !unfinished(run);
    store.put('scans', { ...scan, status: final ? 'completed' : run.status, browserIndeed: true,
      phase: run.reason || (final ? 'Indeed browser search finished' : `Indeed in Chrome: ${run.checked} posting pages checked`),
      sourceResults: [...(scan.sourceResults || []).filter(s => s.jobSite !== 'indeed'), source],
      newJobIds: [...new Set([...(scan.newJobIds || []), ...run.newIds])].filter(id => { const j = store.get('jobs', id); return j && !isExcluded(j); }),
      savedJobIds: [...new Set([...(scan.savedJobIds || []), ...jobs.map(j => j.id)])],
      closedJobs: [...new Set([...(scan.closedJobs || []), ...(run.closedUrls || [])])],
      technologies: [...(scan.technologies || []).filter(t => !jobs.some(j => j.id === t.jobId)), ...jobs.map(j => ({ jobId: j.id, company: j.company, technologies: extractTechnologies(j.description) }))],
      warnings: [...new Set([...(scan.warnings || []), ...(final && run.unknown ? ['Indeed: some pages were unreadable. Coverage is incomplete.'] : []), ...(run.status === 'skipped' ? ['Indeed was stopped by you. Saved offers are kept; coverage is incomplete.'] : [])])],
      ...(final ? { completedAt: new Date(now()).toISOString() } : { completedAt: null }) });
    changed();
  }
  function pause(run, reason) { run.status = 'paused'; run.reason = reason; run.lease = 0; write(run); sync(run); return run; }
  function pending() {
    const run = store.list(kind).find(unfinished);
    if (run?.status === 'running' && run.lease < now()) pause(run, 'Indeed paused: browser connection lost. Resume from the saved page.');
    return run || null;
  }
  function start(id, settings) {
    if (pending()) throw failure('Resume or stop the existing Indeed search first.');
    const preferences = automationPreferences(settings);
    const run = write({ id, status: 'waiting_browser', reason: 'LinkedIn step finished. Waiting for the JobOS extension in Chrome.', preferences, queue: indeedQueries(preferences), current: null, visited: [], seen: [], savedIds: [], newIds: [], checked: 0, unknown: 0, lease: 0, ticketHash: '' });
    sync(run); return run;
  }
  function launch(id) {
    const run = pending();
    if (run?.id !== id) throw failure('No pending Indeed search with this ID.');
    if (run.status === 'running') throw failure('Indeed is already running in its browser tab.');
    if (busy()) throw failure('Wait for the current workflow or posting review, then resume Indeed.');
    const ticket = randomUUID(); run.ticketHash = hash(ticket); run.status = 'running'; run.reason = 'Indeed: connecting to Chrome'; run.lease = now() + 120000;
    write(run); sync(run); return { ticket };
  }
  function stop(id, { expectedStatus } = {}) {
    const run = read(id); if (!unfinished(run)) throw failure('This Indeed search has finished.');
    if (expectedStatus !== undefined && run.status !== expectedStatus) throw failure('The Indeed search changed. Refresh its status before starting another search.');
    run.status = 'skipped'; run.ticketHash = ''; run.reason = 'Indeed stopped. Previously saved offers are kept.'; write(run); sync(run);
    return { done: true };
  }
  function next(run) {
    while (!run.current && run.queue.length) {
      const task = run.queue.shift();
      if (task.type === 'detail' && isExcluded({ url: task.url })) continue;
      run.current = { ...task, id: randomUUID() };
    }
    if (!run.current) { run.status = 'completed'; run.reason = `Indeed finished: ${run.checked} posting pages checked. Coverage is not exhaustive.`; run.lease = 0; }
    write(run); sync(run);
    return { status: run.status, task: run.current, checked: run.checked, saved: run.savedIds.length, reason: run.reason, done: !unfinished(run) };
  }
  function step(ticket, body) {
    const run = store.list(kind).find(r => r.ticketHash && r.ticketHash === hash(ticket));
    if (!run) throw Object.assign(new Error('Indeed run ticket expired. Resume from JobOS.'), { status: 401 });
    if (!unfinished(run)) return { done: true, status: run.status };
    if (body.action === 'pause') { pause(run, 'Indeed paused. Keep the search tab open, complete any verification yourself, then Resume.'); return { status: run.status }; }
    if (body.action === 'resume') {
      if (busy()) throw failure('Wait for the current workflow or posting review, then resume Indeed.');
      run.status = 'running'; run.reason = 'Indeed: resuming saved page';
    }
    if (run.status !== 'running') return { status: run.status, reason: run.reason };
    if (run.lease < now() && body.action !== 'resume') { pause(run, 'Indeed paused after losing the browser connection.'); return { status: run.status }; }
    run.lease = now() + 120000;
    if (body.action === 'heartbeat') { write(run); return { status: run.status }; }
    if (body.action === 'result' && body.taskId === run.lastAck) return next(run);
    if (body.action === 'result') {
      const task = run.current;
      if (!task || body.taskId !== task.id) throw failure('This result belongs to a different browser task.');
      if (body.blocked || body.attention) {
        const missing = ['title', 'company', 'description'].filter(field => Array.isArray(body.missing) && body.missing.includes(field));
        const reasons = {
          verification: 'Indeed is showing verification. Open its tab, complete it yourself, then Resume.',
          sign_in: 'Indeed is asking you to sign in. Do that yourself in its tab, then Resume.',
          wrong_page: 'The Indeed tab is no longer on the expected search or posting page. Return to that page, then Resume. Do not continue into an application form.',
          unsupported_layout: `JobOS could not read this Indeed page${missing.length ? ': missing ' + missing.join(', ') : ''}. No verification challenge was detected. Reload the JobOS extension after an update, then resume from JobOS, or skip this page.`,
          load_timeout: 'The Indeed page did not finish loading in time. Open its tab, wait for the page to load, then Resume.'
        };
        pause(run, reasons[body.attention] || (body.blocked ? reasons.verification : reasons.unsupported_layout));
        return { status: run.status, reason: run.reason };
      }
      store.db.exec('BEGIN');
      try {
        if (task.type === 'listing') {
          if (!sameListing(body.url, task.url)) throw failure('The Indeed search filters or page changed. Use Open / resume Indeed in JobOS to reopen the expected search.');
          run.visited.push(task.url);
          const details = [];
          for (const raw of Array.isArray(body.links) ? body.links : []) {
            const url = indeedNavigation(raw), key = indeedJobKey(url);
            if (!url || run.seen.includes(key)) continue;
            run.seen.push(key);
            if (!isExcluded({ url })) details.push({ ...task, type: 'detail', url });
          }
          if (body.nextUrl) {
            const candidate = indeedListingIdentity(body.nextUrl);
            const sameQuery = candidate && sameListing(body.nextUrl, task.url, { ignorePage: true });
            if (sameQuery && !run.visited.some(url => sameListing(url, candidate)) && !run.queue.some(t => t.type === 'listing' && sameListing(t.url, candidate))) run.queue.unshift({ ...task, url: body.nextUrl });
          }
          run.queue.unshift(...details);
          if (body.unreadable) run.unknown++;
        } else {
          run.checked++;
          const j = body.job;
          if (!j || !indeedNavigation(body.url) || indeedJobKey(body.url) !== indeedJobKey(task.url) || indeedJobKey(j.url) !== indeedJobKey(task.url)) run.unknown++;
          else if (j.closed) { run.closedUrls = [...new Set([...(run.closedUrls || []), jobUrl(task.url)])]; }
          else if (!isExcluded({ url: task.url }) && clean(j.title, 300) && clean(j.company, 300) && clean(j.description, 50000).length >= 40) {
            const job = { title: clean(j.title, 300), company: clean(j.company, 300), description: clean(j.description, 50000), location: clean(j.location, 300), url: jobUrl(task.url), postingUrl: indeedNavigation(body.url), source: 'Indeed browser', descriptionVerified: true, postedAt: clean(j.postedAt, 100), sourceCheckedAt: new Date(now()).toISOString(), verification: 'found on public posting (read in your browser)', availabilityStatus: 'unconfirmed', availabilityEvidence: 'Readable description; confirm current acceptance and location eligibility.', evidence: 'Read from the Indeed posting in your browser. Country eligibility is unconfirmed.' };
            const excludes = (run.preferences.exclude || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const allowed = !excludes.some(s => job.title.toLowerCase().includes(s)) && selectSearchMatches({ jobs: [job], summary: '' }, { ...run.preferences, jobSite: 'indeed', indeedLocalSearch: task.remote === false }, now()).jobs.length;
            if (allowed) { const result = saveJob(job, run.id); if (result.job && !result.skipped) { if (!run.savedIds.includes(result.job.id)) run.savedIds.push(result.job.id); if (result.created) run.newIds.push(result.job.id); } }
          } else if (!j.closed && !isExcluded({ url: task.url })) run.unknown++;
        }
        run.lastAck = task.id; run.current = null; run.reason = '';
        write(run); sync(run); store.db.exec('COMMIT');
      } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    } else if (!['next', 'resume'].includes(body.action)) throw failure('Unknown Indeed browser action.');
    return next(run);
  }
  function restart() { for (const r of store.list(kind).filter(unfinished)) { r.ticketHash = ''; pause(r, 'JobOS restarted. Resume Indeed from its saved page.'); } }
  return { start, launch, stop, step, pending, restart, active: () => pending()?.status === 'running' };
}
