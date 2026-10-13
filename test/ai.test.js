import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialStore, publicAI, updateAIConfig, validateBaseUrl } from '../lib/ai-config.js';
import { createModelClient, parseModelJSON, requestJSON } from '../lib/ai-client.js';
import { createAIBackend } from '../lib/ai.js';
import { createWebSearch, searchQueries } from '../lib/web-search.js';
import { checkDiscoverySources } from '../lib/discovery.js';
import { latexTextSlots } from '../lib/latex-template.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
const configFor = (provider, extra = {}) => updateAIConfig({}, { provider, ...(provider === 'compatible' ? { model: 'synthetic-model' } : {}), ...extra });
const keys = () => { const store = credentialStore(null, {}); store.save({ gemini: 'synthetic-gemini-key', kimi: 'synthetic-kimi-key', compatible: 'synthetic-compatible-key', brave: 'synthetic-search-key', ollamaSearch: 'synthetic-web-key' }); return store; };

test('AI profiles preserve model choices, reject unsafe endpoints/models and keep Codex as the default', () => {
  const credentials = keys(); assert.equal(publicAI({}, credentials).provider, 'codex');
  let config = configFor('ollama', { model: 'qwen3:8b', contextTokens: 65536 });
  config = updateAIConfig(config, { provider: 'gemini' }); config = updateAIConfig(config, { provider: 'ollama' });
  assert.equal(config.profiles.ollama.model, 'qwen3:8b'); assert.equal(config.contextTokens, 65536);
  for (const provider of ['unknown', '__proto__', 'constructor']) assert.throws(() => configFor(provider));
  for (const model of ['../secret', 'a; echo secret', 'https://example.com/model', 'qwen3:4b-cloud']) assert.throws(() => configFor('ollama', { model }));
  for (const address of ['http://192.168.1.1:11434', 'https://user:pass@example.com', 'http://localhost:4317', 'https://example.com?key=secret', 'http://example.com/v1']) assert.throws(() => validateBaseUrl(address, 'ollama'));
  assert.equal(validateBaseUrl('http://127.0.0.1:1234/v1', 'compatible'), 'http://127.0.0.1:1234/v1');
  assert.throws(() => configFor('ollama', { contextTokens: 1024 }));
});

