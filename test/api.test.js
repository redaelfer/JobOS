import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStore } from '../lib/store.js';
async function setup(t, options = {}) {
  const app = createApp({ dbPath: ':memory:', hydrator: async () => [], ...options }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.db.close(); });
  const request = async (path, method = 'GET', body, headers = {}) => { const res = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  return { ...app, base, request };
}
test('job lifecycle: create, duplicate, stage updates, notes, delete', async t => {
  const { request } = await setup(t);
  const input = { title: 'Developer', company: 'Acme', url: 'https://www.linkedin.com/jobs/view/55/?trackingId=a' };
  const first = await request('/api/jobs', 'POST', input); assert.equal(first.status, 201);
  const duplicate = await request('/api/jobs', 'POST', { ...input, url: 'https://www.linkedin.com/jobs/search/?currentJobId=55' }); assert.equal(duplicate.body.created, false);
  const id = first.body.job.id;
  for (const stage of ['Applied', 'Screening', 'Interview', 'Offer', 'Closed']) assert.equal((await request(`/api/jobs/${id}`, 'PATCH', { stage, notes: 'Called recruiter' })).body.stage, stage);
  assert.equal((await request('/api/state')).body.jobs.length, 1);
  await request(`/api/jobs/${id}`, 'DELETE'); assert.equal((await request('/api/state')).body.jobs.length, 0);
});

test('deleted postings stay blocked across URL variants, capture, email, historical results and URL edits', async t => {
  const { request, store } = await setup(t);
  const input = { title: 'Junior Engineer', company: 'Acme', url: 'https://www.linkedin.com/jobs/view/70001/?trackingId=one', description: 'Develop software services using Python and SQL.' };
  const saved = (await request('/api/jobs', 'POST', input)).body.job;
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  const history = store.put('searches', { status: 'completed', jobs: [input], createdAt: new Date().toISOString(), summary: 'Synthetic historical result' });
  await request(`/api/jobs/${saved.id}`, 'DELETE');
  for (const url of ['https://www.linkedin.com/jobs/search/?currentJobId=70001', 'https://ma.linkedin.com/jobs/view/junior-engineer-70001/', saved.url]) {
    const result = await request('/api/jobs', 'POST', { ...input, url });
    assert.equal(result.status, 200); assert.equal(result.body.created, false); assert.equal(result.body.skipped, true); assert.equal(result.body.job, null);
  }
  const capture = await request('/api/capture', 'POST', { ...input, source: 'LinkedIn extension' }, headers);
  assert.equal(capture.body.skipped, true); assert.match(capture.body.reason, /previously deleted/);
  const historicalSave = await request(`/api/codex/search/${history.id}/save`, 'POST', { index: 0 }, headers);
  assert.equal(historicalSave.body.skipped, true);
  assert.equal((await request('/api/import-email', 'POST', { raw: saved.url })).body.imported, 0);
  let state = (await request('/api/state')).body;
  assert.equal(state.jobs.length, 0); assert.equal(state.alerts.length, 0); assert.deepEqual(state.dismissedJobUrls, [saved.url]);
  const other = (await request('/api/jobs', 'POST', { ...input, url: 'https://www.linkedin.com/jobs/view/70002/' })).body.job;
  assert.ok(other.id, 'a distinct posting with the same employer/title is retained');
  assert.equal((await request(`/api/jobs/${other.id}`, 'PATCH', { url: saved.url })).status, 409);
  state = (await request('/api/state')).body; assert.equal(state.jobs[0].url, other.url);
  const exported = (await request('/api/export')).body;
  assert.equal(exported.dismissedJobs[0].url, saved.url);
  assert.deepEqual(Object.keys(exported.dismissedJobs[0]).sort(), ['deletedAt', 'id', 'url']);
});

