import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { searchPreferences, validateDiscovery, checkDiscoverySources, discoveryPrompt } from '../lib/discovery.js';
import { selectSearchMatches, recentPosting, matchesDomains } from '../lib/search-policy.js';
import { preferenceFingerprint } from '../lib/profile.js';
import { performAutomatedScan } from '../lib/automation.js';
import { filterOpportunities, dailyOpportunities } from '../public/opportunities-view.js';
const now = Date.parse('2026-10-08T12:00:00Z');
const preferences = searchPreferences({ domains: 'Software engineering, Data engineering', maxAgeDays: 30, includeReview: false });
const posting = (index = 1, changes = {}) => ({ title: 'Junior Software Engineer', company: 'Acme', location: 'Morocco', url: `https://www.linkedin.com/jobs/view/${1000 + index}/`, description: 'Build software services with Python and PostgreSQL.', evidence: 'Acme seeks a junior software engineer in Morocco.', postedAt: '2 days ago', sourceCheckedAt: new Date(now).toISOString(), ...changes });

test('uncapped discovery accepts 25 unique jobs even when a legacy limit is supplied', () => {
  const prefs = searchPreferences({ domains: 'Software engineering', limit: 5 });
  const result = validateDiscovery({ summary: 'Source-backed jobs', jobs: Array.from({ length: 25 }, (_, i) => posting(i)) }, prefs);
  assert.equal(result.jobs.length, 25);
  assert.match(discoveryPrompt(prefs), /NO fixed result count/);
  assert.match(discoveryPrompt(prefs), /last 30 days/);
});

test('publication dates exclude four-month-old, undated and future roles without using discovery freshness', () => {
  const result = selectSearchMatches({ summary: 'Found', jobs: [posting(), posting(2, { postedAt: '4 months ago', detectedAt: new Date(now).toISOString() }), posting(3, { postedAt: '' }), posting(4, { postedAt: '2027-01-01' }), posting(5, { title: 'Sales Representative', description: 'Sell products and recruit customers.' })] }, preferences, now);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.skipped, { old: 2, unknownDate: 1, outsideDomains: 1, closed: 0, unverifiedSource: 0 });
  assert.equal(recentPosting(posting(6, { postedAt: '30 days ago' }), 30, now), true);
  assert.equal(recentPosting(posting(6, { postedAt: '31 days ago' }), 30, now), false);
  assert.equal(recentPosting(posting(6, { postedAt: 'il y a 7 jours' }), 7, now), true);
  assert.equal(recentPosting(posting(6, { postedAt: 'قبل ‏‏٤‏شهر‏' }), 30, now), false);
  assert.equal(matchesDomains(posting(7, { title: 'Talent Acquisition Officer', description: 'Recruit software engineers.' }), preferences.domains), false);
});

