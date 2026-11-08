import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { stages, analyzeResume, jobUrl } from '../lib/domain.js';
import { dailyOpportunities, filterOpportunities, opportunityCards } from '../public/opportunities-view.js';
import { applicationContacts, applicationList, closeOpportunityButton, searchNowButton } from '../public/application-tools.js';
import { orderJobs, matchesPublication } from '../public/job-order.js';
import { tailoringPage, tailoringResult, emailDraftUrl } from '../public/tailoring-view.js';
import { aiModelsPage, updateAIForm, modelDownloadStatus, groundingSuggestions, aiQuotaHelp, searchAccessHelp, localModelCatalog } from '../public/ai-settings-view.js';
import { uniqueSearchWarnings, searchSummary, searchFailureText, searchRunSource, searchSourceLabel } from '../lib/search-warnings.js';
import { publicAI, credentialStore, updateAIConfig } from '../lib/ai-config.js';
import { buildOpportunities } from '../lib/opportunities.js';
import { searchPreferences } from '../lib/discovery.js';
import { starterLatex } from '../lib/tailoring.js';
import { helpPage } from '../public/help-view.js';
const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const settle = async predicate => { for (let i = 0; i < 30; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.ok(predicate(), 'UI transition completed'); };
async function setup(t, page = 'search', jobs = [], workflows = {}) {
  const settings = { resume: 'Synthetic engineer with Python and SQL software development skills.', token: 'synthetic-token', searchDomains: 'Software engineering', searchLocation: 'Morocco and remote roles', searchLevel: 'Graduate / Entry level', searchExclude: 'senior, unpaid', searchMaxAgeDays: 30, minimumFit: 70 };
  const state = { ai: publicAI({}, credentialStore(null, {})), modelDownloads: [], settings, jobs, rankings: [], searches: [], scans: [], tailorings: [], companies: [], contacts: [], reminders: [], alerts: [], mailbox: {}, opportunities: buildOpportunities({ settings, jobs }), ...workflows };
  const calls = [], intervals = [], network = { fail: false, searchTest: null, jobPatchError: '', localModels: [{ name: 'qwen3:4b', size: 2500000000, parameters: '4B' }] };
  const dom = new JSDOM(html, { url: 'http://jobos.test/#' + page, runScripts: 'outside-only' });
  Object.assign(dom.window, { stages, analyzeResume, jobUrl, dailyOpportunities, filterOpportunities, opportunityCards, applicationContacts, applicationList, searchNowButton, orderJobs, matchesPublication, tailoringPage, tailoringResult, emailDraftUrl, aiModelsPage, updateAIForm, modelDownloadStatus, groundingSuggestions, aiQuotaHelp, setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; }, fetch: async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method || 'GET', body });
    if (path === '/api/state' && network.fail) throw new Error('Synthetic connection loss');
    if (path.startsWith('/api/jobs/') && options.method === 'PATCH') {
      if (network.jobPatchError) return { ok: false, json: async () => ({ error: network.jobPatchError }) };
      Object.assign(state.jobs.find(job => job.id === path.split('/').at(-1)), body);
    }
    let value = state;
    if (path === '/api/ai/config') {
      if (body.expectedRevision !== state.ai.revision) return { ok: false, json: async () => ({ error: 'AI settings changed. Reload saved settings before saving.' }) };
      state.ai = publicAI(updateAIConfig(state.ai, body), credentialStore(null, {})); value = state.ai;
    }
    if (path === '/api/ai/test') value = { ready: true, message: 'Synthetic model connection passed.' };
    if (path === '/api/ai/search-test') value = network.searchTest || { ready: true, message: 'Synthetic live search passed.' };
    if (path === '/api/ai/models') value = { models: ['synthetic-local-model'] };
    if (path === '/api/ai/local/models') value = { models: network.localModels };
    if (path === '/api/ai/local/select') { state.ai = publicAI(updateAIConfig(state.ai, { provider: 'ollama', model: body.model }), credentialStore(null, {})); value = state.ai; }
    if (path === '/api/ai/local/setup') { state.modelDownloads = [{ id: 'local', status: 'running', phase: 'Downloading local model', model: body.model || 'qwen3:4b', createdAt: new Date().toISOString() }]; value = { id: 'local', status: 'running' }; }
    if (path === '/api/ai/search/local/setup') { state.modelDownloads = [{ id: 'local-search', status: 'running', tool: 'searxng', phase: 'Starting local search', model: 'SearXNG', createdAt: new Date().toISOString() }]; value = { id: 'local-search', status: 'running' }; }
    if (path === '/api/settings') { Object.assign(settings, body); state.opportunities.maxAgeDays = settings.searchMaxAgeDays; value = settings; }
    if (path === '/api/codex/search') { const run = { id: 'synthetic-search', status: 'running', preferences: searchPreferences(body) }; state.searches = [run]; value = run; }
    if (path === '/api/codex/scan') { const run = { id: 'synthetic-scan', status: 'running', jobSite: body.jobSite || 'all', phase: 'Starting LinkedIn, company careers and Indeed search' }; state.scans = [run]; value = run; }
    if (path === '/api/codex/cv-source') value = { source: starterLatex('Synthetic Python and SQL engineer.'), hash: 'synthetic-hash', exists: true };
    if (path === '/api/codex/tailor') { const run = { id: 'synthetic-tailor-' + state.tailorings.length, status: 'running', mode: body.analysisOnly ? 'analysis' : 'draft', jobId: body.jobId, language: body.language, recipientName: body.recipientName, recipientEmail: body.recipientEmail, phase: 'Reading the offer and identifying CV/email priorities' }; state.tailorings = [run, ...state.tailorings]; value = run; }
    if (path.startsWith('/api/codex/tailor/')) value = state.tailorings.find(run => run.id === path.split('/').at(-1));
    return { ok: true, json: async () => structuredClone(value) };
  } });
  t.after(async () => { await new Promise(resolve => setImmediate(resolve)); dom.window.close(); });
  Object.assign(dom.window, { uniqueSearchWarnings, searchSummary, searchFailureText, searchRunSource, searchSourceLabel, searchAccessHelp, closeOpportunityButton, localModelCatalog, helpPage });
  dom.window.eval(source);
  await settle(() => !!dom.window.document.querySelector('h1'));
  return { dom, document: dom.window.document, calls, state, network, poll: () => intervals.find(timer => timer.delay === 3000).callback() };
}
test('actual search form has posting-window controls and saves them before a manual request', async t => {
  const { dom, document, calls, state } = await setup(t);
  assert.equal(document.querySelector('[name="limit"]'), null);
  const windowSelect = document.querySelector('[name="maxAgeDays"]');
  assert.deepEqual([...windowSelect.options].map(o => o.value), ['1', '7', '14', '30']);
  assert.equal(windowSelect.value, '30');
  assert.equal(document.querySelector('[name="includeReview"]').checked, true);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  windowSelect.value = '7';
  document.querySelector('[data-action="save-search-preferences"]').click();
  await settle(() => calls.some(c => c.path === '/api/settings'));
  assert.equal(state.settings.searchMaxAgeDays, 7);
  document.querySelector('#linkedin-search-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => calls.some(c => c.path === '/api/codex/scan'));
  await settle(() => document.querySelector('#workflow-status')?.textContent.includes('LinkedIn + Indeed search in progress'));
  const request = calls.find(c => c.path === '/api/codex/scan');
  assert.deepEqual(request.body, { jobSite: 'all' });
  assert.equal(state.settings.searchIncludeReview, true); assert.equal(state.settings.searchMaxAgeDays, 7);
  assert.ok(calls.findIndex(c => c.path === '/api/settings') < calls.findIndex(c => c.path === '/api/codex/scan'));
  assert.equal(calls.filter(c => c.path === '/api/codex/search').length, 0);
});
test('actual daily UI defaults to recent dates and retains historical offers through All saved', async t => {
  const stamp = new Date().toISOString();
  const base = { title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', description: 'Build software with Python and SQL.', stage: 'Saved', source: 'Manual', createdAt: stamp, sourceCheckedAt: stamp, updatedAt: stamp };
  const jobs = [{ ...base, id: 'new', postedAt: '1 day ago' }, { ...base, id: 'old', postedAt: '4 months ago' }, { ...base, id: 'unknown', postedAt: '' }];
  const { dom, document } = await setup(t, 'daily', jobs);
  assert.equal(document.querySelector('#daily-posted').value, 'recent');
  assert.equal(document.querySelectorAll('.opportunity-card').length, 1);
  const selector = document.querySelector('#daily-posted'); selector.value = 'all';
  selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelectorAll('.opportunity-card').length, 3);
  document.querySelector('[data-action="publication-view"][data-view="older"]').click();
  assert.equal(selector.value, 'older');
  assert.equal(document.querySelectorAll('.opportunity-card').length, 1);
  assert.equal(document.querySelector('.opportunity-card').dataset.jobId, 'old');
  document.querySelector('[data-action="publication-view"][data-view="unknown"]').click();
  selector.value = 'unknown'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelectorAll('.opportunity-card').length, 1);
  assert.equal(document.querySelector('.opportunity-card').dataset.jobId, 'unknown');
});
for (const layout of ['list', 'board']) test(`Applications ${layout} closes an offer directly and can reopen it without deleting history`, async t => {
  const job = { id: 'close-me', title: 'Junior <Engineer>', company: 'Acme', location: 'Rabat', source: 'Manual', stage: 'Saved', notes: 'Not my domain.', description: 'Develop software in Python.' };
  const { dom, document, calls, state } = await setup(t, 'pipeline', [job]);
  if (layout === 'board') document.querySelector('[data-action="board-view"]').click();
  const close = document.querySelector('[data-action="close-job"]');
  assert.ok(close); assert.match(close.getAttribute('aria-label'), /Junior <Engineer>/);
  close.click(); close.click();
  await settle(() => !document.querySelector('[data-action="close-job"]'));
  const mutations = calls.filter(call => call.method !== 'GET');
  assert.deepEqual(mutations, [{ path: '/api/jobs/close-me', method: 'PATCH', body: { stage: 'Closed' } }]);
  assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].notes, 'Not my domain.'); assert.equal(state.jobs[0].stage, 'Closed');
  assert.match(document.querySelector('#toast').textContent, /History and notes kept/);
  if (layout === 'board') document.querySelector('[data-action="list-view"]').click();
  const stage = document.querySelector('[data-stage-job="close-me"]'); assert.equal(stage.value, 'Closed');
  stage.value = 'Saved'; stage.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await settle(() => !!document.querySelector('[data-action="close-job"]'));
  assert.equal(state.jobs[0].stage, 'Saved'); assert.equal(state.jobs[0].notes, 'Not my domain.');
  assert.equal(calls.filter(call => call.method === 'DELETE' || call.path === '/api/codex/scan').length, 0);
});