test('deleted-posting memory survives an application restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'jobos-deleted-test-')), dbPath = join(dir, 'test.sqlite');
  const input = { title: 'Engineer', company: 'Acme', url: 'https://careers.example.com/jobs/42?utm_source=linkedin' };
  try {
    await t.test('delete the posting', async child => {
      const { request } = await setup(child, { dbPath });
      const saved = (await request('/api/jobs', 'POST', input)).body.job;
      await request(`/api/jobs/${saved.id}`, 'DELETE');
    });
    await t.test('reopened app rejects the same posting', async child => {
      const { request } = await setup(child, { dbPath });
      const duplicate = await request('/api/jobs', 'POST', { ...input, url: 'https://careers.example.com/jobs/42?utm_campaign=alert' });
      assert.equal(duplicate.body.skipped, true); assert.equal((await request('/api/state')).body.jobs.length, 0);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rediscovered closed offers keep their record, notes and stage and are never counted as new', async t => {
  const role = { title: 'Junior Software Engineer', company: 'Acme', url: 'https://www.linkedin.com/jobs/view/70003/', description: 'Build software services using Python and SQL.', source: 'Codex LinkedIn search', postedAt: '1 day ago' };
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: async () => ({ summary: 'Same posting', jobs: [{ ...role, url: 'https://ma.linkedin.com/jobs/view/engineer-70003/?trackingId=two' }] }), researcher: async () => { throw new Error('Closed offers must not trigger employer research'); }, ranker: async () => { throw new Error('Closed offers must not be ranked'); } });
  await request('/api/settings', 'PUT', { searchDomains: 'Software engineering', resume: 'Synthetic software engineer with Python and SQL development skills.' });
  const saved = (await request('/api/jobs', 'POST', role)).body.job;
  await request(`/api/jobs/${saved.id}`, 'PATCH', { stage: 'Closed', notes: 'Not interested; keep closed.' });
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  const duplicate = await request('/api/capture', 'POST', { ...role, source: 'LinkedIn extension', stage: 'Saved', description: role.description + ' Docker.' }, headers);
  assert.equal(duplicate.body.created, false); assert.equal(duplicate.body.job.id, saved.id); assert.equal(duplicate.body.job.stage, 'Closed');
  await request('/api/codex/scan', 'POST', {}, headers);
  const state = (await request('/api/state')).body;
  assert.equal(state.scans[0].status, 'completed'); assert.equal(state.scans[0].newJobIds.length, 0); assert.deepEqual(state.scans[0].warnings, []);
  assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].id, saved.id); assert.equal(state.jobs[0].stage, 'Closed'); assert.equal(state.jobs[0].notes, 'Not interested; keep closed.');
});

test('deleting an offer during a pending scan prevents late results from recreating or ranking it', async t => {
  let finish;
  const role = { title: 'Junior Software Engineer', company: 'Acme', url: 'https://www.linkedin.com/jobs/view/70004/', description: 'Develop software products using Python and SQL.', postedAt: '1 day ago' };
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: () => new Promise(resolve => { finish = resolve; }), researcher: async () => { throw new Error('Deleted employer must not be researched'); }, ranker: async () => { throw new Error('Deleted job must not be ranked'); } });
  await request('/api/settings', 'PUT', { searchDomains: 'Software engineering', resume: 'Synthetic software engineer with Python and SQL development skills.' });
  const saved = (await request('/api/jobs', 'POST', role)).body.job;
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  assert.equal((await request('/api/codex/scan', 'POST', {}, headers)).status, 202);
  await request(`/api/jobs/${saved.id}`, 'DELETE');
  finish({ summary: 'Late public result', jobs: [role] });
  const state = (await request('/api/state')).body;
  assert.equal(state.scans[0].status, 'completed'); assert.equal(state.scans[0].newJobIds.length, 0); assert.equal(state.scans[0].pendingRankings, 0); assert.deepEqual(state.scans[0].warnings, []);
  assert.equal(state.jobs.length, 0); assert.equal(state.rankings.length, 0); assert.equal(state.opportunities.items.length, 0);
});

test('direct discovery excludes deleted postings even when the provider returns alternate URLs', async t => {
  const role = { title: 'Junior Engineer', company: 'Acme', url: 'https://www.linkedin.com/jobs/view/70005/', description: 'Develop software using Python and SQL.' };
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: async preferences => { assert.deepEqual(preferences.excludedUrls, [role.url]); return { summary: 'Synthetic public results', jobs: [{ ...role, url: 'https://ma.linkedin.com/jobs/view/engineer-70005/' }, { ...role, url: 'https://www.linkedin.com/jobs/view/70006/' }] }; } });
  const saved = (await request('/api/jobs', 'POST', role)).body.job;
  await request(`/api/jobs/${saved.id}`, 'DELETE');
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  const start = await request('/api/codex/search', 'POST', { domains: 'Software engineering' }, headers);
  const result = (await request(`/api/codex/search/${start.body.id}`, 'GET', undefined, headers)).body;
  assert.equal(result.status, 'completed'); assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].url, 'https://www.linkedin.com/jobs/view/70006/');
});

