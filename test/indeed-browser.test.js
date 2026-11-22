import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { openStore } from '../lib/store.js';
import { indeedBrowser, indeedNavigation, indeedListingIdentity, indeedQueries } from '../lib/indeed-browser.js';
import { createApp } from '../server.js';
import { readIndeedPage } from '../extension/indeed-reader.js';
import { offerLink } from '../public/application-tools.js';
const settings = { searchDomains: 'Data science', searchLocation: 'Morocco and remote roles', searchLevel: 'Graduate / Entry level', searchMaxAgeDays: 30, searchIncludeReview: true, resume: 'PRIVATE_CV_DO_NOT_QUERY' };
const url = n => 'https://ma.indeed.com/viewjob?jk=' + n.toString(16).padStart(16, '0');
const job = n => ({ title: 'Junior Data Scientist', company: 'Fixture employer', location: 'Morocco', url: url(n), description: 'Build machine learning models in Python and SQL with the data science team.', postedAt: new Date(Date.now() - 86400000).toISOString() });
function fixture(t, preferences = {}) {
  const store = openStore(':memory:'); t.after(() => store.db.close());
  let clock = Date.now(), busy = false;
  const ignored = new Set();
  const manager = indeedBrowser(store, { now: () => clock, busy: () => busy, isExcluded: j => ignored.has(indeedNavigation(j.url)), saveJob: input => {
    const old = store.list('jobs').find(j => j.url === input.url);
    return { job: old || store.put('jobs', input), created: !old };
  } });
  store.put('scans', { id: 'run', status: 'completed', sourceResults: [{ jobSite: 'linkedin', status: 'completed', jobCount: 1 }], newJobIds: [], summary: 'LinkedIn checked', closedJobs: [] });
  manager.start('run', { ...settings, ...preferences });
  return { store, manager, ignored, clock: value => { clock += value; }, busy: value => { busy = value; } };
}

test('scoped browser ingestion keeps Moroccan roles and junior remote while rejecting senior and foreign-only results', t => {
  const { manager, store } = fixture(t, { indeedOpportunityScope: 'morocco-junior-remote' });
  const { ticket } = manager.launch('run');
  let next = manager.step(ticket, { action: 'next' });
  const rows = [
    { ...job(1), title: 'Data Scientist', location: 'Casablanca' },
    { ...job(2), title: 'Data Architect' },
    { ...job(3), title: 'Data Scientist', location: 'Remote' },
    { ...job(4), location: 'Remote' },
    { ...job(5), location: 'Remote - USA' },
    { ...job(6), title: 'Data Scientist', location: '' }
  ];
  next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: next.task.url, links: rows.map(j => j.url) });
  for (const row of rows) next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: row.url, job: row });
  const saved = store.list('jobs');
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.map(j => j.postingUrl).sort(), [url(1), url(4), url(6)]);
  assert.match(saved.find(j => j.postingUrl === url(4)).evidence, /Morocco is unconfirmed/);
  assert.match(saved.find(j => j.postingUrl === url(6)).evidence, /location could not be read/);
  assert.equal(store.get('indeedBrowserRuns', 'run').preferences.indeedOpportunityScope, 'morocco-junior-remote');
});

test('selected-job vjk on the same listing continues to capture a direct Indeed posting link', t => {
  const { manager, store } = fixture(t); const { ticket } = manager.launch('run');
  let next = manager.step(ticket, { action: 'next' });
  const selectedUrl = next.task.url + '&vjk=dd284136f502336c';
  next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: selectedUrl, links: [url(1)] });
  assert.equal(next.task.type, 'detail');
  manager.step(ticket, { action: 'result', taskId: next.task.id, url: url(1), job: job(1) });
  const saved = store.list('jobs'); assert.equal(saved.length, 1);
  assert.equal(saved[0].postingUrl, url(1));
  assert.match(offerLink(saved[0]), /Indeed/); assert.ok(offerLink(saved[0]).includes(url(1)));
});