test('failed Close request keeps the current stage and permits retry', async t => {
  const job = { id: 'close-me', title: 'Engineer', company: 'Acme', stage: 'Saved', notes: 'Keep me.' };
  const { document, state, network } = await setup(t, 'pipeline', [job]);
  network.jobPatchError = 'Synthetic stage save failed';
  const button = document.querySelector('[data-action="close-job"]'); button.click();
  await settle(() => document.querySelector('#toast').textContent === network.jobPatchError);
  assert.equal(button.disabled, false); assert.equal(state.jobs[0].stage, 'Saved'); assert.equal(state.jobs[0].notes, 'Keep me.');
  network.jobPatchError = ''; button.click();
  await settle(() => state.jobs[0].stage === 'Closed');
});

test('tailoring UI previews the offer analysis before writing and forwards its ID without CV data', async t => {
  const job = { id: 'job', title: 'Data Engineer', company: 'Example', description: 'Build production software using Python and SQL.', stage: 'Saved' };
  const { dom, document, calls, state, poll } = await setup(t, 'tailor', [job]);
  await settle(() => document.querySelector('#tex-source').value.includes('documentclass'));
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  document.querySelector('#tailor-form [name="language"]').value = 'French';
  document.querySelector('#tailor-form [name="recipientName"]').value = 'Example Recruiter';
  document.querySelector('#tailor-form [name="recipientEmail"]').value = 'hr@example.com';
  document.querySelector('[data-action="analyze-offer"]').click();
  await settle(() => calls.some(call => call.path === '/api/codex/tailor'));
  await settle(() => document.querySelector('#tailoring-result').textContent.includes('Reading the offer'));
  const request = calls.find(call => call.path === '/api/codex/tailor');
  assert.equal(request.body.analysisOnly, true); assert.equal('source' in request.body, false); assert.equal('resume' in request.body, false);
  assert.equal(document.querySelector('[data-action="analyze-offer"]').disabled, true);
  state.tailorings[0] = { ...state.tailorings[0], status: 'completed', analysisReady: true, analysis: { summary: 'Prioriser Python et SQL.', points: [{ requirement: 'Python et SQL', priority: 'required', match: 'supported', cvEvidence: 'Synthetic Python and SQL engineer.', jobEvidence: job.description, cvSource: 'master', cvAction: 'Mettre en avant le projet.', emailAction: 'Relier le projet à l’offre.' }], questions: [], warnings: [] } };
  await poll();
  assert.match(document.querySelector('[data-offer-analysis]').textContent, /À mettre en avant dans le CV.*Angles pour le mail/);
  assert.equal(document.querySelector('#tailored-review-form'), null);
  assert.equal(document.querySelector('#tailor-form [name="language"]').value, 'French');
  assert.equal(document.querySelector('#tailor-form [name="recipientName"]').value, 'Example Recruiter');
  assert.equal(document.querySelector('#tailor-form [name="recipientEmail"]').value, 'hr@example.com');
  const analysisId = state.tailorings[0].id;
  document.querySelector('#tailor-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => calls.filter(call => call.path === '/api/codex/tailor').length === 2);
  assert.equal(calls.filter(call => call.path === '/api/codex/tailor')[1].body.analysisId, analysisId);
  assert.equal(calls.filter(call => call.path === '/api/codex/tailor')[1].body.recipientEmail, 'hr@example.com');
});
test('actual application button starts a manual scan only when clicked and history is renamed', async t => {
  const { document, calls } = await setup(t, 'pipeline');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.match(document.querySelector('[data-page="automation"]').textContent, /Search history & employers/);
  document.querySelector('[data-action="scan-now"]').click();
  await settle(() => calls.some(c => c.path === '/api/codex/scan'));
  await settle(() => document.querySelector('#toast').textContent.includes('Search started now.'));
  assert.equal(calls.filter(c => c.path === '/api/codex/scan').length, 1);
});

test('one search button on all main pages starts a combined workflow and shares the busy guard', async t => {
  for (const page of ['pipeline', 'daily', 'automation']) {
    const { document, calls, state } = await setup(t, page);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
    const preferences = JSON.stringify(state.settings);
    assert.equal(document.querySelectorAll('[data-action="scan-now"]').length, 1);
    assert.equal(document.querySelector('[data-action="scan-indeed"]'), null);
    assert.match(document.querySelector('[data-action="scan-now"]').title, /LinkedIn.*Indeed/);
    document.querySelector('[data-action="scan-now"]').click();
    await settle(() => calls.some(call => call.path === '/api/codex/scan'));
    await settle(() => document.querySelector('#workflow-status').textContent.includes('LinkedIn + Indeed search in progress'));
    assert.deepEqual(calls.find(call => call.path === '/api/codex/scan').body, { jobSite: 'all' });
    assert.equal(document.querySelector('[data-action="scan-now"]').disabled, true);
    document.querySelector('[data-action="scan-now"]').click();
    assert.equal(calls.filter(call => call.path === '/api/codex/scan').length, 1);
    assert.match(document.querySelector('#workflow-status').textContent, /LinkedIn \+ Indeed search in progress/);
    assert.equal(JSON.stringify(state.settings), preferences);
  }
});


test('broader-coverage checkbox can be disabled and saves an explicit false for manual requests', async t => {
  const { dom, document, calls, state } = await setup(t);
  document.querySelector('[name="includeReview"]').checked = false;
  document.querySelector('[data-action="save-search-preferences"]').click();
  await settle(() => state.settings.searchIncludeReview === false);
  document.querySelector('#linkedin-search-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => document.querySelector('#workflow-status')?.textContent.includes('LinkedIn + Indeed search in progress'));
  assert.equal(state.settings.searchIncludeReview, false);
  assert.deepEqual(calls.find(c => c.path === '/api/codex/scan').body, { jobSite: 'all' });
});

test('active scan shows the real step and elapsed time, then clears busy state while a form remains focused', async t => {
  const run = { id: 'scan', status: 'running', phase: 'Researching employers and recruiting contacts (1-5 of 5)', createdAt: new Date(Date.now() - 13 * 60000).toISOString() };
  const { document, state, poll, calls } = await setup(t, 'pipeline', [], { scans: [run] });
  assert.match(document.querySelector('#workflow-status').textContent, /Researching employers.*13 minutes elapsed/);
  assert.match(document.querySelector('#workflow-status').textContent, /separate background Codex run/);
  assert.equal(document.querySelector('[data-action="scan-now"]').disabled, true);
  const input = document.querySelector('#search'); input.value = 'Unsaved filter'; input.focus();
  state.scans = [{ ...run, status: 'completed', newJobIds: Array.from({ length: 8 }, (_, i) => String(i)), companiesResearched: 5, warnings: [] }];
  await poll();
  assert.match(document.querySelector('#workflow-status').textContent, /Search completed.*8 new opportunities saved.*5 employers researched/);
  assert.equal(document.querySelector('[data-action="scan-now"]').disabled, false);
  assert.equal(document.querySelector('[data-action="scan-now"]').textContent, '⌕ Search now');
  assert.equal(document.querySelector('#search'), input); assert.equal(input.value, 'Unsaved filter');
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('connection failure is visible, disables new workflows, and recovers without starting another search', async t => {
  const run = { id: 'scan', status: 'running', phase: 'Searching recent offers', createdAt: new Date().toISOString() };
  const { document, state, poll, network, calls } = await setup(t, 'pipeline', [], { scans: [run] });
  network.fail = true; await poll();
  assert.match(document.querySelector('#workflow-status').textContent, /Cannot reach JobOS.*status may be outdated/);
  assert.equal(document.querySelector('[data-action="scan-now"]').disabled, true);
  network.fail = false;
  state.scans = [{ ...run, status: 'failed', error: 'The server restarted. Please retry.' }];
  await poll();
  assert.match(document.querySelector('#workflow-status').textContent, /Search needs attention.*server restarted/);
  assert.equal(document.querySelector('[data-action="scan-now"]').disabled, false);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('refresh status keeps edited domains and uses only a read request; all workflows share the UI guard', async t => {
  const run = { id: 'rank', status: 'running', createdAt: new Date().toISOString() };
  const { document, state, calls } = await setup(t, 'search', [], { rankings: [run] });
  const input = document.querySelector('[name="domains"]'); input.value = 'My unsaved domain edit';
  assert.equal(document.querySelector('#linkedin-search-form button').disabled, true);
  assert.match(document.querySelector('#workflow-status').textContent, /CV comparison in progress/);
  state.rankings = [{ ...run, status: 'completed' }];
  document.querySelector('[data-action="refresh-status"]').click();
  await settle(() => document.querySelector('#workflow-status').textContent.includes('CV comparison completed'));
  assert.equal(document.querySelector('[name="domains"]'), input); assert.equal(input.value, 'My unsaved domain edit');
  assert.equal(document.querySelector('#linkedin-search-form button').disabled, false);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('a failed draft is distinguished from a search and its error is rendered safely', async t => {
  const { document } = await setup(t, 'pipeline', [], { scans: [{ id: 'older-scan', status: 'completed', createdAt: '2026-10-07T10:00:00Z', newJobIds: [], companiesResearched: 0 }], tailorings: [{ id: 'draft', status: 'failed', createdAt: '2026-10-08T10:00:00Z', error: '<img src=x onerror=alert(1)> Could not prepare the draft.' }] });
  assert.match(document.querySelector('#workflow-status').textContent, /CV draft needs attention.*Could not prepare the draft/);
  assert.equal(document.querySelector('#workflow-status img'), null);
  assert.equal(document.querySelector('#workflow-status a').getAttribute('href'), '#tailor');
  assert.equal(document.querySelector('[data-action="scan-now"]').disabled, false);
});

test('application publication filter and newest sorting work together in list and board views', async t => {
  const stamp = new Date().toISOString(), ago = days => new Date(Date.now() - days * 86400000).toISOString();
  const base = { title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', description: 'Develop software with Python and SQL.', stage: 'Saved', source: 'Manual', createdAt: stamp, updatedAt: stamp };
  const jobs = [{ ...base, id: 'old', postedAt: ago(40) }, { ...base, id: 'new', postedAt: ago(0.25) }, { ...base, id: 'unknown', postedAt: '' }, { ...base, id: 'week', postedAt: ago(3), stage: 'Applied' }];
  const { dom, document, calls } = await setup(t, 'pipeline', jobs);
  const selector = document.querySelector('#job-posted'), sort = document.querySelector('#job-sort');
  const ids = () => [...document.querySelectorAll('tbody [data-action="edit-job"]')].map(button => button.dataset.id);
  assert.equal(selector.value, 'all'); assert.equal(sort.value, 'newest'); assert.deepEqual(ids(), ['new', 'week', 'old', 'unknown']);
  assert.deepEqual([...selector.options].map(option => option.value), ['all', '1', '7', '14', '30', 'unknown']);
  selector.value = '7'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['new', 'week']);
  const stage = document.querySelector('#stage-filter'); stage.value = 'Applied'; stage.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['week']);
  document.querySelector('[data-action="board-view"]').click();
  assert.equal(document.querySelector('#job-posted').value, '7');
  assert.deepEqual([...document.querySelectorAll('.job-card [data-action="edit-job"]')].map(button => button.dataset.id), ['week']);
  document.querySelector('[data-action="list-view"]').click();
  const nextStage = document.querySelector('#stage-filter'); nextStage.value = 'All stages'; nextStage.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const next = document.querySelector('#job-posted'); next.value = 'unknown'; next.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['unknown']);
  next.value = 'all'; next.dispatchEvent(new dom.window.Event('change', { bubbles: true })); assert.equal(ids().length, 4);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('daily publication controls expose recent windows and never hide unknown records from All saved', async t => {
  const stamp = new Date().toISOString(), base = { title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', description: 'Develop software with Python and SQL.', stage: 'Saved', createdAt: stamp, updatedAt: stamp };
  const jobs = [{ ...base, id: 'today', postedAt: new Date(Date.now() - 2 * 3600000).toISOString() }, { ...base, id: 'older', postedAt: new Date(Date.now() - 10 * 86400000).toISOString() }, { ...base, id: 'unknown', postedAt: '' }];
  const { dom, document } = await setup(t, 'daily', jobs);
  const selector = document.querySelector('#daily-posted');
  assert.ok(['1', '7', '14', '30'].every(value => [...selector.options].some(option => option.value === value)));
  selector.value = '1'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelectorAll('.opportunity-card').length, 1); assert.equal(document.querySelector('.opportunity-card').dataset.jobId, 'today');
  selector.value = 'all'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); assert.equal(document.querySelectorAll('.opportunity-card').length, 3);
});

test('historical discovery results label deleted postings without offering to save them again', async t => {
  const url = 'https://www.linkedin.com/jobs/view/12345/';
  const { document } = await setup(t, 'search', [], { dismissedJobUrls: [url], searches: [{ id: 'old-search', status: 'completed', completedAt: new Date().toISOString(), summary: 'Historical discovery', jobs: [{ title: 'Engineer', company: 'Acme', url }] }] });
  assert.match(document.querySelector('#search-results').textContent, /Previously deleted/);
  assert.equal(document.querySelector('[data-action="save-search-job"]'), null);
});

test('AI model form switches profiles, saves private keys without echoing them and leaves workflows manual', async t => {
  const { dom, document, calls, state } = await setup(t, 'models');
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const provider = document.querySelector('#ai-provider'); provider.value = 'gemini'; provider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#ai-model').value, 'gemini-3.6-flash'); assert.equal(document.querySelector('#ai-search-provider').value, 'linkedin');
  assert.match(document.querySelector('#ai-data-note').textContent, /API server/);
  const key = document.querySelector('[name="key-gemini"]'); key.value = 'PRIVATE_UI_KEY';
  document.querySelector('#ai-config-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => state.ai.provider === 'gemini'); await settle(() => document.querySelector('[name="key-gemini"]').value === '');
  const request = calls.find(call => call.path === '/api/ai/config'); assert.equal(request.body.keys.gemini, 'PRIVATE_UI_KEY'); assert.equal('resume' in request.body, false);
  assert.equal(document.body.textContent.includes('PRIVATE_UI_KEY'), false);
  document.querySelector('[data-action="ai-test"]').click();
  await settle(() => document.querySelector('#ai-message').textContent.includes('passed'));
  dom.window.location.hash = '#search';
  await settle(() => !!document.querySelector('#linkedin-search-form'));
  assert.match(document.querySelector('#linkedin-search-form button').textContent, /Search now/);
  assert.match(document.querySelector('#search-results').textContent, /Google Gemini API/);
  assert.equal(calls.filter(call => ['/api/codex/scan', '/api/codex/search'].includes(call.path)).length, 0);
});

test('local model controls are explicit, show progress and block other model workflows until finished', async t => {
  const { document, state, calls, poll } = await setup(t, 'models');
  document.querySelector('#local-model-download-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => document.querySelector('#local-model-status').textContent.includes('Downloading local model'));
  assert.match(document.querySelector('#workflow-status').textContent, /does not use Codex/);
  assert.equal(calls.filter(call => call.path === '/api/ai/local/setup').length, 1);
  assert.equal(document.querySelector('[data-action="ai-test"]').disabled, true);
  state.modelDownloads = [{ ...state.modelDownloads[0], status: 'completed', phase: 'Local model ready.' }];
  await poll();
  assert.equal(document.querySelector('[data-action="ai-test"]').disabled, false);
  assert.match(document.querySelector('#local-model-status').textContent, /Local model ready/);
});
test('dedicated download form accepts another model without changing provider and lists it for explicit Use', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'searxng' }), credentialStore(null, {}));
  const { document, state, network, calls, poll } = await setup(t, 'models', [], { ai });
  document.querySelector('#download-model-name').value = 'qwen3:8b';
  document.querySelector('#local-model-download-form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => state.modelDownloads.length === 1);
  assert.deepEqual(calls.find(call => call.path === '/api/ai/local/setup').body, { model: 'qwen3:8b', expectedRevision: ai.revision });
  assert.equal(state.ai.provider, 'gemini'); assert.equal(state.ai.profiles.ollama.model, 'qwen3:4b');
  await settle(() => document.querySelector('#download-model-name').value === 'qwen3:8b' && document.querySelector('#local-model-download-form button').disabled);
  network.localModels.push({ name: 'qwen3:8b', size: 5200000000, parameters: '8B' });
  state.modelDownloads = [{ ...state.modelDownloads[0], status: 'completed', phase: 'Download complete.' }];
  await poll();
  await settle(() => !!document.querySelector('[data-action="use-installed-model"][data-model="qwen3:8b"]'));
  assert.equal(calls.some(call => call.path === '/api/ai/local/select'), false);
  document.querySelector('[data-action="use-installed-model"][data-model="qwen3:8b"]').click();
  await settle(() => state.ai.provider === 'ollama' && state.ai.profiles.ollama.model === 'qwen3:8b');
  assert.equal(state.ai.searchProvider, 'searxng'); assert.equal(calls.some(call => call.path === '/api/codex/scan'), false);
});
test('standalone help is readable without contacting model, search or provider APIs', async t => {
  const { document, calls } = await setup(t, 'help');
  assert.match(document.querySelector('h1').textContent, /Help & local setup/);
  assert.match(document.querySelector('#main').textContent, /npm run doctor/); assert.match(document.querySelector('#main').textContent, /Download model/);
  assert.ok(document.querySelector('a[href="/user-guide.md"][download]'));
  assert.deepEqual(calls.map(call => call.path), ['/api/state']);
});
test('legacy failed report distinguishes the hosted search used then from the currently selected local engine', async t => {
  const error = 'LinkedIn and company careers: Ollama web search: HTTP 429.\nIndeed: Ollama web search: HTTP 429.';
  const run = { status: 'failed', error, createdAt: '2026-11-04T14:51:57.297Z' }, before = JSON.stringify(run);
  const ai = publicAI(updateAIConfig({}, { searchProvider: 'searxng' }), credentialStore(null, {}));
  const { document, state, calls } = await setup(t, 'automation', [], { ai, scans: [run] });
  assert.equal(document.querySelector('#scan-result').textContent.match(/HTTP 429/g).length, 1);
  assert.match(document.querySelector('#scan-result .search-attempt-notice').textContent, /Hosted Ollama web search.*Current search: Local SearXNG/);
  assert.match(document.querySelector('#scan-result').textContent, /settings have changed/);
  assert.equal(JSON.stringify(state.scans[0]), before); assert.equal(calls.some(call => call.method !== 'GET'), false);
});
test('local workflow preset selects loopback generation/search without a key, download or job request', async t => {
  const { document, state, calls } = await setup(t, 'models');
  document.querySelector('[data-action="use-local-search"]').click();
  await settle(() => state.ai.searchProvider === 'searxng');
  await settle(() => document.querySelector('#ai-search-provider').value === 'searxng');
  assert.equal(state.ai.provider, 'ollama'); assert.equal(state.ai.searchBaseUrl, 'http://127.0.0.1:8888');
  assert.equal(document.querySelector('#ai-search-url-field').hidden, false); assert.equal(document.querySelector('.ai-key-fields').hidden, true);
  assert.deepEqual(calls.filter(call => call.method !== 'GET').map(call => call.path), ['/api/ai/config']);
  document.querySelector('[data-action="setup-local-search"]').click();
  await settle(() => state.modelDownloads.some(run => run.tool === 'searxng'));
  await settle(() => document.querySelector('[data-action="use-local-search"]').disabled);
  assert.match(document.querySelector('#workflow-status').textContent, /Local search setup in progress/);
  assert.equal(document.querySelector('[data-action="scan-now"]'), null);
  assert.equal(calls.some(call => call.path === '/api/codex/scan'), false);
});
test('free model shortcuts reveal in-app key fields and submit separate keys only on Save', async t => {
  const { dom, document, calls, state } = await setup(t, 'models');
  document.querySelector('[data-action="choose-ai-provider"][data-provider="openrouter"]').click();
  assert.equal(document.querySelector('#ai-provider').value, 'openrouter'); assert.equal(document.querySelector('[name="model"]').value, 'openrouter/free');
  assert.equal(document.querySelector('[data-ai-key="openrouter"]').hidden, false); assert.equal(document.querySelector('[name="baseUrl"]').readOnly, true);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  const source = document.querySelector('#ai-search-provider'); source.value = 'tavily'; source.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('[data-ai-key="tavily"]').hidden, false);
  document.querySelector('[name="key-openrouter"]').value = 'PRIVATE_ROUTER_KEY'; document.querySelector('[name="key-tavily"]').value = 'PRIVATE_SEARCH_KEY';
  document.querySelector('#ai-config-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => state.ai.provider === 'openrouter');
  const saved = calls.find(call => call.path === '/api/ai/config'); assert.deepEqual(saved.body.keys, { openrouter: 'PRIVATE_ROUTER_KEY', tavily: 'PRIVATE_SEARCH_KEY' });
  assert.equal(saved.body.searchProvider, 'tavily'); assert.equal(saved.body.resume, undefined);
  await settle(() => document.querySelector('[name="key-openrouter"]').value === '');
  assert.doesNotMatch(document.body.textContent, /PRIVATE_(?:ROUTER|SEARCH)_KEY/);
});

test('an old AI settings form keeps its original revision and cannot revert a remotely updated model', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'gemini' }), credentialStore(null, {}));
  const { dom, document, state, calls } = await setup(t, 'models', [], { ai });
  const oldRevision = document.querySelector('#ai-config-form').dataset.configRevision;
  document.querySelector('#ai-model').value = 'gemini-2.5-flash';
  state.ai = publicAI(updateAIConfig(state.ai, { model: 'gemini-3.8-flash' }), credentialStore(null, {}));
  document.querySelector('#ai-config-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(() => document.querySelector('#toast').textContent.includes('Reload saved settings'));
  assert.equal(calls.find(call => call.path === '/api/ai/config').body.expectedRevision, oldRevision);
  assert.equal(state.ai.profiles.gemini.model, 'gemini-3.8-flash'); assert.equal(document.querySelector('#ai-model').value, 'gemini-2.5-flash');
  document.querySelector('[data-action="ai-reload"]').click();
  await settle(() => document.querySelector('#ai-model').value === 'gemini-3.8-flash');
  assert.equal(document.querySelector('#ai-config-form').dataset.configRevision, state.ai.revision);
});

test('live search is tested explicitly without starting a scan or sending saved CV data', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'gemini' }), credentialStore(null, {}));
  const { document, calls } = await setup(t, 'models', [], { ai });
  assert.equal(document.querySelector('[data-action="ai-search-test"]').disabled, false);
  document.querySelector('[data-action="ai-search-test"]').click();
  await settle(() => document.querySelector('#ai-message').textContent.includes('live search passed'));
  const request = calls.find(call => call.path === '/api/ai/search-test');
  assert.deepEqual(Object.keys(request.body), ['expectedRevision']);
  assert.equal(calls.filter(call => ['/api/codex/scan', '/api/codex/search', '/api/codex/rank'].includes(call.path)).length, 0);
});