test('AI configuration is token protected, keeps keys out of state/exports and routes ranking to the chosen provider', async t => {
  const calls = [];
  const resume = 'PRIVATE synthetic engineer with Python and SQL skills. '.repeat(800) + 'END_OF_COMPLETE_CV';
  const { request } = await setup(t, { credentialEnv: {}, aiOptions: { fetcher: async (url, options) => {
    calls.push({ url, options });
    const prompt = JSON.parse(options.body).messages[0].content;
    const data = JSON.parse(prompt.split('INPUT DATA:\n')[1]);
    assert.equal(data.resume, resume, 'Uploaded CV input must not be silently truncated during ranking');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Synthetic custom-model comparison', rankings: data.jobs.map(job => ({ jobId: job.id, score: 80, fit: 'Supported skills.', strengths: [], gaps: [], nextStep: 'Review.', contacts: [] })) }) } }] }));
  } } });
  const initial = (await request('/api/state')).body, headers = { 'X-JobOS-Token': initial.settings.token };
  assert.equal(initial.ai.provider, 'codex');
  const body = { provider: 'compatible', model: 'synthetic-model', baseUrl: 'http://127.0.0.1:1234/v1', keys: { compatible: 'PRIVATE_TEST_KEY' } };
  assert.equal((await request('/api/ai/config', 'PUT', body)).status, 401);
  const result = await request('/api/ai/config', 'PUT', body, headers); assert.equal(result.status, 200); assert.equal(result.body.keys.compatible.configured, true);
  assert.equal(JSON.stringify(result.body).includes('PRIVATE_TEST_KEY'), false);
  assert.equal(JSON.stringify((await request('/api/state')).body).includes('PRIVATE_TEST_KEY'), false);
  assert.equal(JSON.stringify((await request('/api/export')).body).includes('PRIVATE_TEST_KEY'), false);
  assert.equal((await request('/api/ai/config', 'PUT', { provider: 'constructor', model: 'test', baseUrl: 'https://example.com' }, headers)).status, 400);
  assert.equal((await request('/api/resume', 'POST', { filename: 'oversized.txt', contentBase64: Buffer.from(resume.repeat(2)).toString('base64') })).status, 400);
  assert.equal((await request('/api/resume', 'POST', { filename: 'synthetic.txt', contentBase64: Buffer.from(resume).toString('base64') })).status, 200);
  const job = (await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme', description: 'Build production software using Python and SQL.' })).body.job;
  const start = await request('/api/codex/rank', 'POST', { jobIds: [job.id] }, headers);
  assert.equal(start.status, 202);
  let run;
  for (let attempt = 0; attempt < 40; attempt++) { run = (await request('/api/codex/rank/' + start.body.id, 'GET', undefined, headers)).body; if (run.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(run.status, 'completed'); assert.equal(run.provider, 'compatible'); assert.equal(run.model, 'synthetic-model'); assert.equal(run.rankings.length, 1);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions'); assert.equal(calls[0].options.headers.Authorization, 'Bearer PRIVATE_TEST_KEY');
  const cleared = await request('/api/ai/config', 'PUT', { clearKeys: ['compatible'] }, headers); assert.equal(cleared.body.keys.compatible.configured, false);
});

test('provider changes, connection probes and downloads share the active workflow guard', async t => {
  let finish;
  const { request } = await setup(t, { credentialEnv: {}, statusChecker: async () => ({ ready: true }), ranker: () => new Promise(resolve => { finish = resolve; }), localSetup: async () => {} });
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  await request('/api/settings', 'PUT', { resume: 'Synthetic Python engineer with software development experience.' });
  const job = (await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme', description: 'Build production software using Python and SQL.' })).body.job;
  await request('/api/codex/rank', 'POST', { jobIds: [job.id] }, headers);
  assert.equal((await request('/api/ai/config', 'PUT', { provider: 'ollama' }, headers)).status, 409);
  assert.equal((await request('/api/ai/test', 'POST', {}, headers)).status, 409);
  assert.equal((await request('/api/ai/search-test', 'POST', {}, headers)).status, 409);
  assert.equal((await request('/api/ai/local/setup', 'POST', {}, headers)).status, 409);
  finish({ summary: 'Done', rankings: [] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('/api/ai/config', 'PUT', { provider: 'ollama' }, headers)).status, 200);
});

test('an outdated settings page cannot overwrite newer model settings or credentials', async t => {
  const { request, base } = await setup(t, { credentialEnv: {}, statusChecker: async () => ({ ready: true }) });
  const state = (await request('/api/state')).body, headers = { 'X-JobOS-Token': state.settings.token, Origin: base };
  const originalRevision = state.ai.revision;
  const updated = await request('/api/ai/config', 'PUT', { expectedRevision: originalRevision, provider: 'gemini', model: 'gemini-3.6-flash', searchProvider: 'gemini', keys: { gemini: 'CURRENT_PRIVATE_KEY' } }, headers);
  assert.equal(updated.status, 200); assert.notEqual(updated.body.revision, originalRevision);
  const stale = await request('/api/ai/config', 'PUT', { expectedRevision: originalRevision, provider: 'gemini', model: 'gemini-2.5-flash', keys: { gemini: 'STALE_PRIVATE_KEY' } }, headers);
  assert.equal(stale.status, 409); assert.match(stale.body.error, /Reload saved settings/);
  assert.equal((await request('/api/ai/config', 'PUT', { provider: 'gemini', model: 'gemini-2.5-flash' }, headers)).status, 409);
  assert.equal((await request('/api/ai/test', 'POST', { expectedRevision: originalRevision }, headers)).status, 409);
  assert.equal((await request('/api/ai/search-test', 'POST', { expectedRevision: originalRevision }, headers)).status, 409);
  const current = (await request('/api/ai/config', 'GET', undefined, headers)).body;
  assert.equal(current.profiles.gemini.model, 'gemini-3.6-flash'); assert.equal(current.revision, updated.body.revision);
  assert.equal(JSON.stringify(current).includes('PRIVATE_KEY'), false);
});

test('live search testing is authenticated, separate from generation and exposes quota failure without CV data', async t => {
  let calls = 0, exhausted = false;
  const { request } = await setup(t, { credentialEnv: {}, aiOptions: { fetcher: async (url, options) => {
    calls++;
    assert.match(url, /models\/gemini-3\.6-flash:generateContent$/);
    const body = JSON.parse(options.body), prompt = body.contents[0].parts[0].text;
    assert.match(prompt, /nodejs\.org/); assert.equal(prompt.includes('PRIVATE_CV'), false);
    assert.deepEqual(body.tools, [{ google_search: {} }]);
    if (exhausted) return new Response(JSON.stringify({ error: 'PRIVATE_PROVIDER_RESPONSE' }), { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ results: [{ title: 'Node.js', url: 'https://nodejs.org/en/docs/', content: 'Official documentation.' }] }) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://nodejs.org/en/docs/' } }] } }] }));
  } } });
  const initial = (await request('/api/state')).body, headers = { 'X-JobOS-Token': initial.settings.token };
  await request('/api/settings', 'PUT', { resume: 'PRIVATE_CV software engineer with Python and SQL experience.' });
  const saved = (await request('/api/ai/config', 'PUT', { provider: 'compatible', model: 'synthetic-local-model', searchProvider: 'gemini', keys: { gemini: 'SYNTHETIC_KEY' } }, headers)).body;
  assert.equal((await request('/api/ai/search-test', 'POST', {})).status, 401);
  const result = await request('/api/ai/search-test', 'POST', { expectedRevision: saved.revision }, headers);
  assert.equal(result.status, 200); assert.equal(result.body.ready, true); assert.equal(result.body.searchModel, 'gemini-3.6-flash'); assert.equal(calls, 1);
  exhausted = true;
  const failure = await request('/api/ai/search-test', 'POST', { expectedRevision: saved.revision }, headers);
  assert.equal(failure.status, 200); assert.equal(failure.body.ready, false); assert.match(failure.body.message, /HTTP 429/);
  assert.equal(failure.body.message.includes('PRIVATE_PROVIDER_RESPONSE'), false); assert.equal(calls, 2);
  const state = (await request('/api/state')).body;
  assert.equal(state.ai.provider, 'compatible'); assert.equal(state.jobs.length, 0); assert.equal(state.scans.length, 0); assert.equal(state.searches.length, 0); assert.equal(state.rankings.length, 0);
});

test('local setup records progress/completion and never initiates a job search or changes the provider', async t => {
  let finish, searches = 0;
  const { request } = await setup(t, { credentialEnv: {}, searcher: async () => { searches++; }, localSetup: (model, progress) => { assert.equal(model, 'qwen3:4b'); progress('Downloading local model · 50%'); return new Promise(resolve => { finish = resolve; }); } });
  const headers = { 'X-JobOS-Token': (await request('/api/state')).body.settings.token };
  assert.equal((await request('/api/ai/local/setup', 'POST', {})).status, 401);
  const started = await request('/api/ai/local/setup', 'POST', {}, headers); assert.equal(started.status, 202);
  let state = (await request('/api/state')).body; assert.equal(state.modelDownloads[0].status, 'running'); assert.match(state.modelDownloads[0].phase, /50%/);
  assert.equal((await request('/api/codex/search', 'POST', { domains: 'Software engineering' }, headers)).status, 409);
  finish(); await new Promise(resolve => setImmediate(resolve));
  state = (await request('/api/state')).body; assert.equal(state.modelDownloads[0].status, 'completed'); assert.equal(state.ai.provider, 'codex'); assert.equal(searches, 0);
});
test('daily opportunities API preserves source metadata and validates saved match preferences', async t => {
  const { request } = await setup(t);
  const saved = await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme', description: 'Develop software platforms using Python, SQL and Docker.', url: 'https://www.linkedin.com/jobs/view/111/', source: 'Codex LinkedIn search', verification: 'Title and company found on public posting', postedAt: '1 day ago' });
  await request('/api/settings', 'PUT', { searchDomains: 'Data engineering', searchLocation: 'Morocco', minimumFit: 85 });
  const result = await request('/api/opportunities'); assert.equal(result.status, 200); assert.equal(result.body.minimumFit, 85); assert.equal(result.body.items[0].postedAt, '1 day ago'); assert.equal(result.body.items[0].rankingStatus, 'pending');
  assert.equal((await request('/api/settings', 'PUT', { minimumFit: 101 })).status, 400); assert.equal((await request('/api/settings', 'PUT', { searchDomains: '' })).status, 400);
  await request('/api/jobs', 'POST', { ...saved.body.job, verification: 'Posting may be closed' });
  const state = (await request('/api/state')).body; assert.equal(state.opportunities.items[0].closed, true); assert.notEqual(state.jobs[0].updatedAt, saved.body.job.updatedAt); assert.ok(state.jobs[0].lastSeenAt);
});
test('an unbound duplicate app does not invalidate an active server workflow', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'jobos-duplicate-')), dbPath = join(dir, 'test.sqlite');
  const { store } = await setup(t, { dbPath }); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = store.put('scans', { status: 'running' });
  const duplicate = createApp({ dbPath });
  assert.equal(store.get('scans', run.id).status, 'running'); duplicate.store.db.close();
});
test('bad input, missing records, conflicting URLs, and unsafe links are rejected', async t => {
  const { request } = await setup(t);
  for (const body of [{ title: 'A' }, { title: 'A', company: 'B', stage: 'bad' }, { title: 'A', company: 'B', url: 'javascript:alert(1)' }]) assert.equal((await request('/api/jobs', 'POST', body)).status, 400);
  assert.equal((await request('/api/jobs/unknown', 'PATCH', { stage: 'Offer' })).status, 404);
  await request('/api/jobs', 'POST', { title: 'A', company: 'B', url: 'https://example.com/a' });
  const b = await request('/api/jobs', 'POST', { title: 'B', company: 'B', url: 'https://example.com/b' });
  assert.equal((await request(`/api/jobs/${b.body.job.id}`, 'PATCH', { url: 'https://example.com/a' })).status, 409);
});
test('matching preferences create alerts only for new matching jobs', async t => {
  const { request } = await setup(t);
  await request('/api/settings', 'PUT', { keywords: 'React', locations: 'Remote', exclude: 'Senior' });
  for (const title of ['React Developer', 'Senior React Developer', 'Java Developer']) await request('/api/jobs', 'POST', { title, company: 'Acme', location: 'Remote' });
  let state = (await request('/api/state')).body; assert.equal(state.alerts.length, 1);
  await request(`/api/alerts/${state.alerts[0].id}`, 'PATCH', { read: true }); state = (await request('/api/state')).body; assert.equal(state.alerts[0].read, true);
});
test('contacts and reminders validate, persist, complete, reopen and cascade', async t => {
  const { request } = await setup(t);
  const contact = await request('/api/contacts', 'POST', { name: 'Test Recruiter', email: 'test@example.com' }); assert.equal(contact.status, 201);
  assert.equal((await request('/api/contacts', 'POST', { name: 'Bad', email: 'invalid' })).status, 400);
  assert.equal((await request(`/api/contacts/${contact.body.id}`, 'PATCH', { name: 'Updated', company: 'Acme' })).body.name, 'Updated');
  const j = (await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme' })).body.job;
  assert.equal((await request('/api/reminders', 'POST', { title: 'Follow', dueAt: 'not a date' })).status, 400);
  assert.equal((await request('/api/reminders', 'POST', { title: 'Follow', dueAt: '2026-10-09', jobId: 'missing' })).status, 400);
  const r = (await request('/api/reminders', 'POST', { title: 'Follow', dueAt: '2026-10-09T10:00:00Z', jobId: j.id })).body;
  assert.equal((await request(`/api/reminders/${r.id}`, 'PATCH', { done: true })).body.done, true);
  assert.equal((await request(`/api/reminders/${r.id}`, 'PATCH', { done: false })).body.done, false);
  await request(`/api/jobs/${j.id}`, 'DELETE'); const state = (await request('/api/state')).body; assert.equal(state.reminders.length, 0); assert.equal(state.alerts.length, 0);
  await request(`/api/contacts/${contact.body.id}`, 'DELETE'); assert.equal((await request('/api/state')).body.contacts.length, 0);
});
test('capture requires pairing; arbitrary origins cannot access private state', async t => {
  const { request, base } = await setup(t); const job = { title: 'Developer', company: 'Acme' };
  assert.equal((await request('/api/capture', 'POST', job)).status, 401);
  const state = (await request('/api/state')).body;
  const headers = { Origin: `chrome-extension://${'a'.repeat(32)}`, 'X-JobOS-Token': state.settings.token };
  assert.equal((await request('/api/capture', 'POST', job, headers)).status, 201);
  assert.equal((await request('/api/state', 'GET', undefined, headers)).status, 403);
  assert.equal((await request('/api/state', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => { http.get(base + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
  assert.equal(invalidHost, 403);
  assert.equal((await request('/api/export')).body.settings.token, undefined);
  const exported = await fetch(base + '/api/export'); assert.equal(exported.headers.get('content-disposition'), 'attachment; filename=jobos-workspace.json');
});
test('email import is idempotent and produces matching alerts', async t => {
  const { request } = await setup(t);
  const body = { raw: 'Content-Type: text/html\r\n\r\n<a href="https://www.linkedin.com/jobs/view/99/">Developer</a>' };
  assert.equal((await request('/api/import-email', 'POST', body)).body.imported, 1);
  assert.equal((await request('/api/import-email', 'POST', body)).body.imported, 0);
  assert.equal((await request('/api/state')).body.alerts.length, 1);
});
test('static application and malformed requests return appropriate responses', async t => {
  const { base, request } = await setup(t);
  for (const path of ['/', '/app.js', '/style.css', '/domain.js']) { const res = await fetch(base + path); assert.equal(res.status, 200); assert.ok(res.headers.get('Content-Security-Policy')); }
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await request('/api/jobs', 'POST', { title: 'A' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});
test('SQLite records and pairing identity survive reopening the store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobos-test-')), path = join(dir, 'test.sqlite');
  try { const first = openStore(path); const j = first.put('jobs', { title: 'Persistent job' }); const token = first.get('settings', 'main').token; first.db.close(); const second = openStore(path); assert.equal(second.get('jobs', j.id).title, 'Persistent job'); assert.equal(second.get('settings', 'main').token, token); second.db.close(); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test('editing incomplete email details can create a match without duplicate alerts', async t => {
  const { request } = await setup(t);
  await request('/api/settings', 'PUT', { keywords: 'React', locations: 'Remote' });
  const j = (await request('/api/jobs', 'POST', { title: 'React Engineer', company: 'Not provided in alert', source: 'LinkedIn email' })).body.job;
  assert.equal((await request('/api/state')).body.alerts.length, 0);
  await request(`/api/jobs/${j.id}`, 'PATCH', { location: 'Remote', company: 'Acme' });
  await request(`/api/jobs/${j.id}`, 'PATCH', { notes: 'Follow up' });
  const alerts = (await request('/api/state')).body.alerts; assert.equal(alerts.length, 1); assert.equal(alerts[0].company, 'Acme');
});
test('Chrome capture enriches imported email jobs without resetting stage or notes', async t => {
  const { request } = await setup(t);
  const j = (await request('/api/jobs', 'POST', { title: 'Imported', company: 'Not provided in alert', url: 'https://www.linkedin.com/jobs/view/73/', source: 'LinkedIn email', stage: 'Interview', notes: 'Keep me' })).body.job;
  const token = (await request('/api/state')).body.settings.token;
  const res = await request('/api/capture', 'POST', { title: 'React Developer', company: 'Acme', url: j.url, source: 'LinkedIn extension', description: 'React', location: 'Remote' }, { 'X-JobOS-Token': token });
  assert.equal(res.body.updated, true); assert.equal(res.body.job.id, j.id); assert.equal(res.body.job.stage, 'Interview'); assert.equal(res.body.job.notes, 'Keep me'); assert.equal(res.body.job.description, 'React'); assert.equal((await request('/api/state')).body.jobs.length, 1);
});
test('CV upload saves extracted text and refuses invalid files', async t => {
  const { request } = await setup(t);
  const cv = 'Synthetic React engineer with three years of software development experience.';
  const res = await request('/api/resume', 'POST', { filename: 'cv.txt', contentBase64: Buffer.from(cv).toString('base64') });
  assert.equal(res.status, 200); assert.equal((await request('/api/state')).body.settings.resume, cv);
  assert.equal((await request('/api/resume', 'POST', { filename: 'cv.exe', contentBase64: 'QQ==' })).status, 400);
});
test('Codex endpoint authenticates and persists a background ranking', async t => {
  let finish;
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), ranker: () => new Promise(resolve => { finish = resolve; }) });
  const token = (await request('/api/state')).body.settings.token, headers = { 'X-JobOS-Token': token };
  assert.equal((await request('/api/codex/status')).status, 401);
  assert.equal((await request('/api/codex/rank', 'POST', { jobIds: ['missing'] }, headers)).status, 400);
  await request('/api/settings', 'PUT', { resume: 'Synthetic engineer with many years of React development experience.' });
  const j = (await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme', description: 'We require a React engineer with three years of development experience.' })).body.job;
  const first = await request('/api/codex/rank', 'POST', { jobIds: [j.id] }, headers); assert.equal(first.status, 202);
  assert.equal((await request('/api/codex/rank', 'POST', { jobIds: [j.id] }, headers)).status, 409);
  finish({ summary: 'Done', rankings: [] });
  await new Promise(resolve => setImmediate(resolve));
  const result = await request('/api/codex/rank/' + first.body.id, 'GET', undefined, headers); assert.equal(result.body.status, 'completed');
});
test('Codex rejects unavailable sign-in and records provider failures', async t => {
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), ranker: async () => { throw new Error('Provider unavailable'); } });
  const token = (await request('/api/state')).body.settings.token, headers = { 'X-JobOS-Token': token };
  await request('/api/settings', 'PUT', { resume: 'Synthetic engineer with three years of React development experience.' });
  const j = (await request('/api/jobs', 'POST', { title: 'Engineer', company: 'Acme', description: 'React development and three years of experience with frontend applications.' })).body.job;
  assert.equal((await request('/api/codex/rank', 'POST', { jobIds: [j.id, j.id] }, headers)).status, 400);
  const start = await request('/api/codex/rank', 'POST', { jobIds: [j.id] }, headers);
  const result = await request('/api/codex/rank/' + start.body.id, 'GET', undefined, headers); assert.equal(result.body.status, 'failed'); assert.equal(result.body.error, 'Provider unavailable');
});
test('Codex searches saved domains and lets the user save distinct results', async t => {
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: async p => ({ summary: 'Found a role', jobs: [{ title: 'Data Engineer', company: 'Acme', location: p.location, description: '', url: 'https://www.linkedin.com/jobs/view/811/', evidence: 'Acme is hiring a Data Engineer.', verification: 'Public search result — review the posting', postedAt: '2 days ago', source: 'Codex LinkedIn search' }] }) });
  const token = (await request('/api/state')).body.settings.token, headers = { 'X-JobOS-Token': token };
  assert.equal((await request('/api/codex/search', 'POST', { domains: 'Data engineering' })).status, 401);
  assert.equal((await request('/api/codex/search', 'POST', { domains: '' }, headers)).status, 400);
  const run = await request('/api/codex/search', 'POST', { domains: 'Data engineering', location: 'Rabat' }, headers); assert.equal(run.status, 202);
  const results = await request(`/api/codex/search/${run.body.id}`, 'GET', undefined, headers); assert.equal(results.body.status, 'completed'); assert.equal(results.body.jobs.length, 1);
  const state = (await request('/api/state')).body; assert.equal(state.settings.searchDomains, 'Data engineering'); assert.equal(state.jobs.length, 0);
  assert.equal((await request(`/api/codex/search/${run.body.id}/save`, 'POST', { index: -1 }, headers)).status, 400);
  const saved = await request(`/api/codex/search/${run.body.id}/save`, 'POST', { index: 0 }, headers); assert.equal(saved.status, 201);
  assert.equal((await request(`/api/codex/search/${run.body.id}/save`, 'POST', { index: 0 }, headers)).body.created, false);
  const captured = await request('/api/capture', 'POST', { title: 'Data Engineer', company: 'Acme', url: saved.body.job.url, description: 'Full description with Python and SQL skills required for this data engineering role.', source: 'LinkedIn extension' }, headers); assert.equal(captured.body.updated, true); assert.ok(captured.body.job.description);
});
test('search and ranking share the single-run guard', async t => {
  let finish;
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: () => new Promise(resolve => { finish = resolve; }) });
  const token = (await request('/api/state')).body.settings.token, headers = { 'X-JobOS-Token': token };
  const run = await request('/api/codex/search', 'POST', { domains: 'AI engineering' }, headers); assert.equal(run.status, 202);
  assert.equal((await request('/api/codex/search', 'POST', { domains: 'AI engineering' }, headers)).status, 409);
  assert.equal((await request('/api/codex/rank', 'POST', { jobIds: ['x'] }, headers)).status, 409);
  finish({ summary: 'No public results', jobs: [] }); await new Promise(resolve => setImmediate(resolve));
});
test('automated scan saves employers, contacts and CV ranking, then deduplicates next scan', async t => {
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: async () => ({ summary: 'Found', jobs: [{ title: 'Engineer', company: 'Acme', location: 'Morocco', description: 'Build production software with Python, SQL and Docker in an engineering team.', url: 'https://www.linkedin.com/jobs/view/901/', postedAt: '2 days ago', source: 'Codex LinkedIn search' }] }), researcher: async () => [{ name: 'Acme', industry: 'Software', website: 'https://example.com', sourceUrl: 'https://example.com/about', recruitmentTeam: [{ name: 'Recruiter', role: 'Recruiter', profileUrl: 'https://example.com/team', sourceUrl: 'https://example.com/team', status: 'Found on source' }], contacts: [{ email: 'careers@example.com', sourceUrl: 'https://example.com/careers', status: 'Found on source' }] }], ranker: async ({ jobs }) => ({ summary: 'Good fit', rankings: jobs.map(j => ({ jobId: j.id, score: 80, title: j.title, company: j.company, strengths: [], gaps: [], fit: 'Good', nextStep: 'Apply', contacts: [] })) }) });
  await request('/api/settings', 'PUT', { resume: 'Synthetic engineer with Python and SQL skills and years of software development experience.' });
  const token = (await request('/api/state')).body.settings.token, headers = { 'X-JobOS-Token': token };
  assert.equal((await request('/api/codex/scan', 'POST', {})).status, 401);
  const start = await request('/api/codex/scan', 'POST', {}, headers); assert.equal(start.status, 202);
  let state = (await request('/api/state')).body;
  assert.equal(state.scans[0].status, 'completed'); assert.equal(state.jobs.length, 1); assert.equal(state.companies.length, 1); assert.equal(state.contacts.length, 2); assert.equal(state.rankings.length, 1);
  assert.equal((await request('/api/codex/scan/' + start.body.id, 'GET', undefined, headers)).body.newJobIds.length, 1);
  await request('/api/codex/scan', 'POST', {}, headers); state = (await request('/api/state')).body;
  assert.equal(state.jobs.length, 1); assert.equal(state.contacts.length, 2); assert.equal(state.rankings.length, 1);
  assert.equal(state.opportunities.items[0].rankingStatus, 'current');
  await request('/api/settings', 'PUT', { searchDomains: 'AI engineering' });
  assert.equal((await request('/api/opportunities')).body.items[0].rankingStatus, 'outdated');
  await request('/api/codex/scan', 'POST', {}, headers); state = (await request('/api/state')).body;
  assert.equal(state.rankings.length, 2); assert.equal(state.opportunities.items[0].rankingStatus, 'current');
});


