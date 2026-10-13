import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { searchPreferences, checkDiscoverySources, validateDiscovery, discoveryPrompt } from '../lib/discovery.js';
import { selectSearchMatches, matchesDomains } from '../lib/search-policy.js';
import { searchWithCodex } from '../lib/codex.js';
import { preferenceFingerprint } from '../lib/profile.js';
const now = Date.now();
const prefs = searchPreferences({ domains: 'Software engineering, DevOps engineering' });
const job = (id = 1, changes = {}) => ({ title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', url: `https://www.linkedin.com/jobs/view/${8100 + id}/`, description: 'Build production software services using Python, SQL and Docker.', evidence: 'Acme is hiring a junior software engineer in Morocco.', postedAt: '2 days ago', sourceCheckedAt: new Date(now).toISOString(), verification: 'Title and company found on public posting', ...changes });
const checked = result => { for (const item of result.jobs) Object.assign(item, { sourceCheckedAt: new Date().toISOString(), verification: 'Title and company found on public posting' }); return Promise.resolve(result); };
const preferencesFrom = input => JSON.parse(input.slice(input.lastIndexOf('SEARCH PREFERENCES:\n') + 'SEARCH PREFERENCES:\n'.length));

test('broad coverage keeps readable older and undated roles for review while rejecting unsupported and closed sources', () => {
  assert.equal(prefs.includeReview, true);
  const result = selectSearchMatches({ summary: 'Source-backed roles', jobs: [job(), job(2, { postedAt: '4 months ago' }), job(3, { postedAt: '' }), job(4, { postedAt: '4 months ago', verification: 'Search snippet only' }), job(5, { verification: 'Posting may be closed' }), job(6, { postedAt: '2099-01-01' })] }, prefs, now);
  assert.deepEqual(result.jobs.map(j => j.discoveryBucket), ['recent', 'older-review', 'undated-review']);
  assert.ok(result.jobs.slice(1).every(j => j.availabilityStatus === 'unconfirmed'));
  assert.match(result.jobs[1].availabilityEvidence, /confirm/);
  assert.equal(result.skipped.unverifiedSource, 1); assert.equal(result.skipped.closed, 1);
  assert.equal(result.closedJobUrls.length, 1); assert.match(result.summary, /not treated as fresh or confirmed open/);
  assert.equal(matchesDomains(job(7, { title: 'Junior Platform Engineer', description: 'Manage Terraform cloud infrastructure.' }), ['DevOps engineering']), true);
});

test('source deadlines and accessible Apply controls do not become a claim of confirmed active hiring', async () => {
  const input = () => validateDiscovery({ summary: 'Employer source', jobs: [job(1, { url: 'https://careers.example.com/jobs/one' })] }, { ...prefs, includeEmployerSites: true });
  const html = validThrough => `<html><body><h1>Junior Software Engineer</h1><p>Acme</p><button>Apply</button><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', datePosted: '2026-06-01', validThrough, description: job().description })}</script></body></html>`;
  const current = await checkDiscoverySources(input(), async url => ({ url, text: html('2099-01-01') }));
  assert.equal(current.jobs[0].availabilityStatus, 'unconfirmed'); assert.match(current.jobs[0].availabilityEvidence, /verify/);
  assert.equal(selectSearchMatches(current, prefs).jobs[0].discoveryBucket, 'older-review');
  const expired = await checkDiscoverySources(input(), async url => ({ url, text: html('2000-01-01') }));
  assert.equal(expired.jobs[0].availabilityStatus, 'closed'); assert.equal(selectSearchMatches(expired, prefs).jobs.length, 0);
});

test('two search passes run sequentially, share deduplication and keep review roles after recent results', async () => {
  const passes = []; let active = 0;
  const runner = async (args, opts) => {
    assert.equal(active++, 0); assert.ok(args.includes('web_search="live"'));
    assert.doesNotMatch(opts.stdin, /"resume"|private-candidate/);
    const pass = preferencesFrom(opts.stdin); passes.push(pass);
    await new Promise(resolve => setImmediate(resolve));
    const roles = pass.coveragePass === 'recent' ? [job()] : [job(), job(2, { postedAt: '4 months ago' }), job(3, { postedAt: '' })];
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'Synthetic source-backed jobs', jobs: roles }));
    active--; return { code: 0 };
  };
  const result = await searchWithCodex(prefs, runner, checked);
  assert.deepEqual(passes.map(p => p.coveragePass), ['recent', 'review']);
  assert.ok(passes[1].knownUrls.includes(job().url));
  assert.deepEqual(result.jobs.map(j => j.discoveryBucket), ['recent', 'older-review', 'undated-review']);
  assert.equal(new Set(result.jobs.map(j => j.url)).size, 3); assert.equal(result.warnings.length, 0);
  assert.match(discoveryPrompt({ ...prefs, coveragePass: 'review' }), /SECONDARY COVERAGE PASS/);
});

test('secondary provider failure retains verified recent results and reports incomplete coverage', async () => {
  let count = 0;
  const runner = async args => { if (++count === 2) return { code: 1 }; await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'Recent role', jobs: [job()] })); return { code: 0 }; };
  const result = await searchWithCodex(prefs, runner, checked);
  assert.equal(result.jobs.length, 1); assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /Additional coverage did not finish/);
});

test('recent provider failure can still retain supplemental results while warning that fresh coverage failed', async () => {
  let count = 0;
  const runner = async args => { if (++count === 1) return { code: 1 }; await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'Older readable role', jobs: [job(2, { postedAt: '4 months ago' })] })); return { code: 0 }; };
  const result = await searchWithCodex(prefs, runner, checked);
  assert.equal(result.jobs[0].discoveryBucket, 'older-review'); assert.match(result.warnings[0], /Recent search did not finish/);
});

test('recent-only mode performs one pass and coverage settings do not invalidate unchanged CV fits', async () => {
  let count = 0;
  const strict = searchPreferences({ domains: 'Software engineering', includeReview: false });
  const runner = async args => { count++; await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ summary: 'Recent role', jobs: [job()] })); return { code: 0 }; };
  await searchWithCodex(strict, runner, checked); assert.equal(count, 1);
  assert.equal(preferenceFingerprint({ searchDomains: 'Software engineering', searchIncludeReview: true }), preferenceFingerprint({ searchDomains: 'Software engineering', searchIncludeReview: false }));
});