test('a historical search failure identifies the current search model without rerunning the failed attempt', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'gemini' }), credentialStore(null, {}));
  const { document, calls } = await setup(t, 'models', [], { ai, scans: [{ id: 'failed', status: 'failed', model: 'gemini-2.5-flash', createdAt: new Date().toISOString(), error: 'Gemini web search: model or endpoint not found (HTTP 404).' }] });
  const panel = document.querySelector('#workflow-status').textContent;
  assert.match(panel, /saved failure from that attempt/); assert.match(panel, /current Gemini search model is gemini-3\.6-flash/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('a live Gemini search quota failure gives safe setup guidance without changing providers or retrying', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'gemini' }), credentialStore(null, {}));
  const { document, calls, network, state } = await setup(t, 'models', [], { ai });
  network.searchTest = { ready: false, message: 'Gemini web search · gemini-3.6-flash: usage/rate limit reached (HTTP 429).' };
  document.querySelector('[data-action="ai-search-test"]').click();
  await settle(() => !!document.querySelector('#ai-message .ai-quota-help'));
  const help = document.querySelector('#ai-message .ai-quota-help');
  assert.equal(help.querySelector('a').href, 'https://aistudio.google.com/rate-limit?timeRange=last-28-days');
  assert.equal(help.querySelector('a').getAttribute('rel'), 'noopener noreferrer');
  assert.match(help.textContent, /does not identify the exhausted limit or its reset time/);
  assert.match(help.textContent, /change only Live search source/);
  assert.match(help.textContent, /Ollama web search is a hosted API and needs its own key/);
  assert.equal(state.ai.revision, ai.revision);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 1);
  assert.equal(document.querySelector('[data-action="ai-search-test"]').disabled, false);
});

