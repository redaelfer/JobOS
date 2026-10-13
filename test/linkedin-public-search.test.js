import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkedInPublicSearch, parseLinkedInListings } from '../lib/linkedin-public-search.js';
import { createWebSearch } from '../lib/web-search.js';
import { updateAIConfig, credentialStore } from '../lib/ai-config.js';
import { createAIBackend } from '../lib/ai.js';

const card = index => `<li><div class="base-card base-search-card job-search-card"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/junior-developer-at-acme-${1234500000 + index}?trackingId=public"><span>Junior</span></a><h3 class="base-search-card__title">Junior Developer ${index}</h3><h4 class="base-search-card__subtitle">Acme</h4><span class="job-search-card__location">Rabat</span><time datetime="2026-10-12">1 day ago</time></div></li>`;
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html' } });
const noPause = { searchPause: async () => {} };

test('public LinkedIn cards preserve literal employer/title and canonical posting identity', () => {
  const rows = parseLinkedInListings(card(1));
  assert.equal(rows.length, 1); assert.equal(rows[0].url, 'https://www.linkedin.com/jobs/view/1234500001/');
  assert.equal(rows[0].title, 'Junior Developer 1 · Acme'); assert.match(rows[0].content, /Rabat/);
  assert.equal(parseLinkedInListings('').length, 0);
  assert.throws(() => parseLinkedInListings('<form id="authwall">PRIVATE BODY</form>'), error => error.code === 'PUBLIC_SEARCH_BLOCKED' && !error.message.includes('PRIVATE'));
  assert.throws(() => parseLinkedInListings('<form>PRIVATE unexpected page</form>'), /unreadable/);
});

test('public LinkedIn reads more than 25 postings, applies the selected window and avoids credentials', async () => {
  const calls = [];
  const source = createLinkedInPublicSearch({ ...noPause, fetcher: async (url, options) => {
    calls.push({ url: new URL(url), options });
    const start = Number(new URL(url).searchParams.get('start'));
    return html(start === 0 ? Array.from({ length: 25 }, (_, i) => card(i)).join('') : start === 25 ? card(0) + Array.from({ length: 10 }, (_, i) => card(i + 25)).join('') : '');
  } });
  const found = await source.query('Software engineering Morocco Maroc junior graduate site:linkedin.com/jobs/view', 30);
  assert.equal(found.rows.length, 35); assert.equal(calls.length, 3);
  assert.equal(calls[0].url.searchParams.get('location'), 'Morocco'); assert.equal(calls[0].url.searchParams.get('f_TPR'), 'r2592000');
  assert.equal(calls[0].url.searchParams.get('sortBy'), 'DD');
  for (const call of calls) { assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, undefined); assert.equal(call.options.headers.Cookie, undefined); assert.match(call.url.searchParams.get('keywords'), /Software engineering/); }
});

test('remote listing searches require remote arrangements without inventing Morocco eligibility', async () => {
  let queried;
  const source = createLinkedInPublicSearch({ ...noPause, fetcher: async url => { queried = new URL(url); return html(card(1)); } });
  const result = await source.query('Software remote Morocco worldwide EMEA site:linkedin.com/jobs/view', undefined, { firstPageOnly: true });
  assert.equal(result.rows.length, 1); assert.equal(queried.searchParams.get('f_WT'), '2'); assert.equal(queried.searchParams.get('location'), 'Worldwide'); assert.equal(queried.searchParams.has('f_TPR'), false);
  assert.equal(result.rows[0].eligibility, undefined);
});

test('LinkedIn blocks stop requests to that source while literal partial records are retained', async () => {
  let calls = 0;
  const source = createLinkedInPublicSearch({ ...noPause, fetcher: async () => ++calls === 1 ? html(card(1)) : new Response('PRIVATE BODY', { status: 429 }) });
  const result = await source.query('Software Morocco site:linkedin.com/jobs/view', 30);
  assert.equal(result.rows.length, 1); assert.match(result.warnings[0], /HTTP 429/);
  await assert.rejects(source.query('Data Morocco site:linkedin.com/jobs/view'), /HTTP 429/); assert.equal(calls, 2);
});

test('a generic public listing probe makes one request with no model call or saved CV', async () => {
  const config = updateAIConfig({}, { provider: 'ollama', searchProvider: 'linkedin' }), calls = [];
  const backend = createAIBackend(config, credentialStore(null, {}), { ...noPause, fetcher: async (url, options) => { calls.push({ url, options }); return html(card(1)); } });
  const result = await backend.testSearch();
  assert.equal(result.ready, true); assert.match(result.message, /Employer\/contact web searches are separate/);
  assert.equal(calls.length, 1); assert.equal(new URL(calls[0].url).hostname, 'www.linkedin.com'); assert.equal(calls[0].options.body, undefined);
});

test('LinkedIn discovery and employer web searches use explicitly different public sources', async () => {
  const config = updateAIConfig({}, { provider: 'ollama', searchProvider: 'linkedin' });
  const calls = [], web = createWebSearch(config, credentialStore(null, {}), { ...noPause, fetcher: async url => { calls.push(new URL(url).hostname); return url.includes('linkedin.com') ? html(card(1)) : html('<div class="anomaly-modal">Challenge</div>'); } });
  await assert.rejects(web.query('Acme recrutement careers contact'), /blocked/);
  assert.equal((await web.query('Software Morocco site:linkedin.com/jobs/view', 30, { probe: true })).length, 1);
  await assert.rejects(web.query('Acme talent acquisition'), /blocked/);
  assert.deepEqual(calls, ['html.duckduckgo.com', 'www.linkedin.com']);
});
