import test from 'node:test';
import assert from 'node:assert/strict';
import { performAutomatedScan } from '../lib/automation.js';
import { verifyCompanies } from '../lib/companies.js';
import { preferenceFingerprint } from '../lib/profile.js';
import { uniqueSearchWarnings, searchSummary } from '../lib/search-warnings.js';
const settings = { resume: 'Synthetic engineer with Python, SQL and React experience in real software projects.', resumeHash: 'test', searchDomains: 'AI engineering', searchLocation: 'Morocco and remote roles' };
const job = { id: 'one', title: 'AI Engineer', company: 'Acme', description: 'Build machine learning services with Python, SQL, Docker and FastAPI.', stage: 'Saved', postedAt: '2 days ago', updatedAt: '2026-10-07T10:00:00Z', url: 'https://www.linkedin.com/jobs/view/12/' };

test('combined search visits both sites sequentially then researches and compares the deduplicated union once', async () => {
  const before = JSON.stringify(settings), calls = [], compared = [], saved = [];
  const indeed = { ...job, id: 'two', url: 'https://ma.indeed.com/viewjob?jk=0123456789abcdef&from=search' };
  let active = 0, release, researchCalls = 0, hydrateCalls = 0;
  const pending = performAutomatedScan({ settings, knownJobs: [],
    hydrate: async () => { hydrateCalls++; return []; },
    search: async preferences => {
      assert.equal(active++, 0); calls.push(preferences.jobSite);
      assert.equal('resume' in preferences, false); assert.equal(preferences.location, settings.searchLocation);
      assert.equal(preferences.maxAgeDays, 30); assert.equal(preferences.includeReview, true);
      if (preferences.jobSite === 'linkedin') await new Promise(resolve => { release = resolve; });
      else assert.ok(preferences.knownUrls.includes(job.url));
      active--;
      return { summary: 'Synthetic source evidence', jobs: preferences.jobSite === 'linkedin' ? [job, job] : [indeed, { ...indeed, url: 'https://www.indeed.com/rc/clk?jk=0123456789abcdef' }] };
    },
    research: async names => { researchCalls++; assert.deepEqual(names, ['Acme']); return []; },
    rank: async input => { assert.equal(input.resume, settings.resume); compared.push(...input.jobs); return { summary: 'Synthetic fit', rankings: [] }; },
    saveJob: input => { saved.push(input); return { job: input, created: true }; }, saveCompany: () => {}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['linkedin']); assert.equal(researchCalls, 0); release();
  const result = await pending;
  assert.deepEqual(calls, ['linkedin', 'indeed']); assert.equal(hydrateCalls, 1); assert.equal(researchCalls, 1);
  assert.equal(saved.length, 2); assert.equal(compared.length, 2); assert.equal(result.newJobIds.length, 2);
  assert.deepEqual(result.sourceResults.map(source => source.status), ['completed', 'completed']);
  assert.equal(JSON.stringify(settings), before);
});

for (const failedSite of ['linkedin', 'indeed']) test(`combined search preserves other-source offers and CV comparisons when ${failedSite} is blocked`, async () => {
  const calls = []; let comparisons = 0;
  const result = await performAutomatedScan({ settings, knownJobs: [],
    search: async preferences => { calls.push(preferences.jobSite); if (preferences.jobSite === failedSite) throw new Error('Synthetic source HTTP 403'); return { summary: 'Readable source', jobs: [job] }; },
    research: async () => [], rank: async ({ jobs }) => { comparisons += jobs.length; return { summary: 'Synthetic', rankings: [] }; },
    saveJob: input => ({ job: input, created: true }), saveCompany: () => {}
  });
  assert.deepEqual(calls, ['linkedin', 'indeed']); assert.equal(result.newJobIds.length, 1); assert.equal(comparisons, 1);
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /HTTP 403/);
  assert.equal(result.sourceResults.find(source => source.jobSite === failedSite).status, 'failed');
});