test('API keys persist privately, never appear in public config and can be cleared without erasing environment keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobos-ai-keys-')), path = join(dir, 'credentials.json');
  try {
    const store = credentialStore(path, { GEMINI_API_KEY: 'environment-marker' });
    store.save({ gemini: 'saved-marker' }); assert.equal(store.get('gemini'), 'saved-marker');
    assert.equal(JSON.stringify(publicAI({}, store)).includes('saved-marker'), false);
    assert.equal(JSON.stringify(publicAI({}, store)).includes('environment-marker'), false);
    const reopened = credentialStore(path, {}); assert.equal(reopened.get('gemini'), 'saved-marker');
    reopened.save({ gemini: '' }); assert.equal(reopened.get('gemini'), 'saved-marker');
    store.save({}, ['gemini']); assert.equal(store.get('gemini'), 'environment-marker');
    assert.equal((await readFile(path, 'utf8')).includes('saved-marker'), false);
    assert.throws(() => store.save({ other: 'bad' })); assert.throws(() => store.save({ gemini: 'bad\nheader' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const provider of ['ollama', 'gemini', 'kimi', 'compatible']) test(`${provider} uses its own endpoint and structured format without invoking Codex`, async () => {
  const config = configFor(provider), calls = [];
  const client = createModelClient(config, keys(), async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    if (provider === 'ollama') return response({ done: true, done_reason: 'stop', message: { content: '{"ok":true}' } });
    if (provider === 'gemini') {
      // The REST TextResponseFormat field is an enum, not a MIME string.
      // Reject the original HTTP-400 payload before simulating model generation.
      if (body.generationConfig.responseFormat.text.mimeType !== 'APPLICATION_JSON') return response({ error: { status: 'INVALID_ARGUMENT' } }, 400);
      return response({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }] });
    }
    return response({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  });
  assert.deepEqual(await client.generate('Synthetic check, no CV.', schema), { ok: true });
  assert.equal(calls.length, 1); const call = calls[0];
  assert.equal(call.options.redirect, 'error');
  if (provider === 'ollama') { assert.equal(call.url, 'http://127.0.0.1:11434/api/chat'); assert.equal(call.body.options.num_ctx, 32768); assert.equal(call.body.think, false); assert.deepEqual(call.body.format, schema); }
  if (provider === 'gemini') { assert.match(call.url, /generativelanguage\.googleapis\.com/); assert.equal(call.options.headers['x-goog-api-key'], 'synthetic-gemini-key'); assert.equal(call.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON'); assert.deepEqual(call.body.generationConfig.responseFormat.text.schema, schema); }
  if (provider === 'kimi') { assert.match(call.url, /^https:\/\/api\.moonshot\.ai\/v1\/chat\/completions$/); assert.deepEqual(call.body.thinking, { type: 'disabled' }); }
  if (provider === 'compatible') assert.match(call.url, /127\.0\.0\.1:1234\/v1\/chat\/completions/);
});

test('provider failures and truncated/malformed responses are actionable and do not expose provider bodies', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) await assert.rejects(requestJSON('https://example.com', { fetcher: async () => response({ error: 'PRIVATE CV AND SECRET' }, status) }), error => error.message.includes(`HTTP ${status}`) && !/PRIVATE|SECRET/.test(error.message) && (status < 500 || /temporarily unavailable/.test(error.message)));
  assert.throws(() => parseModelJSON('{"ok":"true"}', schema)); assert.throws(() => parseModelJSON('{"ok":true,"unknown":1}', schema)); assert.throws(() => parseModelJSON('explanation {"ok":true}', schema));
  assert.deepEqual(parseModelJSON('```json\n{"ok":true}\n```', schema), { ok: true });
  const client = createModelClient(configFor('compatible'), keys(), async () => response({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }));
  await assert.rejects(client.generate('Test.', schema), /did not finish/);
});

test('local context checks reject oversized input before sending it rather than silently truncating it', async () => {
  let called = false;
  const client = createModelClient(configFor('ollama', { contextTokens: 8192 }), keys(), async () => { called = true; return response({}); });
  await assert.rejects(client.generate('x'.repeat(20000), schema), /input was not truncated/);
  assert.equal(called, false);
});

test('local ranking needs no web key, validates every job and uses CV data only in the model body', async () => {
  const config = configFor('ollama'), calls = [], job = { id: 'one', title: 'Engineer', company: 'Acme', description: 'Python software. Recruitment: jobs@example.com', url: 'https://example.com/job/1' };
  const backend = createAIBackend(config, credentialStore(null, {}), { fetcher: async (url, options) => {
    calls.push({ url, body: options?.body });
    if (url.endsWith('/api/tags')) return response({ models: [{ name: 'qwen3:4b' }] });
    return response({ done: true, message: { content: JSON.stringify({ summary: 'Synthetic comparison', rankings: [{ jobId: 'one', score: 80, fit: 'Skills overlap.', strengths: ['Python'], gaps: ['SQL'], nextStep: 'Review.', contacts: [] }] }) } });
  } });
  assert.equal((await backend.status('rank')).ready, true);
  assert.equal((await backend.status('search')).ready, false);
  const result = await backend.rank({ resume: 'PRIVATE synthetic candidate facts.', jobs: [job] });
  assert.equal(result.rankings[0].score, 80); assert.equal(result.rankings[0].contacts[0].email, 'jobs@example.com');
  assert.ok(calls.filter(call => call.body).every(call => call.url === 'http://127.0.0.1:11434/api/chat'));
  assert.ok(calls.every(call => !call.url.includes('PRIVATE')));
});

test('API tailoring applies text slots to the exact master and rejects template redesigns', async () => {
  const source = '\\documentclass{article}\n\\usepackage{xcolor}\n\\begin{document}\n\\section*{Experience}\nBuilt Python software.\n\\end{document}\n';
  const slot = latexTextSlots(source).find(slot => slot.text.includes('Built Python'));
  let replacements = [{ id: slot.id, text: 'Built reliable Python software.' }];
  const backend = createAIBackend(configFor('compatible'), keys(), { fetcher: async () => response({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ replacements, email: { subject: 'Application', body: 'I built Python software.' }, changes: ['Text emphasis.'], questions: [] }) } }] }) });
  const input = { source, resume: 'Synthetic Python engineer.', job: { title: 'Engineer', company: 'Acme', description: 'Python software development.' }, language: 'English' };
  const result = await backend.tailor(input);
  assert.equal(result.latex, source.replace('Built Python software.', 'Built reliable Python software.'));
  assert.equal(source.includes('reliable'), false);
  replacements = [{ id: slot.id, text: '\\usepackage{geometry}' }];
  await assert.rejects(backend.tailor(input));
});

test('Brave pagination collects all pages; public queries contain only supplied professional preferences', async () => {
  const queries = searchQueries({ domains: ['Data engineering', 'Backend development'], location: 'Morocco and remote roles', level: 'Graduate / Entry level', includeEmployerSites: true, resume: 'PRIVATE CV TOKEN' });
  assert.ok(queries.some(query => query.includes('Data engineering'))); assert.ok(queries.some(query => query.includes('Backend development'))); assert.ok(queries.some(query => query.includes('remote'))); assert.ok(queries.some(query => query.includes('Maroc')));
  assert.ok(queries.every(query => !query.includes('PRIVATE')));
  const offsets = [];
  const web = createWebSearch(configFor('ollama', { searchProvider: 'brave' }), keys(), { fetcher: async url => { const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset); return response({ query: { more_results_available: offset < 2 }, web: { results: Array.from({ length: 20 }, (_, i) => ({ title: 'Engineer', url: `https://example.com/jobs/${offset * 20 + i}`, description: 'Public software role.' })) } }); } });
  assert.equal((await web.query('Software engineering Morocco')).length, 60); assert.deepEqual(offsets, [0, 1, 2]);
});

