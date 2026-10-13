import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildOpportunities, localDay } from '../lib/opportunities.js';
import { resumeFingerprint, preferenceFingerprint } from '../lib/profile.js';
import { dailyOpportunities, filterOpportunities, opportunityCards } from '../public/opportunities-view.js';
import { performAutomatedScan } from '../lib/automation.js';
const settings = { resume: 'Synthetic engineer with Python and SQL skills, data projects and React development.', searchDomains: 'Data engineering', searchLocation: 'Morocco and remote roles', minimumFit: 70 };
const job = { id: 'one', title: 'Data Engineer', company: 'Acme', location: 'Rabat', stage: 'Saved', source: 'Codex LinkedIn search', url: 'https://www.linkedin.com/jobs/view/101/', description: 'Build pipelines with Python, SQL and Docker. Communication is essential.', createdAt: '2026-10-07T10:00:00Z', updatedAt: '2026-10-07T10:00:00Z' };
const report = (score = 82) => ({ status: 'completed', completedAt: '2026-10-07T11:00:00Z', resumeHash: resumeFingerprint(settings), preferencesHash: preferenceFingerprint(settings), jobUpdatedAt: { one: job.updatedAt }, rankings: [{ jobId: 'one', score, fit: 'Python experience fits.', strengths: ['Python projects'], gaps: ['Docker experience unclear'], nextStep: 'Review the requirements', contacts: [] }] });
const feed = (overrides = {}) => buildOpportunities({ settings, jobs: [job], rankings: [report()], now: '2026-10-07T12:00:00Z', ...overrides });

