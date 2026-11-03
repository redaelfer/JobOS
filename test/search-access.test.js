import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearch } from '../lib/web-search.js';
import { credentialStore } from '../lib/ai-config.js';

for (const status of [401, 403, 429]) test(`search API HTTP ${status} is cached across discovery and employer queries without retrying`, async () => {
  let calls = 0;
  const web = createWebSearch({ searchProvider: 'ollama' }, credentialStore(null, { OLLAMA_API_KEY: 'PRIVATE_TEST_KEY' }), {
    fetcher: async () => { calls++; return new Response('PRIVATE_PROVIDER_BODY', { status }); }
  });
  const blocked = error => error.code === 'SEARCH_SOURCE_BLOCKED' && error.message.includes(`HTTP ${status}`) && !/PRIVATE/.test(error.message);
  await assert.rejects(web.query('Software Morocco site:linkedin.com/jobs/view', 30), blocked);
  await assert.rejects(web.query('Example employer careers recruitment contact'), blocked);
  assert.equal(calls, 1);
});
