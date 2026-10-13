import test from 'node:test';
import assert from 'node:assert/strict';
import { performAutomatedScan } from '../lib/automation.js';
import { verifyCompanies } from '../lib/companies.js';
import { preferenceFingerprint } from '../lib/profile.js';
const settings = { resume: 'Synthetic engineer with Python, SQL and React experience in real software projects.', resumeHash: 'test', searchDomains: 'AI engineering', searchLocation: 'Morocco and remote roles' };
const job = { id: 'one', title: 'AI Engineer', company: 'Acme', description: 'Build machine learning services with Python, SQL, Docker and FastAPI.', stage: 'Saved', postedAt: '2 days ago', updatedAt: '2026-10-07T10:00:00Z', url: 'https://www.linkedin.com/jobs/view/12/' };
test('hourly scan saves new jobs, skips closed offers, researches companies and ranks against CV', async () => {
  const phases = [], savedCompanies = [];
  const r = await performAutomatedScan({ settings, knownJobs: [], search: async p => { assert.equal(p.location, 'Morocco and remote roles'); return { summary: 'Found', jobs: [job, { ...job, url: 'https://www.linkedin.com/jobs/view/13/', verification: 'Posting may be closed' }] }; }, research: async names => { assert.deepEqual(names, ['Acme']); return [{ name: 'Acme', contacts: [], recruitmentTeam: [] }]; }, rank: async ({ resume, jobs }) => { assert.equal(resume, settings.resume); assert.equal(jobs.length, 1); return { summary: 'Fits', rankings: [] }; }, saveJob: j => ({ job: j, created: true }), saveCompany: c => savedCompanies.push(c), progress: p => phases.push(p) });
  assert.equal(r.newJobIds.length, 1); assert.equal(r.closedJobs.length, 1); assert.equal(savedCompanies.length, 1); assert.deepEqual(r.technologies[0].technologies, ['python', 'sql', 'docker', 'machine learning', 'fastapi']); assert.equal(phases.length, 3);
});
test('unchanged jobs and recently researched companies avoid repeated expensive work', async () => {
  let ranked = false, researched = false;
  const r = await performAutomatedScan({ settings, knownJobs: [job], companies: [{ name: 'Acme', researchVersion: 2, researchedAt: new Date().toISOString() }], rankings: [{ status: 'completed', resumeHash: 'test', preferencesHash: preferenceFingerprint(settings), jobUpdatedAt: { one: job.updatedAt } }], search: async () => ({ summary: 'Same result', jobs: [job] }), research: async () => { researched = true; return []; }, rank: async () => { ranked = true; }, saveJob: () => ({ job, created: false }), saveCompany: () => {} });
  assert.equal(r.newJobIds.length, 0); assert.equal(researched, false); assert.equal(ranked, false);
});
test('partial research failures retain discovered jobs and report warnings', async () => {
  const r = await performAutomatedScan({ settings, knownJobs: [], search: async () => ({ summary: 'Found', jobs: [job] }), research: async () => { throw new Error('Research unavailable'); }, rank: async () => { throw new Error('Ranking unavailable'); }, saveJob: () => ({ job, created: true }), saveCompany: () => {} });
  assert.equal(r.newJobIds.length, 1); assert.equal(r.warnings.length, 2);
});
test('recruiting members and emails need literal public-source evidence', async () => {
  const result = await verifyCompanies({ companies: [{ name: 'Acme', industry: 'Software', website: 'https://example.com', sourceUrl: 'https://example.com/about', recruitmentTeam: [{ name: 'Alex Recruiter', role: 'Talent acquisition manager', profileUrl: 'https://example.com/team/alex', sourceUrl: 'https://example.com/team' }, { name: 'Invented Person', role: 'Recruiter', sourceUrl: 'https://example.com/team' }], contacts: [{ email: 'careers@example.com', sourceUrl: 'https://example.com/careers' }, { email: 'guessed@example.com', sourceUrl: 'https://example.com/careers' }] }] }, ['Acme'], async url => ({ text: 'Acme team: Alex Recruiter, Talent acquisition manager. Contact careers@example.com.', url }));
  assert.equal(result[0].recruitmentTeam.length, 1); assert.equal(result[0].contacts.length, 1); assert.equal(result[0].contacts[0].email, 'careers@example.com');
});
test('research rejects unrelated department emails and source-only names without company affiliation', async () => {
  const result = await verifyCompanies({ companies: [{ name: 'Acme', website: 'https://example.com', industry: 'Software', sourceUrl: 'https://example.com', careersUrl: 'https://example.com/careers', recruitmentTeam: [{ name: 'Alex', role: 'Recruiter', sourceUrl: 'https://example.com/other-team' }], contacts: [{ email: 'merch@example.com', sourceUrl: 'https://example.com/shop' }, { email: 'careers@example.com', sourceUrl: 'https://example.com/careers' }] }] }, ['Acme'], async url => ({ url, text: url.endsWith('other-team') ? '<p>OtherCo: Alex, Recruiter</p>' : '<p>Acme careers: careers@example.com merch@example.com</p>' }));
  assert.equal(result[0].contacts.length, 1); assert.equal(result[0].contacts[0].purpose, 'recruitment'); assert.equal(result[0].recruitmentTeam.length, 0); assert.equal(result[0].careersUrl, 'https://example.com/careers');
});
test('closed rediscovered jobs update their existing record without saving a new closed offer', async () => {
  let input;
  const result = await performAutomatedScan({ settings, knownJobs: [job], search: async () => ({ summary: 'Closed', jobs: [{ ...job, verification: 'Posting may be closed' }] }), research: async () => [], rank: async () => { throw new Error('Must not rank closed jobs'); }, saveJob: j => { input = j; return { job: j, created: false }; }, saveCompany: () => {} });
  assert.match(input.verification, /closed/); assert.equal(result.rankedJobs.length, 0); assert.equal(result.newJobIds.length, 0);
});