test('listing identity ignores previews and tracking, but preserves filters, region and pagination', () => {
  const expected = 'https://ma.indeed.com/jobs?q=junior+Data+Scientist&l=Morocco&sort=date&fromage=30';
  const reported = expected + '&vjk=dd284136f502336c';
  const identity = indeedListingIdentity(expected);
  assert.equal(indeedListingIdentity(reported), identity, 'exact URL reported by the user');
  assert.equal(indeedListingIdentity('https://ma.indeed.com/jobs/?fromage=30&sort=date&l=Morocco&q=junior%20Data%20Scientist&start=0&vjk=dd284136f502336c&tk=tracking&utm_source=indeed#preview'), identity);
  for (const changed of [expected.replace('Scientist', 'Engineer'), expected.replace('Morocco', 'France'), expected.replace('sort=date', 'sort=relevance'), expected.replace('fromage=30', 'fromage=7'), expected.replace('&fromage=30', ''), expected.replace('ma.', 'www.'), expected + '&start=10', expected + '&jt=contract', expected + '&remotejob=1']) {
    assert.notEqual(indeedListingIdentity(changed), identity, changed);
  }
  for (const unsafe of ['https://evil.test/jobs?q=x', expected.replace('https:', 'http:'), expected.replace('ma.indeed.com', 'user:pass@ma.indeed.com'), expected.replace('/jobs?', '/viewjob?'), expected.replace('/jobs?', '/beta/indeedapply?'), expected + '&q=another', expected + '&start=-10', expected + '&start=1.5', 'not a URL']) {
    assert.equal(indeedListingIdentity(unsafe), '', unsafe);
  }
});

test('a genuinely changed listing cannot save links and can resume the original task', t => {
  const { manager, store } = fixture(t); const { ticket } = manager.launch('run');
  const first = manager.step(ticket, { action: 'next' });
  assert.throws(() => manager.step(ticket, { action: 'result', taskId: first.task.id, url: first.task.url + '&start=10', links: [url(1)] }), /filters or page changed/);
  assert.equal(store.list('jobs').length, 0);
  assert.equal(store.get('indeedBrowserRuns', 'run').current.id, first.task.id);
  const next = manager.step(ticket, { action: 'result', taskId: first.task.id, url: first.task.url + '&vjk=dd284136f502336c', links: [url(1)] });
  assert.equal(next.task.type, 'detail');
});

