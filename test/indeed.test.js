import test from 'node:test';
import assert from 'node:assert/strict';
import { jobUrl } from '../lib/domain.js';
import { jobSite } from '../lib/job-sites.js';
import { sourceJob } from '../lib/source-job.js';
import { searchQueries, createWebSearch } from '../lib/web-search.js';
import { searchPreferences, discoveryPrompt, validateDiscovery, checkDiscoverySources } from '../lib/discovery.js';
import { createIndeedPublicSearch, parseIndeedListings } from '../lib/indeed-public-search.js';
import { createAIBackend } from '../lib/ai.js';
import { updateAIConfig, credentialStore } from '../lib/ai-config.js';

const key = i => (1000 + i).toString(16).padStart(16, '0');
const url = i => `https://www.indeed.com/viewjob?jk=${key(i)}`;
const preferences = searchPreferences({ domains: 'Software engineering', location: 'Morocco and remote roles', level: 'Graduate / Entry level', jobSite: 'indeed', includeReview: false });
const description = 'Build software services using Python, SQL and Docker in a junior engineering team.';
const page = (i, extras = {}) => `<html><body><h1>Junior Software Engineer ${i}</h1><div data-testid="inlineHeader-companyName">Example Employer</div><div id="jobDescriptionText">${description}</div><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Junior Software Engineer ' + i, hiringOrganization: { name: 'Example Employer' }, description, datePosted: new Date().toISOString(), jobLocation: { address: { addressLocality: 'Rabat', addressCountry: 'Morocco' } }, ...extras })}</script></body></html>`;
const card = i => `<div class="job_seen_beacon"><h2><a data-jk="${key(i)}" href="/rc/clk?jk=${key(i)}&tracking=demo"><span title="Junior Software Engineer ${i}">Junior Software Engineer ${i}</span></a></h2><span data-testid="company-name">Example Employer</span></div>`;
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html' } });

test('Indeed posting keys canonicalize regional, tracking and selected-job URLs without merging distinct IDs', () => {
  for (const input of [`https://ma.indeed.com/viewjob?jk=${key(1)}&from=web`, `https://fr.indeed.com/rc/clk?jk=${key(1)}&utm_source=search`, `https://www.indeed.com/jobs?q=python&vjk=${key(1)}#details`]) assert.equal(jobUrl(input), url(1));
  assert.notEqual(jobUrl(url(1)), jobUrl(url(2)));
  assert.notEqual(jobUrl(`https://indeed.com.evil.test/viewjob?jk=${key(1)}`), url(1));
  assert.throws(() => jobSite('other')); assert.equal(jobSite(), 'linkedin');
});

test('Indeed queries cover all saved domains and regions without changing the LinkedIn default or adding employer searches', () => {
  const queries = searchQueries({ ...preferences, domains: ['Software engineering', 'Data engineering'], includeEmployerSites: true });
  assert.ok(queries.every(q => q.includes('site:indeed.com/viewjob') && !q.includes('linkedin')));
  assert.ok(queries.some(q => q.includes('Data engineering'))); assert.ok(queries.some(q => q.includes('remote')));
  assert.ok(searchQueries({ ...preferences, jobSite: undefined })[0].includes('site:linkedin.com/jobs/view'));
  const prompt = discoveryPrompt(preferences); assert.match(prompt, /Indeed/); assert.doesNotMatch(prompt, /LinkedIn|linkedin\.com/);
  assert.match(prompt, /"jobSite":"indeed"/); assert.match(prompt, /"includeEmployerSites":false/);
});

