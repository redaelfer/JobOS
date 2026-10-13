import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { postingTime, orderJobs, matchesPublication } from '../public/job-order.js';
import { applicationList } from '../public/application-tools.js';
import { filterOpportunities } from '../public/opportunities-view.js';
const checked = '2026-10-07T20:00:00Z';
test('publication sorting handles source dates and English, French and Arabic relative ages', () => {
  const anchor = Date.parse(checked);
  assert.equal(postingTime({ postedAt: '17 hours ago', sourceCheckedAt: checked }), anchor - 17 * 3600000);
  assert.equal(postingTime({ postedAt: 'il y a 2 jours', sourceCheckedAt: checked }), anchor - 2 * 86400000);
  assert.equal(postingTime({ postedAt: 'قبل ‏‏١‏شهر‏', sourceCheckedAt: checked }), anchor - 30 * 86400000);
  assert.equal(postingTime({ postedAt: '2026-10-07T10:00:00Z' }), Date.parse('2026-10-07T10:00:00Z'));
  assert.equal(postingTime({ postedAt: '0 hours ago', sourceCheckedAt: checked }), anchor);
  assert.equal(postingTime({ postedAt: 'Date unavailable', createdAt: checked }), 0);
  const old = { id: 'old', postedAt: '5 months ago', sourceCheckedAt: checked, createdAt: checked }, recent = { id: 'new', postedAt: '17 hours ago', sourceCheckedAt: checked }, unknown = { id: 'unknown', postedAt: '', createdAt: checked };
  assert.deepEqual(orderJobs([old, unknown, recent]).map(item => item.id), ['new', 'old', 'unknown']);
});
test('all detected opportunities remain visible while current fit and detection sorting are optional', () => {
  const items = [{ jobId: 'low-fit', title: 'Junior Engineer', company: 'Acme', location: 'Rabat', technologies: [], detectedDay: '2026-10-06', detectedAt: '2026-10-06T12:00:00Z', postedAt: '2026-10-07', score: 20, rankingStatus: 'current' }, { jobId: 'strong', title: 'Engineer', company: 'Acme', location: 'Rabat', technologies: [], detectedDay: '2026-10-07', detectedAt: checked, postedAt: '2026-10-01', score: 90, rankingStatus: 'current', recommended: true }];
  const feed = { today: '2026-10-07', items };
  assert.deepEqual(filterOpportunities(feed).map(item => item.jobId), ['low-fit', 'strong']);
  assert.equal(filterOpportunities(feed, { mode: 'matches' }).length, 1);
  assert.equal(orderJobs(items, 'fit')[0].jobId, 'strong'); assert.equal(orderJobs(items, 'detected')[0].jobId, 'strong');
  assert.equal(items[0].jobId, 'low-fit');
});
test('each application row has a safe offer link and direct tailoring action', () => {
  const jobs = [{ id: 'one', title: 'Junior <Engineer>', company: 'Acme', stage: 'Saved', url: 'https://www.linkedin.com/jobs/view/123/' }, { id: 'two', title: 'Other', company: 'Acme', stage: 'Saved', url: 'javascript:alert(1)' }, { id: 'three', title: 'Backend', company: 'Acme', stage: 'Saved', url: 'https://careers.example.com/roles/3' }];
  const dom = new JSDOM(applicationList(jobs, [], ['Saved', 'Applied'])), doc = dom.window.document;
  assert.equal(doc.querySelectorAll('tbody tr').length, 3); assert.equal(doc.querySelectorAll('a.offer-link').length, 2);
  assert.equal(doc.querySelector('a.offer-link').getAttribute('href'), jobs[0].url); assert.equal(doc.querySelector('a.offer-link').getAttribute('target'), '_blank');
  assert.equal(doc.querySelectorAll('[data-action="prepare-job"]').length, 3); assert.equal(doc.querySelectorAll('img,a[href^="javascript:"]').length, 0); dom.window.close();
});

test('publication windows use source dates with inclusive boundaries and do not use discovery as publication', () => {
  const now = Date.parse('2026-10-08T20:00:00Z'), day = 86400000;
  const job = days => ({ postedAt: new Date(now - days * day).toISOString(), createdAt: new Date(now).toISOString() });
  for (const days of [1, 7, 14, 30]) {
    assert.equal(matchesPublication(job(days), String(days), { now }), true);
    assert.equal(matchesPublication(job(days + 0.001), String(days), { now }), false);
  }
  assert.equal(matchesPublication({ createdAt: new Date(now).toISOString() }, '1', { now }), false);
  assert.equal(matchesPublication({ postedAt: '4 months ago', sourceCheckedAt: new Date(now).toISOString() }, '30', { now }), false);
  assert.equal(matchesPublication(job(-1), '30', { now }), false);
  assert.equal(matchesPublication({ postedAt: '' }, 'unknown', { now }), true);
  assert.equal(matchesPublication(job(100), 'all', { now }), true);
  assert.equal(matchesPublication({ postedAt: 'il y a 2 jours', sourceCheckedAt: new Date(now).toISOString() }, 'recent', { now, maxAgeDays: 2 }), true);
});