test('pagination accepts harmless URL changes but stops preview loops and bad filters', t => {
  const { manager, store } = fixture(t); const { ticket } = manager.launch('run');
  let next = manager.step(ticket, { action: 'next' }); const first = next.task;
  const secondUrl = first.url + '&start=10&vjk=dd284136f502336c';
  next = manager.step(ticket, { action: 'result', taskId: first.id, url: first.url + '&vjk=dd284136f502336c', links: [], nextUrl: secondUrl });
  assert.equal(next.task.url, secondUrl);
  next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: secondUrl + '&utm_source=test', links: [], nextUrl: first.url + '&start=0&vjk=0000000000000002' });
  assert.notEqual(indeedListingIdentity(next.task.url), indeedListingIdentity(first.url));
  const size = store.get('indeedBrowserRuns', 'run').queue.length;
  const third = next.task;
  manager.step(ticket, { action: 'result', taskId: third.id, url: third.url, links: [], nextUrl: third.url + '&start=20&jt=contract' });
  assert.equal(store.get('indeedBrowserRuns', 'run').queue.length, size - 1);
});
test('browser discovery persists >25 jobs, pagination and separate review queries without CV data', t => {
  const { store, manager } = fixture(t);
  assert.ok(!JSON.stringify(store.get('indeedBrowserRuns', 'run')).includes('PRIVATE_CV'));
  const plan = store.get('indeedBrowserRuns', 'run').queue;
  assert.ok(plan.some(t => t.remote)); assert.ok(plan.some(t => t.review));
  assert.ok(plan.filter(t => !t.review).every(t => new URL(t.url).searchParams.get('fromage') === '30'));
  const { ticket } = manager.launch('run'); let next = manager.step(ticket, { action: 'next' });
  const first = next.task; const nextUrl = first.url + '&start=25';
  next = manager.step(ticket, { action: 'result', taskId: first.id, url: first.url, links: Array.from({ length: 27 }, (_, i) => url(i + 1)), nextUrl });
  assert.equal(next.task.type, 'detail');
  for (let i = 1; i <= 27; i++) {
    const data = { action: 'result', taskId: next.task.id, url: url(i), job: job(i) };
    next = manager.step(ticket, data);
    assert.deepEqual(manager.step(ticket, data), next, 'ack replay must not advance twice');
  }
  assert.equal(store.list('jobs').length, 27);
  assert.equal(next.task.url, nextUrl);
  assert.equal(store.get('scans', 'run').sourceResults[0].jobSite, 'linkedin');
  assert.equal(store.get('scans', 'run').newJobIds.length, 27);
  assert.ok(store.list('jobs').every(j => j.postingUrl.startsWith('https://ma.indeed.com/')));
  manager.stop('run'); assert.equal(store.list('jobs').length, 27);
  assert.equal(store.get('scans', 'run').sourceResults.at(-1).status, 'skipped');
});
test('challenge/restart/lease preserve cursor, reject old tickets and release workflow while paused', t => {
  const { store, manager, clock, busy } = fixture(t);
  const { ticket } = manager.launch('run'); const first = manager.step(ticket, { action: 'next' });
  assert.throws(() => manager.launch('run'), /already running/);
  manager.step(ticket, { action: 'result', taskId: first.task.id, blocked: true });
  assert.equal(manager.active(), false);
  busy(true); assert.throws(() => manager.step(ticket, { action: 'resume' }), /Wait/); busy(false);
  const resumed = manager.step(ticket, { action: 'resume' }); assert.equal(resumed.task.id, first.task.id);
  assert.throws(() => manager.stop('run', { expectedStatus: 'paused' }), /search changed/);
  assert.equal(manager.active(), true);
  clock(130000); assert.equal(manager.active(), false);
  manager.restart(); assert.equal(store.get('scans', 'run').status, 'paused');
  assert.throws(() => manager.step(ticket, { action: 'next' }), /expired/);
  const second = manager.launch('run'); assert.notEqual(second.ticket, ticket);
  assert.equal(manager.step(second.ticket, { action: 'next' }).task.id, first.task.id);
  assert.ok(!JSON.stringify(store.get('scans', 'run')).includes(second.ticket));
});
test('late deleted/closed/expired results and wrong posting identities do not create jobs', t => {
  const { manager, store, ignored } = fixture(t); const { ticket } = manager.launch('run');
  const first = manager.step(ticket, { action: 'next' });
  let next = manager.step(ticket, { action: 'result', taskId: first.task.id, url: first.task.url, links: [url(1), url(2), url(3), url(4), 'https://evil.test/viewjob?jk=123456789abcdef0'] });
  ignored.add(url(1)); ignored.add(url(2)); ignored.add(url(3));
  next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: url(1), job: job(1) });
  assert.equal(next.task.url, url(4));
  assert.throws(() => manager.step(ticket, { action: 'result', taskId: 'wrong', url: url(4), job: job(4) }), /different/);
  manager.step(ticket, { action: 'result', taskId: next.task.id, url: url(4), job: job(5) });
  assert.equal(store.list('jobs').length, 0);
  assert.equal(store.get('indeedBrowserRuns', 'run').unknown, 1);
});
test('browser observations obey domain, level, date and closure filters and preserve distinct keys', t => {
  const { manager, store } = fixture(t); const { ticket } = manager.launch('run');
  let next = manager.step(ticket, { action: 'next' });
  next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: next.task.url, links: [1,2,3,4,5,6].map(url) });
  const changes = [{ title: 'Senior Data Scientist' }, { title: 'Nurse', description: 'Provide patient care and coordinate a hospital medical service.' }, { closed: true }, { postedAt: '' }, {}, {}];
  for (let i = 1; i <= 6; i++) next = manager.step(ticket, { action: 'result', taskId: next.task.id, url: url(i), job: { ...job(i), ...changes[i - 1] } });
  assert.equal(store.list('jobs').length, 3);
  assert.equal(store.get('scans', 'run').closedJobs.length, 1);
  assert.equal(store.list('jobs').find(j => j.postingUrl === url(4)).discoveryBucket, 'undated-review');
  assert.ok(store.list('jobs').every(j => j.availabilityStatus === 'unconfirmed'));
});
test('navigation remains regional with canonical identity and rejects credential/other-host links', () => {
  assert.equal(indeedNavigation(url(1) + '&tracking=1'), url(1));
  assert.equal(indeedNavigation('https://evil.test/viewjob?jk=123456789abcdef0'), '');
  assert.equal(indeedNavigation('https://u:p@ma.indeed.com/viewjob?jk=123456789abcdef0'), '');
  assert.match(offerLink({ url: url(1).replace('ma.', 'www.'), postingUrl: url(1), title: 'Role' }), /href="https:\/\/ma\.indeed/);
  assert.ok(!offerLink({ url: url(1), postingUrl: url(2), title: 'Role' }).includes(url(2)));
});
function extract(html, task) {
  const dom = new JSDOM(html, { url: task.url, runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 20 }];
  try { return dom.window.eval('(' + readIndeedPage.toString() + ')') (task); } finally { dom.window.close(); }
}
test('DOM reader distinguishes challenge, listing cards, unsupported page and job description', () => {
  const listing = { type: 'listing', url: 'https://ma.indeed.com/jobs?q=data&l=Morocco' };
  assert.equal(extract('<title>Just a moment...</title>', listing).blocked, true);
  assert.equal(extract('<h1>Unknown layout</h1>', listing).ready, false);
  const cards = extract('<div class="job_seen_beacon"><a data-jk="0000000000000001" href="/viewjob?jk=0000000000000001">Data Scientist</a></div><a href="https://evil.test/">Trap</a>', listing);
  assert.deepEqual([...cards.links], [url(1)]);
  const detail = extract('<h1 class="jobsearch-JobInfoHeader-title">Junior Data Scientist</h1><div data-testid="inlineHeader-companyName">Fixture</div><div id="jobDescriptionText">Python and SQL machine learning models for the data science team.</div><aside>Do not read candidate cookies</aside>', { type: 'detail', url: url(1) });
  assert.equal(detail.ready, true); assert.equal(detail.job.company, 'Fixture');
  assert.ok(!detail.job.description.includes('cookies'));
});
test('HTTP scan hands off after LinkedIn, keeps partial results and isolates browser tickets', async t => {
  const calls = [];
  const app = createApp({ dbPath: ':memory:', statusChecker: async () => ({ ready: true }), searcher: async (prefs, accept) => {
    calls.push(prefs.jobSite); assert.ok(!JSON.stringify(prefs).includes('PRIVATE_CV'));
    accept([{ ...job(1), url: 'https://www.linkedin.com/jobs/view/123456789/', verification: 'found on public posting', sourceCheckedAt: new Date().toISOString() }]);
    throw Error('Synthetic LinkedIn HTTP 429 after one batch');
  }, researcher: async () => [] });
  app.store.put('settings', { ...app.store.get('settings', 'main'), ...settings });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); app.store.db.close(); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const headers = { 'Content-Type': 'application/json', 'X-JobOS-Token': app.store.get('settings', 'main').token };
  const post = (path, body = {}, h = headers) => fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const run = await (await post('/api/codex/scan')).json();
  for (let i = 0; i < 100 && app.store.get('scans', run.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(calls, ['linkedin']); assert.equal(app.store.list('jobs').length, 1);
  assert.equal(app.store.get('scans', run.id).status, 'waiting_browser');
  assert.equal((await post('/api/codex/scan')).status, 409);
  const path = '/api/codex/scan/' + run.id + '/browser';
  assert.equal((await post(path, {}, { 'Content-Type': 'application/json' })).status, 401);
  const { ticket } = await (await post(path)).json(); assert.ok(ticket);
  assert.equal((await post('/api/availability-check', { mode: 'browser' })).status, 409);
  const extension = { 'Content-Type': 'application/json', Origin: 'chrome-extension://' + 'a'.repeat(32), 'X-JobOS-Search': ticket };
  assert.equal((await fetch(base + '/api/state', { headers: extension })).status, 403);
  const next = await (await post('/api/indeed/browser', { action: 'next' }, extension)).json();
  assert.equal(next.task.type, 'listing');
  const preview = await post('/api/indeed/browser', { action: 'result', taskId: next.task.id, url: next.task.url + '&vjk=dd284136f502336c', links: [url(2)] }, extension);
  assert.equal(preview.status, 200);
  const detail = await preview.json(); assert.equal(detail.task.type, 'detail');
  const captured = await post('/api/indeed/browser', { action: 'result', taskId: detail.task.id, url: url(2), job: job(2) }, extension);
  assert.equal(captured.status, 200);
  const savedIndeed = app.store.list('jobs').find(j => j.source === 'Indeed browser');
  assert.equal(savedIndeed.postingUrl, url(2)); assert.ok(offerLink(savedIndeed).includes(url(2)));
  await post('/api/indeed/browser', { action: 'pause' }, extension);
  assert.equal(app.store.get('scans', run.id).status, 'paused');
  await post(path, { action: 'stop' });
  assert.equal(app.store.get('scans', run.id).status, 'completed');
  assert.equal(app.store.list('jobs').length, 2);
});


test('new standalone Indeed layout reads only the posting and keeps unknown dates unknown', () => {
  const html = '<nav>Sign in</nav><div data-testid="desktop-job-header"><h5 data-testid="vj-job-title">Ingénieur IA</h5><div data-testid="company-info-metadata"><div><div><a href="/cmp/Fixture">Fixture</a></div>\n<div>Casablanca</div></div></div><a>Apply with Indeed</a></div><div data-testid="viewjob-job-content"><h4 data-testid="vj-job-description-heading">Full job description</h4><div class="simple-job-description-html"><p>Build machine learning models using Python, SQL and PyTorch for industrial applications.</p></div></div><aside><a href="/cmp/Wrong">Wrong employer</a><p>Unrelated recommendation</p></aside>';
  const read = extract(html, { type: 'detail', url: url(1) + '&tracking=1' });
  assert.equal(read.ready, true); assert.equal(read.job.title, 'Ingénieur IA');
  assert.equal(read.job.company, 'Fixture'); assert.equal(read.job.location, 'Casablanca');
  assert.equal(read.job.url, url(1)); assert.equal(read.job.postedAt, '');
  assert.match(read.job.description, /Python, SQL and PyTorch/);
  assert.doesNotMatch(read.job.description, /Sign in|Apply|recommendation|Full job description/);
  const plainCompany = extract(html.replace('<a href="/cmp/Fixture">Fixture</a>', '<div data-testid="vj-company-name">Fixture</div>'), { type: 'detail', url: url(1) });
  assert.equal(plainCompany.ready, true); assert.equal(plainCompany.job.company, 'Fixture'); assert.equal(plainCompany.job.location, 'Casablanca');
});

test('unknown or unselected detail pages report missing fields, never verification or an invented vacancy', () => {
  const result = extract('<h1>Indeed</h1>', { type: 'detail', url: url(1) });
  assert.equal(result.ready, false); assert.equal(result.blocked, undefined);
  assert.deepEqual([...result.missing], ['title', 'company', 'description']);
  const unselected = extract('<h1>Job search</h1>', { type: 'detail', url: 'https://ma.indeed.com/jobs?q=data' });
  assert.equal(unselected.attention, 'wrong_page'); assert.equal(unselected.job, undefined);
  const impostor = extract('<h1>Trap</h1>', { type: 'detail', url: 'https://ma.indeed.com.evil.test/viewjob?jk=0000000000000001' });
  assert.equal(impostor.attention, 'wrong_page');
});

test('layout and timeout pauses keep the exact task, with distinct safe explanations', t => {
  const { manager, store } = fixture(t); const { ticket } = manager.launch('run');
  const first = manager.step(ticket, { action: 'next' });
  for (const [attention, pattern] of [['unsupported_layout', /No verification challenge/], ['load_timeout', /did not finish loading/], ['wrong_page', /no longer on the expected/], ['verification', /showing verification/]]) {
    const result = manager.step(ticket, { action: 'result', taskId: first.task.id, attention, missing: ['description', 'PRIVATE_TEXT'] });
    assert.equal(result.status, 'paused'); assert.match(result.reason, pattern);
    assert.doesNotMatch(result.reason, /PRIVATE_TEXT/); assert.equal(store.list('jobs').length, 0);
    assert.equal(manager.step(ticket, { action: 'resume' }).task.id, first.task.id);
  }
});
