import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicSearch, parsePublicSearch } from '../lib/public-search.js';
import { createWebSearch } from '../lib/web-search.js';
import { updateAIConfig, credentialStore } from '../lib/ai-config.js';
import { createAIBackend } from '../lib/ai.js';

const result = (index, href = `https://example.com/jobs/${index}`) => `<div class="result"><a class="result__a" href="${href}">Engineer ${index}</a><div class="result__snippet">Public source snippet ${index}</div></div>`;
const next = offset => `<form action="/html/" method="post"><input type="submit" value="Next"><input type="hidden" name="q" value="Untrusted replacement query"><input type="hidden" name="s" value="${offset}"><input type="hidden" name="vqd" value="public-page-token"><input type="hidden" name="evil" value="ignored"></form>`;
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const noPause = { searchPause: async () => {} };

test('public search reads literal source links and snippets, unwraps redirects and rejects unsafe URLs', () => {
  const wrapped = '//duckduckgo.com/l/?uddg=' + encodeURIComponent('https://www.linkedin.com/jobs/view/1234567890/');
  const page = parsePublicSearch(result(1, wrapped) + result(2, 'javascript:alert(1)') + result(3, 'http://example.com') + result(4, 'https://127.0.0.1/') + next(10), 'Public employer roles');
  assert.equal(page.rows.length, 1); assert.equal(page.rows[0].url, 'https://www.linkedin.com/jobs/view/1234567890/');
  assert.equal(page.rows[0].content, 'Public source snippet 1');
  assert.equal(page.next.get('q'), 'Public employer roles'); assert.equal(page.next.has('evil'), false);
  assert.equal(parsePublicSearch('<div class="no-results">No results found</div>', 'No public matches').rows.length, 0);
  assert.equal(parsePublicSearch(result(1) + '<form action="https://evil.test/html/"><input type="submit" value="Next"><input type="hidden" name="s" value="10"></form>', 'Public query').next, null);
});

test('public search paginates beyond 25 results, deduplicates, preserves the query and uses no keys', async () => {
  const calls = [], sleeps = [], publicQuery = 'junior software Morocco site:linkedin.com/jobs/view';
  const search = createPublicSearch({ searchPause: async delay => sleeps.push(delay), fetcher: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return html(Array.from({ length: 20 }, (_, i) => result(i)).join('') + next(20));
    return html(result(0) + Array.from({ length: 12 }, (_, i) => result(i + 20)).join(''));
  } });
  const found = await search.query(publicQuery, 30);
  assert.equal(found.rows.length, 32); assert.equal(found.warnings.length, 0); assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('df'), 'm');
  assert.equal(calls[1].options.method, 'POST'); assert.equal(new URLSearchParams(calls[1].options.body).get('q'), publicQuery);
  assert.equal(new URLSearchParams(calls[1].options.body).has('evil'), false);
  assert.ok(sleeps.length > 0);
  for (const call of calls) { assert.equal(new URL(call.url).hostname, 'html.duckduckgo.com'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, undefined); assert.equal(call.options.headers['x-goog-api-key'], undefined); }
});

test('public search stops on challenges and blocked access without leaking bodies or attempting bypasses', async () => {
  for (const response of [html('<div class="anomaly-modal">PRIVATE PROVIDER BODY</div>'), new Response('PRIVATE PROVIDER BODY', { status: 429 }), html('PRIVATE PROVIDER BODY'), new Response('PRIVATE PROVIDER BODY', { headers: { 'Content-Type': 'application/json' } })]) {
    let calls = 0;
    const search = createPublicSearch({ ...noPause, fetcher: async () => { calls++; return response; } });
    await assert.rejects(search.query('Public roles'), error => error.code === 'PUBLIC_SEARCH_BLOCKED' && !error.message.includes('PRIVATE'));
    await assert.rejects(search.query('Another public domain'), error => error.code === 'PUBLIC_SEARCH_BLOCKED');
    assert.equal(calls, 1);
  }
});

test('readable partial results survive a later block and subsequent queries do not request again', async () => {
  let calls = 0;
  const search = createPublicSearch({ ...noPause, fetcher: async () => ++calls === 1 ? html(result(1) + next(10)) : html('<div class="anomaly-modal">Blocked</div>') });
  const found = await search.query('Public roles');
  assert.equal(found.rows.length, 1); assert.match(found.warnings[0], /blocked/);
  await assert.rejects(search.query('Another domain'), /blocked/); assert.equal(calls, 2);
});

test('public pagination ends on repeated results and reports a time budget without dropping sources', async () => {
  let calls = 0;
  const repeated = createPublicSearch({ ...noPause, fetcher: async () => { calls++; return html(result(1) + next(10)); } });
  assert.equal((await repeated.query('Public roles')).rows.length, 1); assert.equal(calls, 2);
  let now = 0;
  const budget = createPublicSearch({ ...noPause, searchNow: () => now, publicQueryBudgetMs: 10, fetcher: async () => { now = 20; return html(result(1) + next(10)); } });
  const found = await budget.query('Public roles'); assert.equal(found.rows.length, 1); assert.match(found.warnings[0], /coverage is incomplete/);
});

test('the public search adapter needs no credentials and model/search probes remain separate', async () => {
  const config = updateAIConfig({}, { provider: 'ollama', searchProvider: 'public' }), calls = [];
  const web = createWebSearch(config, { get: () => { throw new Error('No credentials should be read'); } }, { ...noPause, fetcher: async (url, options) => { calls.push({ url, options }); return html(result(1, 'https://nodejs.org/en/docs/')); } });
  web.ready(); assert.equal((await web.test()).ready, true); assert.equal(calls.length, 1);
  assert.match(new URL(calls[0].url).searchParams.get('q'), /Node.js official documentation/);
  const backend = createAIBackend(config, credentialStore(null, {}), { ...noPause, fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/tags')) return new Response('{"models":[{"name":"qwen3:4b"}]}');
    if (url.endsWith('/api/chat')) return new Response('{"done":true,"message":{"content":"{\\"ok\\":true}"}}');
    return html(result(1, 'https://nodejs.org/en/docs/'));
  } });
  assert.equal((await backend.status('search', true)).ready, true);
  assert.equal((await backend.testSearch()).ready, true);
  assert.ok(calls.every(call => ['127.0.0.1', 'html.duckduckgo.com'].includes(new URL(call.url).hostname)));
});

test('a public search challenge stops all discovery passes after one request without local generation', async () => {
  let calls = 0;
  const config = updateAIConfig({}, { provider: 'ollama', searchProvider: 'public' });
  const backend = createAIBackend(config, credentialStore(null, {}), { ...noPause, fetcher: async () => { calls++; return html('<div class="anomaly-modal">Blocked</div>'); } });
  await assert.rejects(backend.search({ domains: ['Software', 'Data'], location: 'Morocco and remote', level: 'Graduate', includeEmployerSites: true, includeReview: true, maxAgeDays: 30 }), /blocked/);
  assert.equal(calls, 1);
});
