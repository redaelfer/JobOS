import test from 'node:test';
import assert from 'node:assert/strict';
import { listLocalModels } from '../lib/local-models.js';
import { diagnoseLocalSetup } from '../lib/doctor.js';
import { searchFailureText, searchRunSource } from '../lib/search-warnings.js';

test('installed model catalog contains only valid downloaded names and bounded display metadata', async () => {
  const result = await listLocalModels({ fetcher: async url => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    return new Response(JSON.stringify({ models: [{ name: 'qwen3:4b', size: 2500000000, details: { parameter_size: '4B' }, private: 'NOT_RETURNED' }, { name: 'model:cloud', size: 1 }, { name: 'https://bad.example/model' }, { name: 'qwen3:8b', size: -1 }] }));
  } });
  assert.deepEqual(result, [{ name: 'qwen3:4b', size: 2500000000, parameters: '4B' }, { name: 'qwen3:8b', size: 0, parameters: '' }]); assert.doesNotMatch(JSON.stringify(result), /NOT_RETURNED/);
});
test('read-only doctor distinguishes saved hosted-search errors from current local tools without leaking private state', async () => {
  const calls = [];
  const checks = await diagnoseLocalSetup({ fetcher: async url => {
    calls.push(url);
    if (url.endsWith('/api/state')) return Response.json({ ai: { provider: 'ollama', searchProvider: 'searxng', searchBaseUrl: 'http://127.0.0.1:8888' }, settings: { resume: 'PRIVATE_CV', token: 'PRIVATE_TOKEN' }, scans: [{ status: 'failed', error: 'Ollama web search: HTTP 429.' }] });
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:4b' }] });
    assert.equal(url, 'http://127.0.0.1:8888/'); return new Response('Ready');
  } });
  assert.ok(checks.every(check => check.ok)); assert.match(checks.at(-1).message, /Hosted Ollama web search.*Local SearXNG/);
  assert.doesNotMatch(JSON.stringify(checks), /PRIVATE_/); assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:') && !/api\/chat|web_search/.test(url)));
});
test('doctor handles absent local services with static recovery steps and no raw exception content', async () => {
  const checks = await diagnoseLocalSetup({ fetcher: async () => { throw new Error('PRIVATE_SYSTEM_DETAIL'); } });
  assert.equal(checks.length, 2); assert.ok(checks.every(check => !check.ok)); assert.match(checks[0].message, /npm start/); assert.match(checks[1].message, /Download model/); assert.doesNotMatch(JSON.stringify(checks), /PRIVATE/);
});
test('legacy failed search lines collapse while source provenance is inferred only from explicit evidence', () => {
  const message = 'Ollama web search: usage/rate limit reached (HTTP 429).';
  const error = `LinkedIn and company careers: ${message}\nIndeed: ${message}`;
  assert.equal(searchFailureText(error).match(/HTTP 429/g).length, 1);
  assert.equal(searchRunSource({ error }), 'ollama'); assert.equal(searchRunSource({ error, searchProvider: 'searxng' }), 'searxng'); assert.equal(searchRunSource({ error: 'Connection failed' }), '');
});