test('a saved Gemini quota failure links to quotas without triggering requests or mislabeling other errors', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'gemini', searchProvider: 'gemini' }), credentialStore(null, {}));
  const { document, calls } = await setup(t, 'daily', [], { ai, scans: [{ id: 'limited', status: 'failed', createdAt: new Date().toISOString(), error: 'Gemini web search · gemini-3.6-flash: usage/rate limit reached (HTTP 429).' }] });
  assert.ok(document.querySelector('#workflow-status .ai-quota-help a[href^="https://aistudio.google.com/rate-limit"]'));
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  assert.equal(aiQuotaHelp('Brave Search: usage/rate limit reached (HTTP 429).'), '');
  assert.equal(aiQuotaHelp('Google Gemini API: usage/rate limit reached (HTTP 429).'), '');
  assert.equal(aiQuotaHelp('Gemini web search: model or endpoint not found (HTTP 404).'), '');
});

test('selecting local model and free search saves only settings without an implicit download or scan', async t => {
  const { document, calls, state } = await setup(t, 'models');
  document.querySelector('[data-action="use-local-model"]').click();
  await settle(() => state.ai.provider === 'ollama' && state.ai.searchProvider === 'linkedin');
  await settle(() => document.querySelector('#ai-model').value === 'qwen3:4b');
  assert.equal(document.querySelector('.ai-key-fields').hidden, true);
  assert.equal(document.querySelector('#ai-model').value, 'qwen3:4b');
  const mutations = calls.filter(call => call.method !== 'GET');
  assert.equal(mutations.length, 1); assert.equal(mutations[0].path, '/api/ai/config');
  assert.equal(mutations[0].body.searchProvider, 'linkedin'); assert.equal(mutations[0].body.keys, undefined);
  assert.equal(document.querySelector('[data-action="ai-search-test"]').disabled, false);
});

