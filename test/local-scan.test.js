import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLocalGeneration, createModelClient } from '../lib/ai-client.js';
import { createAIBackend } from '../lib/ai.js';
import { updateAIConfig, credentialStore } from '../lib/ai-config.js';
import { performAutomatedScan } from '../lib/automation.js';

const local = updateAIConfig({}, { provider: 'ollama', searchProvider: 'brave' });
const schema = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };

test('local generation streams Unicode fragments and accepts only a completed structured response', async () => {
  const events = [{ message: { content: '{"text":"dé' } }, { message: { content: 'veloppeur"}' }, done: true, done_reason: 'stop' }].map(event => JSON.stringify(event)).join('\n');
  const bytes = new TextEncoder().encode(events), stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); } });
  const client = createModelClient(local, credentialStore(null, {}), async (_url, options) => { const body = JSON.parse(options.body); assert.equal(body.stream, true); assert.equal(body.think, false); return new Response(stream); });
  assert.deepEqual(await client.generate('Synthetic generation.', schema), { text: 'développeur' });
});

test('local incomplete, oversized and provider-error streams are rejected without exposing provider text', async () => {
  for (const body of [JSON.stringify({ message: { content: '{"text":"partial"}' } }), JSON.stringify({ error: 'PRIVATE CV AND KEY' }), 'not JSON PRIVATE CV AND KEY', 'x'.repeat(2000001)]) {
    await assert.rejects(requestLocalGeneration('http://127.0.0.1:11434/api/chat', {}, { fetcher: async () => new Response(body) }), error => !/PRIVATE|KEY/.test(error.message));
  }
});

test('local timeout and connection errors are distinct and never expose internal exception bodies', async () => {
  await assert.rejects(requestLocalGeneration('http://127.0.0.1:11434/api/chat', {}, { timeoutMs: 5, fetcher: async (_url, options) => new Promise((_, reject) => { options.signal.addEventListener('abort', () => reject(new Error('PRIVATE CV AND KEY'))); setTimeout(() => reject(new Error('PRIVATE CV AND KEY')), 30); }) }), error => error.code === 'MODEL_TIMEOUT' && /generation exceeded/.test(error.message) && !/PRIVATE|KEY/.test(error.message));
  await assert.rejects(requestLocalGeneration('http://127.0.0.1:11434/api/chat', {}, { fetcher: async () => { throw new Error('PRIVATE CV AND KEY'); } }), error => error.code === 'MODEL_CONNECTION' && /connection interrupted/.test(error.message) && !/PRIVATE|KEY/.test(error.message));
});

test('local discovery reads more than 25 dated postings without asking the model to recopy descriptions', async () => {
  const keys = credentialStore(null, {}); keys.save({ brave: 'synthetic-search-key' }); let modelCalls = 0;
  const urls = Array.from({ length: 28 }, (_, i) => `https://www.linkedin.com/jobs/view/${8800000000 + i}/`);
  const fetchText = async url => ({ url, text: '<html><body><h1>Junior Software Engineer</h1><a class="topcard__org-name-link">Acme</a><span class="posted-time-ago__text">2 days ago</span><div class="description__text">Build Python and SQL software APIs with automated tests.</div></body></html>' });
  const backend = createAIBackend(local, keys, { fetchText, fetcher: async url => {
    if (!url.startsWith('https://api.search.brave.com')) { modelCalls++; throw new Error('Discovery must not use model generation'); }
    const offset = Number(new URL(url).searchParams.get('offset')); return new Response(JSON.stringify({ query: { more_results_available: offset === 0 }, web: { results: urls.slice(offset * 20, offset * 20 + 20).map(url => ({ url, title: 'Junior Software Engineer · Acme' })) } }));
  } });
  const result = await backend.search({ domains: ['Software engineering'], location: 'Morocco', level: 'Graduate', maxAgeDays: 30, includeReview: true, excludedUrls: [urls[0]], includeEmployerSites: true });
  assert.equal(result.jobs.length, 27); assert.equal(modelCalls, 0); assert.equal(backend.rankBatchSize, 1);
  assert.ok(result.jobs.every(job => job.company === 'Acme' && job.description.includes('Python') && job.postedAt === '2 days ago'));
  assert.ok(result.jobs.every(job => job.evidence.includes('Junior Software Engineer') && job.sourceCheckedAt));
});

test('local source parsing excludes generic employer pages and preserves unknown dates for review', async () => {
  const keys = credentialStore(null, {}); keys.save({ brave: 'synthetic-search-key' });
  const backend = createAIBackend(local, keys, { fetchText: async url => ({ url, text: url.includes('linkedin.com') ? '<html><body><h1>Junior Software Engineer</h1><a class="topcard__org-name-link">Acme</a><div class="description__text">Build Python and SQL software APIs with automated tests.</div></body></html>' : '<html><body><h1>Careers</h1><p>Acme</p></body></html>' }), fetcher: async () => new Response(JSON.stringify({ web: { results: [{ title: 'Junior Software Engineer · Acme', url: 'https://www.linkedin.com/jobs/view/9911000001/' }, { title: 'Careers', url: 'https://example.com/careers/' }] } })) });
  const result = await backend.search({ domains: ['Software engineering'], location: 'Morocco', maxAgeDays: 30, includeReview: true, includeEmployerSites: true });
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].discoveryBucket, 'undated-review'); assert.equal(result.jobs[0].postedAt, ''); assert.equal(result.jobs[0].availabilityStatus, 'unconfirmed');
});

test('CPU ranking batches process every eligible job singly while retaining the entire CV', async () => {
  const resume = 'Synthetic junior engineer with Python, SQL and software APIs.', jobs = [1, 2, 3].map(index => ({ id: String(index), title: 'Junior Software Engineer', company: 'Acme', description: 'Build Python and SQL APIs with automated tests.', url: `https://example.com/jobs/${index}`, stage: 'Saved', updatedAt: '2026-10-12' })), calls = [];
  const result = await performAutomatedScan({ settings: { resume, rankBatchSize: 1 }, knownJobs: jobs, search: async () => ({ summary: 'No new sources.', jobs: [] }), research: async () => [], rank: async input => { calls.push(input); return { summary: 'Synthetic rank', rankings: input.jobs.map(job => ({ jobId: job.id, score: 75 })) }; }, saveJob: job => ({ job }), saveCompany: () => {} });
  assert.equal(calls.length, 3); assert.ok(calls.every(input => input.jobs.length === 1 && input.resume === resume));
  assert.equal(result.rankedJobs.length, 3); assert.equal(result.pendingRankings, 0);
});