test('source checks replace claimed ages with displayed posting dates and reject undated sources', async () => {
  const raw = () => validateDiscovery({ summary: 'Found', jobs: [posting()] }, preferences);
  const page = date => `<html><body><h1>Junior Software Engineer</h1><p>Acme</p>${date}<div class="description__text">Build software services with Python and PostgreSQL.</div></body></html>`;
  const old = await checkDiscoverySources(raw(), async url => ({ url, text: page('<span class="posted-time-ago__text">4 months ago</span>') }));
  assert.equal(old.jobs[0].postedAt, '4 months ago');
  assert.equal(selectSearchMatches(old, preferences).jobs.length, 0);
  const undated = await checkDiscoverySources(raw(), async url => ({ url, text: page('') }));
  assert.equal(undated.jobs[0].postedAt, '');
  assert.equal(selectSearchMatches(undated, preferences).jobs.length, 0);
  const fresh = await checkDiscoverySources(raw(), async url => ({ url, text: page('<span class="posted-time-ago__text">3 hours ago</span>') }));
  assert.equal(selectSearchMatches(fresh, preferences).jobs.length, 1);
  const employer = await checkDiscoverySources(validateDiscovery({ summary: 'Found', jobs: [posting(1, { url: 'https://careers.example.com/jobs/one' })] }, { ...preferences, includeEmployerSites: true }), async url => ({ url, text: page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', datePosted: new Date().toISOString(), description: posting().description })}</script>`) }));
  assert.ok(employer.jobs[0].postedAt);
  assert.equal(selectSearchMatches(employer, preferences).jobs.length, 1);
});

test('manual workflow researches and ranks all 24 jobs in bounded sequential batches', async () => {
  const jobs = Array.from({ length: 24 }, (_, i) => ({ ...posting(i), id: `job-${i}`, company: `Employer-${i % 8}`, stage: 'Saved', updatedAt: 'same' }));
  const settings = { resume: 'Synthetic software engineer with Python, APIs and SQL experience.', resumeHash: 'synthetic', searchDomains: 'Software engineering' };
  const researchSizes = [], rankSizes = [], saved = [];
  let active = 0;
  const result = await performAutomatedScan({ settings, knownJobs: [], search: async p => { assert.equal('limit' in p, false); return { summary: 'Found', jobs }; }, research: async names => { researchSizes.push(names.length); return names.map(name => ({ name, contacts: [], recruitmentTeam: [] })); }, rank: async ({ jobs: batch, resume }) => { assert.equal(active++, 0); assert.ok(batch.reduce((n, j) => n + j.description.length, resume.length) <= 120000); await new Promise(resolve => setImmediate(resolve)); active--; rankSizes.push(batch.length); return { summary: 'Compared synthetic records', rankings: batch.map(j => ({ jobId: j.id, score: 80 })) }; }, saveJob: job => { saved.push(job); return { job, created: true }; }, saveCompany: () => {} });
  assert.equal(saved.length, 24); assert.equal(result.newJobIds.length, 24); assert.equal(result.report.rankings.length, 24);
  assert.deepEqual(researchSizes, [6, 2]); assert.deepEqual(rankSizes, [10, 10, 4]);
  assert.equal(result.pendingRankings, 0); assert.equal(result.companiesResearched, 8);
});

test('search window changes do not make historical CV scores stale', () => {
  const settings = { searchDomains: 'Software engineering', searchLocation: 'Morocco', searchLevel: 'Graduate / Entry level' };
  assert.equal(preferenceFingerprint({ ...settings, searchMaxAgeDays: 7 }), preferenceFingerprint({ ...settings, searchMaxAgeDays: 30 }));
  assert.notEqual(preferenceFingerprint(settings), preferenceFingerprint({ ...settings, searchDomains: 'QA engineering' }));
});

test('recent feed hides old dates while All saved retains records and unknown dates remain explicit', () => {
  const items = [posting(1, { jobId: 'new', technologies: [], postedAt: '2 days ago', sourceCheckedAt: new Date().toISOString() }), posting(2, { jobId: 'old', technologies: [], postedAt: '4 months ago', sourceCheckedAt: new Date().toISOString() }), posting(3, { jobId: 'unknown', technologies: [], postedAt: '' })];
  const feed = { today: '2026-10-08', maxAgeDays: 30, items, counts: { today: 3, recommended: 0, pending: 0 } };
  assert.deepEqual(filterOpportunities(feed, { posted: 'recent' }).map(j => j.jobId), ['new']);
  assert.equal(filterOpportunities(feed, { posted: 'all' }).length, 3);
  assert.deepEqual(filterOpportunities(feed, { posted: 'unknown' }).map(j => j.jobId), ['unknown']);
  const dom = new JSDOM(dailyOpportunities({ opportunities: { ...feed, items: [] }, settings: {}, scans: [] }, { range: 'all', mode: 'all', query: '', posted: 'recent' }));
  assert.equal(dom.window.document.querySelector('#daily-posted').value, 'recent');
  assert.match(dom.window.document.body.textContent, /Manual search only/);
  assert.doesNotMatch(dom.window.document.body.textContent, /Hourly search configured/);
  dom.window.close();
});

test('legacy hourly entry point exits without starting a server or searching', () => {
  const output = JSON.parse(execFileSync(process.execPath, ['scripts/run-hourly.js'], { encoding: 'utf8' }));
  assert.equal(output.skipped, true); assert.match(output.reason, /disabled/);
});