test('local preset offers public search without keys and the local setup selector respects active workflows', async t => {
  const { document, dom } = await setup(t, 'models');
  document.querySelector('#ai-provider').value = 'ollama';
  document.querySelector('#ai-provider').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#ai-search-provider').value, 'linkedin');
  assert.equal(document.querySelector('.ai-key-fields').hidden, true);
  const busy = await setup(t, 'models', [], { modelDownloads: [{ id: 'local', status: 'running', model: 'qwen3:4b', phase: 'Downloading', createdAt: new Date().toISOString() }] });
  assert.equal(busy.document.querySelector('[data-action="use-local-model"]').disabled, true);
});

test('a failed local generation directs users to the model test separately from website tests', async t => {
  const ai = publicAI(updateAIConfig({}, { provider: 'ollama', searchProvider: 'linkedin' }), credentialStore(null, {}));
  const { document, calls } = await setup(t, 'daily', [], { ai, scans: [{ id: 'local-failure', status: 'failed', createdAt: new Date().toISOString(), error: 'Ollama · local: generation exceeded 20 minutes.' }] });
  assert.match(document.querySelector('#workflow-status').textContent, /Test saved model.*local generation/);
  assert.match(document.querySelector('#workflow-status').textContent, /Test live search.*websites separately/);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});

