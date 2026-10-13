import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { searchPreferences, validateDiscovery, discoveryPrompt, checkDiscoverySources, hydrateSavedJobs } from '../lib/discovery.js';
import { searchWithCodex } from '../lib/codex.js';
const prefs = searchPreferences({ domains: 'AI engineering, Data engineering', location: 'Morocco', limit: 5 });
const job = () => ({ title: 'Data Engineer', company: 'Acme', location: 'Rabat', url: 'https://www.linkedin.com/jobs/view/data-engineer-456/?trk=search', description: 'Build data pipelines with Python, SQL and Spark.', evidence: 'Acme is hiring a Data Engineer in Rabat.', postedAt: '2 days ago' });
test('domain preferences validate domains and posting windows without a result quota', () => {
  assert.deepEqual(prefs.domains, ['AI engineering', 'Data engineering']);
  assert.equal(searchPreferences({ domains: 'AI engineering', limit: 20 }).maxAgeDays, 30);
  assert.equal('limit' in prefs, false);
  for (const input of [{ domains: '' }, { domains: 'A', maxAgeDays: 31 }, { domains: Array(9).fill('AI').join(',') }]) assert.throws(() => searchPreferences(input));
});
test('discovery requires real direct LinkedIn URLs and source evidence, then deduplicates', () => {
  const result = validateDiscovery({ summary: 'Results', jobs: [job(), job()] }, prefs); assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].url, 'https://www.linkedin.com/jobs/view/456/');
  for (const url of ['https://linkedin.com.evil.test/jobs/view/456/', 'https://www.linkedin.com/jobs/search/?currentJobId=456', 'https://example.com/jobs/view/456/', 'http://linkedin.com/jobs/view/456/']) assert.throws(() => validateDiscovery({ summary: 'Results', jobs: [{ ...job(), url }] }, prefs));
  assert.throws(() => validateDiscovery({ summary: 'Results', jobs: [{ ...job(), evidence: '' }] }, prefs));
  assert.equal(validateDiscovery({ summary: 'No reliable jobs found', jobs: [] }, prefs).jobs.length, 0);
});
test('unreadable pages clear unsupported descriptions and closed postings are labeled', async () => {
  let result = validateDiscovery({ summary: 'Results', jobs: [job()] }, prefs);
  result = await checkDiscoverySources(result, async () => { throw new Error('Login required'); }); assert.equal(result.jobs[0].description, ''); assert.match(result.jobs[0].verification, /review/);
  result = await checkDiscoverySources(validateDiscovery({ summary: 'Results', jobs: [job()] }, prefs), async () => ({ text: '<h1>Data Engineer</h1><p>Acme</p><p>Build data pipelines with Python, SQL and Spark.</p>', url: job().url }));
  assert.match(result.jobs[0].verification, /found on public posting/); assert.ok(result.jobs[0].description);
  result = await checkDiscoverySources(validateDiscovery({ summary: 'Results', jobs: [job()] }, prefs), async () => ({ text: 'Acme Data Engineer No longer accepting applications', url: job().url })); assert.match(result.jobs[0].verification, /closed/);
});
test('search runs Codex with live web search and no CV input', async () => {
  const runner = async (args, opts) => { assert.ok(args.includes('web_search="live"')); assert.ok(args.includes('shell_tool')); assert.match(opts.stdin, /site:linkedin.com\/jobs\/view/); assert.ok(!opts.stdin.includes('resume":')); await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'One role found', jobs: [job()] })); return { code: 0 }; };
  const result = await searchWithCodex(prefs, runner, async result => result); assert.equal(result.jobs.length, 1);
  await assert.rejects(searchWithCodex(prefs, async () => ({ code: 1 })), /could not finish/);
  assert.match(discoveryPrompt(prefs), /empty jobs array/);
});
test('public page descriptions are extracted directly rather than trusting an AI summary', async () => {
  const result = await checkDiscoverySources(validateDiscovery({ summary: 'Found', jobs: [job()] }, prefs), async () => ({ text: '<html><body><h1>Data Engineer</h1><p>Acme</p><div class="show-more-less-html__markup"><p>Develop data platforms with Python and SQL.</p><p>Spark and Kafka experience is required.</p></div></body></html>', url: job().url }));
  assert.match(result.jobs[0].description, /Kafka/); assert.ok(result.jobs[0].technologies.includes('spark'));
});
test('employer discovery accepts only independently readable structured job-detail pages', async () => {
  const preferences = { ...prefs, includeEmployerSites: true };
  const output = { summary: 'Official posting', jobs: [{ ...job(), url: 'https://careers.example.com/roles/engineer' }] };
  const valid = await checkDiscoverySources(validateDiscovery(output, preferences), async url => ({ text: '<html><body><h1>Data Engineer</h1><p>Acme</p><script type="application/ld+json">{"@type":"JobPosting","description":"Build data pipelines with Python, SQL and Spark in the engineering team."}</script></body></html>', url }));
  assert.equal(valid.jobs.length, 1); assert.equal(valid.jobs[0].source, 'Codex employer search'); assert.match(valid.jobs[0].description, /Spark/);
  const generic = await checkDiscoverySources(validateDiscovery(output, preferences), async url => ({ text: '<h1>Acme Data Engineer careers search</h1>', url })); assert.equal(generic.jobs.length, 0);
  const unreadable = await checkDiscoverySources(validateDiscovery(output, preferences), async () => { throw new Error('Unreadable'); }); assert.equal(unreadable.jobs.length, 0);
  assert.throws(() => validateDiscovery({ ...output, jobs: [{ ...output.jobs[0], url: 'https://linkedin.com.evil.test/roles/123' }] }, preferences));
});
test('saved capture refresh checks the same posting, repairs location and backs off unreadable sources', async () => {
  const saved = { ...job(), id: 'one', stage: 'Saved', source: 'LinkedIn extension', location: 'Unrelated sidebar content '.repeat(8), description: '' };
  const hydrated = await hydrateSavedJobs([saved], async url => ({ text: '<html><body><h1>Data Engineer</h1><p>Acme</p><span class="topcard__flavor--bullet">Rabat, Morocco</span><div class="description__text">Develop data platforms with Python and SQL in an engineering team.</div></body></html>', url }));
  assert.equal(hydrated[0].location, 'Rabat, Morocco'); assert.equal(hydrated[0].descriptionVerified, true); assert.ok(hydrated[0].sourceCheckedAt);
  const failed = await hydrateSavedJobs([saved], async () => { throw new Error('Unreadable'); }); assert.equal(failed[0].description, ''); assert.ok(failed[0].sourceCheckedAt);
  assert.equal((await hydrateSavedJobs(failed, async () => { throw new Error('Should not run'); })).length, 0);
});