test('Gemini grounded search keeps Indeed vacancy instructions scoped to Indeed', async () => {
  const engine = createWebSearch({ searchProvider: 'gemini', searchModel: 'synthetic-model' }, credentialStore(null, { GEMINI_API_KEY: 'SYNTHETIC_KEY' }), {
    fetcher: async (_endpoint, options) => {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.match(prompt, /Indeed-only vacancy query/); assert.doesNotMatch(prompt, /LinkedIn/);
      return new Response(JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: url(1) } }] }, content: { parts: [{ text: JSON.stringify({ results: [{ title: 'Junior Software Engineer', url: url(1), content: description }] }) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  const rows = await engine.query('software Morocco site:indeed.com/viewjob', 30);
  assert.equal(rows[0].url, url(1));
});

test('Indeed validation accepts literal posting identities and rejects other sources, generic pages and guessed keys', () => {
  const input = { summary: 'Synthetic', jobs: [{ title: 'Junior Software Engineer 1', company: 'Example Employer', location: '', url: url(1), description, evidence: 'Example Employer hires a Junior Software Engineer.', postedAt: 'today' }] };
  assert.equal(validateDiscovery(input, preferences).jobs[0].source, 'Codex Indeed search');
  for (const bad of ['https://www.linkedin.com/jobs/view/111/', 'https://www.indeed.com/jobs?q=python', 'https://www.indeed.com/viewjob?jk=invented', `https://indeed.com.evil.test/viewjob?jk=${key(1)}`]) assert.throws(() => validateDiscovery({ ...input, jobs: [{ ...input.jobs[0], url: bad }] }, preferences));
});

test('Indeed readable source checks extract actual description, posting date, location and closure', async () => {
  const candidate = sourceJob(url(1), page(1));
  const result = await checkDiscoverySources({ jobs: [candidate] }, async value => ({ url: value, text: page(1) }));
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].description, description); assert.match(result.jobs[0].location, /Rabat/); assert.ok(result.jobs[0].postedAt);
  const expired = await checkDiscoverySources({ jobs: [candidate] }, async value => ({ url: value, text: page(1, { validThrough: '2020-01-01' }) }));
  assert.equal(expired.jobs[0].availabilityStatus, 'closed');
  assert.equal(sourceJob(url(1), '<title>Just a moment</title><div id="captcha">Verify you are human</div>'), null);
  const unreadable = await checkDiscoverySources({ jobs: [candidate] }, async () => { throw new Error('Blocked'); });
  assert.equal(unreadable.jobs.length, 0);
});

test('Indeed listings paginate literal next links past 25 offers and stop once when challenged', async () => {
  let calls = 0;
  const engine = createIndeedPublicSearch({ searchPause: async () => {}, fetcher: async value => {
    calls++; const request = new URL(value); assert.equal(request.searchParams.get('sort'), 'date');
    if (calls === 1) { assert.equal(request.searchParams.get('fromage'), '30'); return html(Array.from({ length: 25 }, (_, i) => card(i)).join('') + '<a data-testid="pagination-page-next" href="/jobs?start=25&sort=date">Next</a>'); }
    if (calls === 2) return html(Array.from({ length: 7 }, (_, i) => card(i + 25)).join('') + '<a data-testid="pagination-page-next" href="/jobs?start=50&sort=date">Next</a>');
    return html('<title>Just a moment</title><div>Verify you are human</div>');
  } });
  const result = await engine.query('Software Morocco Maroc site:indeed.com/viewjob', 30);
  assert.equal(result.rows.length, 32); assert.equal(result.warnings.length, 1);
  await assert.rejects(engine.query('Data Morocco site:indeed.com/viewjob'), /verification/); assert.equal(calls, 3);
  assert.equal(parseIndeedListings('<p>No jobs found</p>').rows.length, 0);
});

test('local Indeed discovery saves verified jobs only, skips deleted IDs and does not invoke generation or LinkedIn', async () => {
  const config = updateAIConfig({}, { provider: 'ollama', searchProvider: 'ollama' });
  const calls = [];
  const backend = createAIBackend(config, credentialStore(null, { OLLAMA_API_KEY: 'SYNTHETIC_KEY' }), {
    fetcher: async (endpoint, options) => { assert.equal(endpoint, 'https://ollama.com/api/web_search'); const body = JSON.parse(options.body); assert.match(body.query, /site:indeed/); assert.doesNotMatch(body.query, /PRIVATE_CV/); calls.push(body.query); return new Response(JSON.stringify({ results: [0, 1, 2].map(i => ({ title: 'Junior Software Engineer ' + i, url: url(i), content: description })).concat([{ title: 'Other source', url: 'https://www.linkedin.com/jobs/view/123/', content: description }]) }), { headers: { 'Content-Type': 'application/json' } }); },
    fetchText: async value => { assert.ok(value.includes('indeed.com')); return { url: value, text: value === url(2) ? '<title>Just a moment</title>Verify you are human' : page(value === url(0) ? 0 : 1) }; }
  });
  const result = await backend.search({ ...preferences, excludedUrls: [`https://ma.indeed.com/viewjob?jk=${key(1)}&from=old`] });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].url, url(0)); assert.equal(result.jobs[0].source, 'AI Indeed search');
  assert.ok(result.warnings.some(warning => /Indeed posting.*unreadable/.test(warning))); assert.ok(calls.length);
});