test('combined search reports failure when neither source could be searched', async () => {
  const calls = [];
  await assert.rejects(performAutomatedScan({ settings, knownJobs: [],
    search: async preferences => { calls.push(preferences.jobSite); throw new Error('Synthetic unavailable source'); },
    research: async () => { assert.fail('Do not research without discovery'); }, rank: async () => { assert.fail('Do not rank after discovery failed'); },
    saveJob: () => { assert.fail('Do not invent offers'); }, saveCompany: () => {}
  }), error => {
    assert.equal(error.message.match(/Synthetic unavailable source/g).length, 1);
    assert.deepEqual(error.sourceResults.map(source => source.jobSite), ['linkedin', 'indeed']);
    assert.ok(error.sourceResults.every(source => source.status === 'failed')); return true;
  });
  assert.deepEqual(calls, ['linkedin', 'indeed']);
});
test('manual scan saves new jobs, skips closed offers, researches companies and ranks against CV', async () => {
  const phases = [], savedCompanies = [];
  const r = await performAutomatedScan({ settings, knownJobs: [], search: async p => { assert.equal(p.location, 'Morocco and remote roles'); return { summary: 'Found', jobs: [job, { ...job, url: 'https://www.linkedin.com/jobs/view/13/', verification: 'Posting may be closed' }] }; }, research: async names => { assert.deepEqual(names, ['Acme']); return [{ name: 'Acme', contacts: [], recruitmentTeam: [] }]; }, rank: async ({ resume, jobs }) => { assert.equal(resume, settings.resume); assert.equal(jobs.length, 1); return { summary: 'Fits', rankings: [] }; }, saveJob: j => ({ job: j, created: true }), saveCompany: c => savedCompanies.push(c), progress: p => phases.push(p) });
  assert.equal(r.newJobIds.length, 1); assert.equal(r.closedJobs.length, 1); assert.equal(savedCompanies.length, 1); assert.deepEqual(r.technologies[0].technologies, ['python', 'sql', 'docker', 'machine learning', 'fastapi']); assert.equal(phases.length, 4);
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

for (const code of ['PUBLIC_SEARCH_BLOCKED', 'SEARCH_SOURCE_BLOCKED']) test(`a cached ${code} stops employer batches, deduplicates warnings and still compares all jobs`, async () => {
  const warning = 'Public web search blocked this request.';
  const knownJobs = Array.from({ length: 15 }, (_, i) => ({ ...job, id: String(i), company: 'Employer ' + i, url: `https://www.linkedin.com/jobs/view/${2000 + i}/` }));
  let researchCalls = 0, compared = 0;
  const result = await performAutomatedScan({ settings, knownJobs,
    search: async () => ({ summary: 'Partial discovery', jobs: [], warnings: [warning, warning] }),
    research: async () => { researchCalls++; throw Object.assign(new Error(warning), { code }); },
    rank: async ({ jobs }) => { compared += jobs.length; return { summary: 'Synthetic comparisons', rankings: [] }; },
    saveJob: () => { throw new Error('Existing records must not be recreated'); },
    saveCompany: () => { throw new Error('No research evidence exists'); }
  });
  assert.equal(researchCalls, 1); assert.equal(compared, 15);
  assert.equal(result.pendingRankings, 0); assert.equal(result.companiesResearched, 0);
  assert.deepEqual(result.warnings, [warning]); assert.deepEqual(result.newJobIds, []);
});

test('an isolated employer error does not skip unrelated later employers', async () => {
  const knownJobs = Array.from({ length: 13 }, (_, i) => ({ ...job, id: String(i), company: 'Employer ' + i }));
  let researchCalls = 0;
  const result = await performAutomatedScan({ settings, knownJobs,
    search: async () => ({ jobs: [], summary: 'No new offers' }),
    research: async () => { if (++researchCalls === 1) throw new Error('One employer source failed'); return []; },
    rank: async () => ({ summary: 'Synthetic', rankings: [] }), saveJob: () => {}, saveCompany: () => {}
  });
  assert.equal(researchCalls, 3); assert.equal(result.warnings.length, 1);
});

test('warning summaries collapse the same source failure while retaining distinct problems', () => {
  const warnings = ['Public web search blocked.', 'Employer research: Public web search blocked.', 'Public LinkedIn unreadable.', 'CV comparison: Model timed out.', 'CV comparison: Model timed out.'];
  assert.deepEqual(uniqueSearchWarnings(warnings), ['Public web search blocked.', 'Public LinkedIn unreadable.', 'CV comparison: Model timed out.']);
  assert.equal(warnings.length, 5);
});
test('shared quota failures appear once across discovery, Indeed and employer research', async () => {
  const warning = 'Ollama web search: usage/rate limit reached; change provider or retry later (HTTP 429).';
  let compared = 0;
  const result = await performAutomatedScan({ settings, knownJobs: [],
    search: async preferences => {
      if (preferences.jobSite === 'indeed') throw new Error(warning);
      return { summary: 'LinkedIn results retained.', jobs: [job], warnings: [warning] };
    },
    research: async () => { throw Object.assign(new Error(warning), { code: 'SEARCH_SOURCE_BLOCKED' }); },
    rank: async ({ jobs }) => { compared += jobs.length; return { summary: 'Compared', rankings: [] }; },
    saveJob: input => ({ job: input, created: true }), saveCompany: () => {}
  });
  assert.deepEqual(result.warnings, [warning]); assert.equal(compared, 1);
  assert.deepEqual(result.newJobIds, [job.id]); assert.equal(result.companiesResearched, 0);
  assert.equal(result.sourceResults.find(source => source.jobSite === 'indeed').status, 'failed');
  assert.doesNotMatch(result.summary, /HTTP 429/);
  const oldWarnings = [warning, `Indeed: ${warning}`, `Employer research: ${warning}`, 'Indeed: Different source HTTP 403'];
  assert.deepEqual(uniqueSearchWarnings(oldWarnings), [warning, 'Indeed: Different source HTTP 403']);
  assert.equal(searchSummary(`LinkedIn: useful results\nIndeed: ${warning}`, oldWarnings), 'LinkedIn: useful results');
  assert.equal(oldWarnings.length, 4);
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