test('daily feed joins fit evidence, technologies and company contacts into the current job', () => {
  const result = feed({ companies: [{ name: 'Acme', industry: 'Software', website: 'https://example.com', careersUrl: 'https://example.com/careers', contacts: [{ email: 'careers@example.com', sourceUrl: 'https://example.com/careers', status: 'Found on source page' }], recruitmentTeam: [{ name: 'Alex', role: 'Recruiter', profileUrl: 'https://example.com/team', status: 'Public source' }] }] });
  assert.equal(result.items[0].recommended, true); assert.equal(result.items[0].rankingStatus, 'current'); assert.equal(result.counts.today, 1);
  assert.deepEqual(result.items[0].technologies, ['python', 'sql', 'docker']); assert.equal(result.items[0].emails[0].email, 'careers@example.com'); assert.equal(result.items[0].recruitmentTeam[0].name, 'Alex');
});
test('changed CV, domains or job details invalidate recommendations without deleting old evidence', () => {
  for (const overrides of [{ settings: { ...settings, resume: settings.resume + ' New experience.' } }, { settings: { ...settings, searchDomains: 'AI engineering' } }, { jobs: [{ ...job, updatedAt: '2026-10-07T12:00:00Z' }] }]) {
    const result = feed(overrides); assert.equal(result.items[0].rankingStatus, 'outdated'); assert.equal(result.items[0].recommended, false); assert.equal(result.items[0].score, 82);
  }
});
test('fit threshold, closed jobs and application stages affect the actionable shortlist', () => {
  assert.equal(feed({ settings: { ...settings, minimumFit: 90 } }).items[0].recommended, false);
  assert.equal(feed({ jobs: [{ ...job, stage: 'Applied' }] }).items[0].recommended, false);
  assert.equal(feed({ jobs: [{ ...job, verification: 'Posting may be closed' }] }).items[0].closed, true);
});
test('missing descriptions and pending comparisons are not shown as zero fit', () => {
  const result = feed({ jobs: [{ ...job, description: '' }, { ...job, id: 'two' }], rankings: [] });
  assert.equal(result.items.find(i => i.jobId === 'one').rankingStatus, 'description-needed');
  assert.equal(result.items.find(i => i.jobId === 'two').rankingStatus, 'pending');
  assert.ok(result.items.every(i => i.score === null));
});
test('scores remain available beyond the ten reports exposed in the ranking history', () => {
  const older = report(); older.completedAt = '2026-10-01T10:00:00Z';
  const later = Array.from({ length: 20 }, (_, i) => ({ ...report(), completedAt: '2026-10-07T12:00:00Z', rankings: [{ jobId: 'other-' + i, score: 20 }] }));
  assert.equal(feed({ rankings: [...later, older] }).items[0].score, 82);
  assert.equal(feed({ rankings: [report(20), { ...report(95), completedAt: '2026-10-07T13:00:00Z' }] }).items[0].score, 95);
});
test('contact evidence is deduplicated and missing contacts retain career-page fallback', () => {
  const result = feed({ jobs: [{ ...job, description: job.description + ' Write careers@example.com.' }], companies: [{ name: 'Acme', contacts: [{ email: 'careers@example.com', sourceUrl: 'https://example.com/jobs' }], recruitmentTeam: [], careersUrl: 'https://example.com/careers' }], contacts: [{ name: 'Saved', company: 'Acme', email: 'careers@example.com', linkedin: '' }] });
  assert.equal(result.items[0].emails.length, 1); assert.match(result.items[0].emails[0].status, /saved job description/);
  const empty = feed({ companies: [{ name: 'Acme', careersUrl: 'https://example.com/careers', contacts: [], recruitmentTeam: [] }] }).items[0];
  assert.equal(empty.contactStatus, 'no-public-contact'); assert.match(opportunityCards([empty]), /Company careers/);
});
test('daily filters use Moroccan dates, strong matches and technology searches', () => {
  assert.equal(localDay('2026-10-07T23:30:00Z'), '2026-10-08');
  const result = feed({ jobs: [job, { ...job, id: 'old', createdAt: '2026-09-01T10:00:00Z' }] });
  assert.equal(filterOpportunities(result, { range: 'today' }).length, 1);
  assert.equal(filterOpportunities(result, { range: 'all' }).length, 2);
  assert.equal(filterOpportunities(result, { range: 'all', mode: 'matches' }).length, 1);
  assert.equal(filterOpportunities(result, { range: 'today', query: 'docker' }).length, 1);
  assert.equal(filterOpportunities(result, { range: 'week', query: 'unrelated' }).length, 0);
});
test('daily UI renders controls and escapes scraped text and unsafe fallback links', () => {
  const result = feed({ jobs: [{ ...job, title: '<img src=x onerror=alert(1)>' }], companies: [{ name: 'Acme', website: 'javascript:alert(1)', contacts: [], recruitmentTeam: [] }] });
  const dom = new JSDOM(dailyOpportunities({ opportunities: result, settings, scans: [] }, { range: 'today', mode: 'all', query: '' }));
  assert.equal(dom.window.document.querySelectorAll('article').length, 1); assert.ok(dom.window.document.querySelector('#daily-range')); assert.ok(dom.window.document.querySelector('#fit-preferences'));
  assert.equal(dom.window.document.querySelectorAll('img,[onerror],a[href^="javascript:"]').length, 0);
  assert.match(dom.window.document.body.textContent, /Who to contact/); dom.window.close();
});
test('hourly scan researches previously saved employers and retries empty research after a day', async () => {
  let names, scored;
  const result = await performAutomatedScan({ settings: { ...settings, resumeHash: resumeFingerprint(settings) }, knownJobs: [job], companies: [{ name: 'Acme', researchVersion: 2, researchedAt: new Date(Date.now() - 2 * 86400000).toISOString(), contacts: [], recruitmentTeam: [] }], rankings: [report()], search: async p => { assert.ok(p.knownUrls.includes(job.url)); assert.equal(p.includeEmployerSites, true); return { summary: 'No new jobs', jobs: [] }; }, research: async (input, context) => { names = input; assert.equal(context[0].title, job.title); return []; }, rank: async () => { scored = true; }, saveJob: () => {}, saveCompany: () => {} });
  assert.deepEqual(names, ['Acme']); assert.equal(scored, undefined); assert.equal(result.newJobIds.length, 0);
});
test('preference changes requeue readable jobs and ranking batches respect the input budget', async () => {
  const jobs = Array.from({ length: 5 }, (_, i) => ({ ...job, id: String(i), description: 'Python '.repeat(7000) }));
  const result = await performAutomatedScan({ settings: { ...settings, searchDomains: 'AI engineering', resumeHash: resumeFingerprint(settings) }, knownJobs: jobs, rankings: [report()], search: async () => ({ summary: 'No new jobs', jobs: [] }), research: async () => [], rank: async input => { assert.equal(input.preferences.domains[0], 'AI engineering'); assert.ok(input.jobs.reduce((n, j) => n + j.description.length, input.resume.length) <= 120000); return { summary: 'Ranked', rankings: [] }; }, saveJob: () => {}, saveCompany: () => {} });
  assert.equal(result.rankedJobs.length, 5); assert.equal(result.pendingRankings, 0);
});
