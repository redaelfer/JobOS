import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiConfig, updateAIConfig, credentialStore, publicAI, validateLocalSearchUrl } from '../lib/ai-config.js';
import { createModelClient } from '../lib/ai-client.js';
import { createWebSearch } from '../lib/web-search.js';
import { createSearxngSearch } from '../lib/searxng-search.js';
import { setupLocalSearch } from '../lib/local-search.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
test('new workspaces use downloaded Ollama and key-free search while explicit existing choices persist', () => {
  const config = aiConfig(); assert.equal(config.provider, 'ollama'); assert.equal(config.searchProvider, 'linkedin');
  assert.equal(config.profiles.ollama.baseUrl, 'http://127.0.0.1:11434');
  const saved = { provider: 'gemini', searchProvider: 'ollama', profiles: { gemini: { model: 'saved-model' } } };
  const restored = aiConfig(saved); assert.equal(restored.provider, 'gemini'); assert.equal(restored.searchProvider, 'ollama'); assert.equal(restored.profiles.gemini.model, 'saved-model');
  const switched = updateAIConfig(restored, { provider: 'ollama', searchProvider: 'searxng' });
  assert.equal(switched.profiles.gemini.model, 'saved-model');
});
for (const provider of ['groq', 'openrouter']) test(`${provider} uses its own app-saved key, endpoint and model without Codex or search calls`, async () => {
  const keys = credentialStore(null, {}); keys.save({ [provider]: 'PRIVATE_KEY' });
  const config = updateAIConfig({}, { provider });
  let calls = 0;
  const client = createModelClient(config, keys, async (url, options) => {
    calls++; assert.ok(url.startsWith(provider === 'groq' ? 'https://api.groq.com/openai/v1/' : 'https://openrouter.ai/api/v1/'));
    assert.equal(options.headers.Authorization, 'Bearer PRIVATE_KEY'); assert.equal(options.redirect, 'error');
    if (url.endsWith('/models')) return json({ data: [{ id: 'paid-model' }, { id: 'vendor/model:free' }, { id: 'openrouter/free' }] });
    const body = JSON.parse(options.body); assert.equal(body.model, config.profiles[provider].model); assert.equal(body.models, undefined);
    return json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  });
  assert.deepEqual(await client.generate('Tiny synthetic prompt', schema), { ok: true });
  const models = await client.models(); assert.equal(calls, 2);
  if (provider === 'openrouter') assert.deepEqual(models, ['vendor/model:free', 'openrouter/free']);
  assert.doesNotMatch(JSON.stringify(publicAI(config, keys)), /PRIVATE_KEY/);
  const missing = createModelClient(config, credentialStore(null, {}), async () => assert.fail('No request without a key'));
  await assert.rejects(missing.generate('Test', schema), /API key/); await assert.rejects(missing.models(), /API key/);
});
test('OpenRouter rejects paid-model selection and hosted presets cannot redirect keys to another server', () => {
  assert.throws(() => updateAIConfig({}, { provider: 'openrouter', model: 'vendor/paid' }), /Paid models are disabled/);
  for (const provider of ['groq', 'openrouter']) assert.notEqual(updateAIConfig({}, { provider, baseUrl: 'https://attacker.example/v1' }).profiles[provider].baseUrl, 'https://attacker.example/v1');
});
test('local search URLs reject remote targets, credentials, paths and the JobOS server', () => {
  for (const url of ['https://external.example', 'http://127.0.0.1:4317', 'http://user:pass@localhost:8888', 'http://127.0.0.1:8888/path', 'file:///tmp/a', 'http://localhost']) assert.throws(() => validateLocalSearchUrl(url));
  assert.equal(validateLocalSearchUrl('http://127.0.0.1:8888/'), 'http://127.0.0.1:8888');
});
test('local SearXNG paginates without a result quota, rejects private links and caches upstream failure', async () => {
  let calls = 0;
  const engine = createSearxngSearch('http://127.0.0.1:8888', { searchPause: async () => {}, fetcher: async url => {
    calls++; const query = new URL(url); assert.equal(query.origin, 'http://127.0.0.1:8888'); assert.equal(query.searchParams.get('time_range'), 'month');
    const page = Number(query.searchParams.get('pageno'));
    if (page > 3) return json({ results: [], unresponsive_engines: [['upstream', 'private error']] });
    return json({ results: [{ title: 'Private', url: 'http://127.0.0.1:4317' }, ...Array.from({ length: 10 }, (_, i) => ({ title: 'Software role', url: `https://example.com/jobs/${page * 10 + i}`, content: 'Public excerpt.' }))] });
  } });
  const result = await engine.query('Software Morocco', 30); assert.equal(result.rows.length, 30); assert.equal(calls, 4); assert.match(result.warnings[0], /upstream search engines/);
  await assert.rejects(engine.query('Employer recruiting contact', 30), error => error.code === 'SEARCH_SOURCE_BLOCKED'); assert.equal(calls, 4);
  assert.doesNotMatch(JSON.stringify(result), /private error/);
});
test('Tavily uses the app key and basic search without CV input, and caches quota errors across queries', async () => {
  const keys = credentialStore(null, {}); keys.save({ tavily: 'PRIVATE_TAVILY_KEY' }); let calls = 0;
  const web = createWebSearch(updateAIConfig({}, { searchProvider: 'tavily' }), keys, { fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://api.tavily.com/search'); assert.equal(options.headers.Authorization, 'Bearer PRIVATE_TAVILY_KEY');
    const body = JSON.parse(options.body); assert.equal(body.search_depth, 'basic'); assert.equal(body.auto_parameters, false); assert.equal(body.query, 'Public software jobs');
    assert.equal(body.time_range, 'month'); assert.equal(body.include_raw_content, false);
    return calls === 1 ? json({ results: [{ title: 'Role', url: 'https://example.com/job/1', content: 'Public offer.' }] }) : json({ error: 'PRIVATE_BODY' }, 429);
  } });
  assert.equal((await web.query('Public software jobs', 30)).length, 1);
  await assert.rejects(web.query('Public software jobs', 30), /HTTP 429/);
  await assert.rejects(web.query('Company HR'), /HTTP 429/); assert.equal(calls, 2);
});
test('a local metasearch probe reports usable partial results with explicit upstream warnings', async () => {
  const web = createWebSearch(updateAIConfig({}, { searchProvider: 'searxng' }), credentialStore(null, {}), { fetcher: async () => json({ results: [{ title: 'Node.js', url: 'https://nodejs.org/', content: 'Documentation' }], unresponsive_engines: [['example', 'PRIVATE_DIAGNOSTIC']] }) });
  const result = await web.test(); assert.equal(result.ready, true); assert.match(result.message, /Limited coverage/); assert.equal(result.warnings.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('local search installer binds loopback only, mounts isolated search folders and starts an identified official image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobos-local-search-')), calls = [];
  try {
    await setupLocalSearch(() => {}, { root, pause: async () => {}, fetcher: async () => new Response('Ready'), command: async args => {
      calls.push(args);
      if (args[0] === 'inspect') throw new Error('Not installed');
      if (args[0] === 'image') return JSON.stringify([{ Id: 'sha256:' + 'a'.repeat(64) }]);
      return 'ok';
    } });
    const run = calls.find(args => args[0] === 'run'); assert.ok(run.includes('127.0.0.1:8888:8080')); assert.equal(run.at(-1), 'sha256:' + 'a'.repeat(64));
    assert.equal(run.includes('--privileged'), false); assert.equal(run.includes('--network'), false);
    assert.ok(run.includes(`type=bind,source=${join(root, 'config')},target=/etc/searxng`));
    assert.match(await readFile(join(root, 'config/settings.yml'), 'utf8'), /- json/);
    assert.ok(calls.find(args => args[0] === 'pull').includes('docker.io/searxng/searxng:latest'));
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'jobos-local-search-'))); await rm(root, { recursive: true, force: true }); }
});
test('local search installer preserves unowned containers and gives a safe Docker-start instruction', async () => {
  const calls = [];
  await assert.rejects(setupLocalSearch(() => {}, { command: async args => { calls.push(args); return args[0] === 'inspect' ? JSON.stringify([{ Config: { Labels: {} } }]) : 'ok'; } }), /not the expected private/);
  assert.equal(calls.some(args => ['start', 'run', 'pull', 'rm'].includes(args[0])), false);
  await assert.rejects(setupLocalSearch(() => {}, { command: async () => { throw new Error('PRIVATE_CONFIG'); } }), error => /Start Docker Desktop/.test(error.message) && !/PRIVATE/.test(error.message));
});