test('manual scan processes 25 recent roles and saves the posting window without a quota', async t => {
  let researchCount = 0, batchSizes = [];
  const roles = Array.from({ length: 25 }, (_, i) => ({ title: 'Junior Software Engineer', company: 'Acme-' + (i % 8), location: 'Morocco', description: 'Build software services using Python, SQL and Docker in an engineering team.', url: 'https://www.linkedin.com/jobs/view/' + (7000 + i) + '/', source: 'Codex LinkedIn search', postedAt: '1 day ago' }));
  const { request } = await setup(t, { statusChecker: async () => ({ ready: true }), searcher: async preferences => { assert.equal(preferences.maxAgeDays, 7); assert.equal('limit' in preferences, false); return { summary: 'Recent source-backed synthetic roles', jobs: roles }; }, researcher: async names => { researchCount += names.length; return names.map(name => ({ name, contacts: [], recruitmentTeam: [] })); }, ranker: async ({ jobs }) => { batchSizes.push(jobs.length); return { summary: 'Synthetic comparison', rankings: jobs.map(j => ({ jobId: j.id, score: 80, title: j.title, company: j.company, strengths: [], gaps: [], fit: 'Synthetic fit', nextStep: 'Review', contacts: [] })) }; } });
  assert.equal((await request('/api/settings', 'PUT', { searchDomains: 'Software engineering', searchMaxAgeDays: 31 })).status, 400);
  assert.equal((await request('/api/settings', 'PUT', { searchDomains: 'Software engineering', searchMaxAgeDays: 7, resume: 'Synthetic software engineer with Python, SQL and Docker development skills.' })).status, 200);
  const snapshot = (await request('/api/state')).body;
  const headers = { 'X-JobOS-Token': snapshot.settings.token };
  assert.equal(snapshot.settings.searchMaxAgeDays, 7);
  const start = await request('/api/codex/scan', 'POST', {}, headers);
  assert.equal(start.status, 202);
  let state;
  for (let attempt = 0; attempt < 20; attempt++) { state = (await request('/api/state')).body; if (state.scans[0].status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(state.scans[0].status, 'completed');
  assert.equal(state.jobs.length, 25); assert.equal(state.opportunities.items.length, 25);
  assert.ok(state.opportunities.items.every(j => j.rankingStatus === 'current'));
  assert.equal(state.opportunities.maxAgeDays, 7); assert.equal(state.opportunities.counts.pending, 0);
  assert.equal(state.scans[0].newJobIds.length, 25); assert.equal(researchCount, 8);
  assert.deepEqual(batchSizes, [10, 10, 5]);
});


test('supplemental source metadata persists and changed availability invalidates old scores without erasing notes', async t => {
  const { request, store } = await setup(t);
  await request('/api/settings', 'PUT', { searchDomains: 'Software engineering', searchIncludeReview: true, resume: 'Synthetic software engineer with Python and SQL development experience.' });
  const saved = (await request('/api/jobs', 'POST', { title: 'Junior Software Engineer', company: 'Acme', description: 'Develop software with Python and SQL in a product team.', url: 'https://www.linkedin.com/jobs/view/9191/', source: 'Codex LinkedIn search', postedAt: '', discoveryBucket: 'undated-review', availabilityStatus: 'unconfirmed', availabilityEvidence: 'Readable posting; confirm hiring.', notes: 'Preserve this user note.' })).body.job;
  const { resumeFingerprint, preferenceFingerprint } = await import('../lib/profile.js');
  const settings = store.get('settings', 'main');
  store.put('rankings', { status: 'completed', completedAt: new Date().toISOString(), resumeHash: resumeFingerprint(settings), preferencesHash: preferenceFingerprint(settings), jobUpdatedAt: { [saved.id]: saved.updatedAt }, rankings: [{ jobId: saved.id, score: 82, strengths: [], gaps: [], contacts: [] }] });
  let state = (await request('/api/state')).body;
  assert.equal(state.settings.searchIncludeReview, true); assert.equal(state.opportunities.items[0].discoveryBucket, 'undated-review');
  assert.equal(state.opportunities.items[0].needsAvailabilityReview, true); assert.equal(state.opportunities.counts.undatedReview, 1);
  assert.equal(state.opportunities.items[0].rankingStatus, 'current');
  await request('/api/jobs', 'POST', { ...saved, availabilityStatus: 'closed', verification: 'Posting may be closed', availabilityEvidence: 'Source now states closed.' });
  state = (await request('/api/state')).body;
  assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].notes, 'Preserve this user note.');
  assert.equal(state.opportunities.items[0].closed, true); assert.equal(state.opportunities.items[0].rankingStatus, 'outdated');
  assert.equal(state.opportunities.counts.undatedReview, 0);
  assert.equal((await request('/api/settings', 'PUT', { searchIncludeReview: false })).status, 200);
  assert.equal((await request('/api/state')).body.settings.searchIncludeReview, false);
  assert.equal((await request('/api/settings', 'PUT', { searchIncludeReview: 'invalid' })).status, 400);
});