test('Google grounding suggestions are contained in a sandbox without executable page markup', () => {
  const dom = new JSDOM(groundingSuggestions(['<script>parent.evil()</script><a href="https://google.com">Google</a>']));
  assert.equal(dom.window.document.querySelectorAll('script').length, 0);
  const frame = dom.window.document.querySelector('iframe'); assert.equal(frame.getAttribute('sandbox'), 'allow-popups'); assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.ok(frame.getAttribute('srcdoc').includes('default-src')); dom.window.close();
});

test('blocked source history shows limited coverage and unique warnings without editing saved records or starting a run', async t => {
  const blocked = 'Public web search blocked this request. No challenge was bypassed.';
  const linkedin = 'Public LinkedIn returned an unreadable listing page.';
  const warnings = [blocked, linkedin, ...Array(7).fill('Employer research: ' + blocked)];
  const ai = publicAI(updateAIConfig({}, { provider: 'ollama', searchProvider: 'ollama' }), credentialStore(null, { OLLAMA_API_KEY: 'SYNTHETIC_PRIVATE_KEY' }));
  const run = { id: 'partial', status: 'completed', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), newJobIds: [], companiesResearched: 0, closedJobs: [], technologies: [], summary: 'Synthetic partial scan', warnings };
  const { document, calls, state } = await setup(t, 'automation', [], { ai, scans: [run] });
  assert.match(document.querySelector('#workflow-status').textContent, /completed with limited coverage/);
  assert.match(document.querySelector('#workflow-status').textContent, /2 warnings to review/);
  assert.match(document.querySelector('.search-access-help').textContent, /do not test your current search selection/);
  assert.match(document.querySelector('.search-access-help').textContent, /API key is configured/);
  assert.equal(document.querySelectorAll('#scan-result .error-inline').length, 2);
  assert.equal(state.scans[0].warnings.length, 9);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  assert.doesNotMatch(document.body.textContent, /SYNTHETIC_PRIVATE_KEY/);
});

