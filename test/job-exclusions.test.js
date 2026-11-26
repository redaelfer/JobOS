import test from 'node:test';
import assert from 'node:assert/strict';
import { excludedBySearchPreferences, isInternshipOffer } from '../lib/job-exclusions.js';
import { selectSearchMatches } from '../lib/search-policy.js';
import { discoveryPrompt } from '../lib/discovery.js';
import { performAutomatedScan } from '../lib/automation.js';

const exclude = 'unpaid, senior, PFE, stage, internship, intern, stagiaire';
const job = { title: 'Junior Data Scientist', company: 'Fixture', location: 'Casablanca', description: 'Build data science models in Python and SQL.', postedAt: '1 day ago', sourceCheckedAt: new Date().toISOString(), verification: 'found on public posting', url: 'https://www.linkedin.com/jobs/view/12345/' };

test('saved internship exclusions recognize French and English opening titles, including paid pre-employment stages', () => {
  for (const title of ['PFE Data Scientist', 'Data Scientist (P.F.E.)', 'Stage Data Scientist', 'Stage pré-embauche en IA', 'Stagiaire Full Stack', 'Junior ML Intern', 'Paid Software Engineering Internship', 'Data Science Interns', 'Projet de fin d’études en IA', "Projet fin d'étude — Data", 'Stage de fin d’études', 'Projet fin detude data science']) {
    assert.equal(isInternshipOffer({ ...job, title }), true, title);
    assert.equal(excludedBySearchPreferences({ ...job, title }, exclude), true, title);
  }
  assert.equal(excludedBySearchPreferences({ ...job, title: 'PFE Data Scientist' }, 'unpaid, senior'), false, 'exclusions remain user controlled');
  assert.equal(excludedBySearchPreferences({ ...job, title: 'Stage Data Scientist' }, 'internship'), true, 'bilingual equivalents share a meaning');
});

test('neutral job titles are excluded when the source identifies an internship contract or opening', () => {
  for (const description of ['Employment type: Internship', 'Job type: Full-time, Internship', 'Type de contrat : Stage', 'Contrat: stage pré-embauche', 'Seniority level\nInternship', 'This position is a paid internship.', 'We are hiring a data science intern.', 'Nous recherchons un stagiaire en intelligence artificielle.', 'Offre de stage rémunéré. Python et SQL.', 'Stage PFE de six mois en data science.', 'Une convention de stage est obligatoire.', 'Projet de fin d’études en machine learning.', "Stage fin d'étude en data science."]) {
    assert.equal(excludedBySearchPreferences({ ...job, description }, exclude), true, description);
  }
});

test('graduate employment remains eligible when previous internships count as experience or the employer is early-stage', () => {
  for (const title of ['Junior Data Scientist', 'Graduate AI Engineer', 'Early-stage ML Engineer', 'DataStage Developer', 'Internal Tools Developer']) {
    assert.equal(excludedBySearchPreferences({ ...job, title }, exclude), false, title);
  }
  for (const description of ['Previous internships count as experience for this permanent role.', 'We are an early-stage company hiring a graduate engineer.', 'Votre stage de fin d’études sera pris en compte. Type de contrat : CDI.', 'Votre projet de fin d’études sera pris en compte pour ce poste en CDI.', 'Projets PFE et stages acceptés comme première expérience.', 'This role is not an internship. New graduates are welcome.', 'You will mentor interns and support their learning.']) {
    assert.equal(excludedBySearchPreferences({ ...job, description }, exclude), false, description);
  }
  assert.equal(excludedBySearchPreferences({ ...job, title: 'Unpaid Data Scientist' }, exclude), true);
  assert.equal(excludedBySearchPreferences({ ...job, title: 'C++ Developer' }, 'C++'), true, 'user terms are escaped before matching');
});

test('both search sources and both date passes filter internships after source extraction without hiding saved closures', () => {
  for (const jobSite of ['linkedin', 'indeed']) for (const coveragePass of ['recent', 'review']) {
    const prefs = { jobSite, domains: ['Data science'], level: 'Graduate / Entry level', exclude, includeReview: true, coveragePass, maxAgeDays: 30 };
    const base = { ...job, postedAt: coveragePass === 'recent' ? '1 day ago' : '' };
    const jobs = [{ ...base }, { ...base, title: 'Stage Data Scientist' }, { ...base, description: 'Type de contrat: Stage. Build data science models with Python.' }];
    const result = selectSearchMatches({ jobs, summary: 'Fixture' }, prefs);
    assert.equal(result.jobs.length, 1); assert.equal(result.skipped.excludedTerms, 2);
    assert.match(discoveryPrompt(prefs), /Exclude internship openings/);
    const closed = { ...base, title: 'Stage Data Scientist', availabilityStatus: 'closed' };
    assert.equal(selectSearchMatches({ jobs: [closed], summary: '' }, { ...prefs, knownUrls: [closed.url] }).jobs.length, 1, 'known closure evidence still reaches the saved record');
  }
});

test('combined scan applies saved exclusions to streamed and final offers from each site', async () => {
  const saved = [], calls = [];
  await performAutomatedScan({
    settings: { searchDomains: 'Data science', searchLevel: 'Graduate / Entry level', searchExclude: exclude }, knownJobs: [],
    search: async (prefs, batch) => {
      calls.push(prefs.jobSite); assert.equal(prefs.exclude, exclude);
      const url = n => prefs.jobSite === 'linkedin' ? `https://www.linkedin.com/jobs/view/${n}/` : `https://ma.indeed.com/viewjob?jk=${String(n).padStart(16, '0')}`;
      const jobs = [{ ...job, url: url(1) }, { ...job, title: 'PFE Data Scientist', url: url(2) }, { ...job, title: 'Data Scientist Intern', url: url(3) }];
      batch(jobs); return { jobs, summary: 'Fixture' };
    },
    saveJob: input => { saved.push(input); return { job: { ...input, id: String(saved.length) }, created: true }; }
  });
  assert.deepEqual(calls, ['linkedin', 'indeed']); assert.equal(saved.length, 2);
  assert.ok(saved.every(j => j.title === 'Junior Data Scientist'));
});