test('Gemini search requires current grounding evidence and retains its search suggestions safely', async () => {
  let grounded = false;
  const web = createWebSearch(configFor('gemini', { searchProvider: 'gemini' }), keys(), { fetcher: async () => response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ results: [{ title: 'Role', url: 'https://example.com/job/1', content: 'Source excerpt.' }] }) }] }, groundingMetadata: grounded ? { groundingChunks: [{ web: { uri: 'https://example.com/job/1' } }], searchEntryPoint: { renderedContent: '<a href="https://google.com/search?q=software">Search</a>' } } : {} }] }) });
  await assert.rejects(web.query('Engineer Morocco'), /no live search evidence/);
  grounded = true; assert.equal((await web.query('Engineer Morocco')).length, 1); assert.equal(web.suggestions.length, 1);
});

test('non-Codex discovery is uncapped, checks source dates, deduplicates and rejects invented/deleted URLs', async () => {
  const config = configFor('compatible', { searchProvider: 'brave' }), urls = Array.from({ length: 26 }, (_, i) => `https://www.linkedin.com/jobs/view/${80000 + i}/`), fetched = [];
  const fetchText = async url => { fetched.push(url); return { url, text: '<html><body><h1>Junior Software Engineer</h1><p>Acme</p><span class="posted-time-ago__text">2 days ago</span><div class="description__text">Build software services using Python and SQL in a product team.</div></body></html>' }; };
  const backend = createAIBackend(config, keys(), { fetchText, checkSources: result => checkDiscoverySources(result, fetchText), fetcher: async (url, options) => {
    if (url.startsWith('https://api.search.brave.com')) { const offset = Number(new URL(url).searchParams.get('offset')); return response({ query: { more_results_available: offset === 0 }, web: { results: urls.slice(offset * 20, offset * 20 + 20).map(url => ({ url, title: 'Junior Software Engineer at Acme', description: 'Acme is hiring a software engineer.' })) } }); }
    const prompt = JSON.parse(options.body).messages[0].content, pages = JSON.parse(prompt.split('LIVE SOURCES:\n')[1]);
    const job = url => ({ title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', url, description: '', evidence: 'Acme is hiring a software engineer.', postedAt: '1 minute ago' });
    return response({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Synthetic results', jobs: [...pages.map(page => job(page.url)), job('https://www.linkedin.com/jobs/view/999999999/')] }) } }] });
  } });
  const result = await backend.search({ domains: ['Software engineering'], location: 'Morocco and remote roles', level: 'Graduate / Entry level', maxAgeDays: 30, includeReview: true, includeEmployerSites: true, excludedUrls: [urls[0]] });
  assert.equal(result.jobs.length, 25); assert.equal(new Set(result.jobs.map(job => job.url)).size, 25);
  assert.ok(result.jobs.every(job => job.postedAt === '2 days ago' && job.description.includes('Python') && job.source === 'AI LinkedIn search'));
  assert.equal(fetched.includes(urls[0]), false); assert.equal(result.jobs.some(job => job.url.includes('999999999')), false);
});

test('an exhausted provider stops the scan without silently retrying Codex or repeating billable model requests', async () => {
  let modelCalls = 0;
  const backend = createAIBackend(configFor('compatible', { searchProvider: 'brave' }), keys(), { fetchText: async url => ({ url, text: '<html><body>Acme Junior Software Engineer software description</body></html>' }), fetcher: async url => {
    if (url.startsWith('https://api.search.brave.com')) return response({ web: { results: [{ title: 'Engineer', url: 'https://www.linkedin.com/jobs/view/88/', description: 'Public role.' }] } });
    modelCalls++; return response({ error: 'PRIVATE quota details' }, 429);
  } });
  await assert.rejects(backend.search({ domains: ['Software engineering'], location: 'Morocco', maxAgeDays: 30, includeReview: true }), /HTTP 429/);
  assert.equal(modelCalls, 1);
});

for (const status of [400, 404, 429, 503]) test(`search stops after one HTTP ${status} instead of repeating requests across domains and passes`, async () => {
  let calls = 0;
  const backend = createAIBackend(configFor('gemini', { searchProvider: 'gemini', searchModel: 'gemini-2.5-flash' }), keys(), { fetcher: async url => {
    calls++;
    assert.match(url, /gemini-2\.5-flash:generateContent$/);
    return response({ error: 'PRIVATE KEY AND CV' }, status);
  } });
  await assert.rejects(backend.search({ domains: ['Software engineering', 'Backend development', 'Data engineering'], location: 'Morocco and remote roles', includeReview: true, includeEmployerSites: true, maxAgeDays: 30 }), error => error.message.includes(`HTTP ${status}`) && !/PRIVATE/.test(error.message));
  assert.equal(calls, 1);
});