test('historical Ollama 429 reports keep source coverage and one warning with local-search recovery guidance', async t => {
  const warning = 'Ollama web search: usage/rate limit reached; change provider or retry later (HTTP 429).';
  const run = { id: 'quota', status: 'completed', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), newJobIds: ['saved-job'], companiesResearched: 0, closedJobs: [], technologies: [], summary: `LinkedIn and company careers: 5 source-checked opportunities retained.\nIndeed: ${warning}`, warnings: [warning, `Indeed: ${warning}`, `Employer research: ${warning}`], sourceResults: [{ jobSite: 'linkedin', status: 'completed', jobCount: 5 }, { jobSite: 'indeed', status: 'failed', error: warning }] };
  const before = JSON.stringify(run);
  const { document, calls, state } = await setup(t, 'automation', [], { scans: [run] });
  assert.equal(document.querySelectorAll('#scan-result .error-inline').length, 1);
  assert.equal(document.querySelector('#scan-result').textContent.match(/HTTP 429/g).length, 1);
  assert.match(document.querySelector('.source-coverage').textContent, /Indeed: Search incomplete/);
  assert.match(document.querySelector('#scan-result').textContent, /5 source-checked/);
  assert.match(document.querySelector('#workflow-status').textContent, /1 warning to review/);
  assert.match(document.querySelector('.search-access-help').textContent, /runs on ollama.com/);
  assert.match(document.querySelector('.search-access-help').textContent, /Save AI settings and Test live search/);
  assert.match(document.querySelector('.search-access-help').textContent, /does not tell us when the limit resets/);
  assert.equal(JSON.stringify(state.scans[0]), before); assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});
