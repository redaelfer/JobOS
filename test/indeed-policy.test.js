import test from 'node:test';
import assert from 'node:assert/strict';
import { indeedScope, indeedScopeDecision, INDEED_MOROCCO_SCOPE, juniorTitle } from '../lib/indeed-policy.js';
import { automationPreferences } from '../lib/profile.js';
import { searchQueries } from '../lib/web-search.js';
import { indeedQueries } from '../lib/indeed-browser.js';
import { selectSearchMatches } from '../lib/search-policy.js';
import { discoveryPrompt } from '../lib/discovery.js';
import { performAutomatedScan } from '../lib/automation.js';

const preferences = { ...automationPreferences({ indeedOpportunityScope: INDEED_MOROCCO_SCOPE }), jobSite: 'indeed' };
const source = { title: 'Data Scientist', company: 'Fixture', location: 'Casablanca', description: 'Build predictive models using Python and SQL with our data science team.', evidence: 'Source excerpt', postedAt: new Date().toISOString(), sourceCheckedAt: new Date().toISOString(), verification: 'found on public posting', url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef' };

test('Indeed Morocco scope keeps local roles without junior in their title and honest missing-location evidence', () => {
  for (const location of ['Casablanca', 'Rabat-Salé-Kénitra', 'Maroc', 'Morocco', 'الرباط', 'Tanger', 'Ben Guerir']) {
    assert.equal(indeedScopeDecision({ ...source, location }).allowed, true, location);
  }
  const missing = { ...source, location: '' };
  assert.equal(indeedScopeDecision(missing).allowed, false, 'provider cannot infer Morocco from a posting URL');
  const local = indeedScopeDecision(missing, { indeedLocalSearch: true });
  assert.equal(local.allowed, true); assert.match(local.evidence, /location could not be read/);
  for (const location of ['Paris, France', 'New York, NY', 'London', 'Toronto', 'Lisbon']) assert.equal(indeedScopeDecision({ ...source, location }, { indeedLocalSearch: true }).allowed, false, location);
});

test('Indeed scope excludes advanced titles and explicit requirements without confusing senior colleagues with the candidate', () => {
  for (const title of ['Senior Data Scientist', 'Data Architect', 'Expert Big Data', 'Développeur fullstack expérimenté', 'Data & AI Value Manager', 'Staff ML Engineer', 'Software Engineer 5', 'Analytics Engineer 6', 'Lead Developer', 'SPEC ADV SOFTWARE ENGINEER']) {
    assert.equal(indeedScopeDecision({ ...source, title }).allowed, false, title);
  }
  for (const description of ['Requires 5 years of professional experience.', 'Must have 3 years experience.', 'Expérience de 5 ans minimum.', '5+ years of relevant experience required.']) {
    assert.equal(indeedScopeDecision({ ...source, description }).allowed, false, description);
  }
  for (const description of ['Work with senior engineers and learn from our architect.', 'Our company has 20 years of experience. You will build Python models.']) {
    assert.equal(indeedScopeDecision({ ...source, description }).allowed, true, description);
  }
});

test('Indeed reads actual technical duties and rejects company-blurb, teaching, management and seniority false positives', () => {
  const rejected = [
    { title: 'Supply Chain Quality & Data Engineer', description: "Description de l'entreprise\nWe build machine learning solutions.\nDescription du poste\nAnalyse supplier quality and maintain Excel stock dashboards.\nQualifications\nIndustrial engineering and supply chain knowledge." },
    { title: 'Formateur en Intelligence Artificielle', description: 'Develop artificial intelligence training courses and teach students how to use AI tools.' },
    { title: 'Office assistant', description: 'About the role\nSchedule meetings and prepare invoices.\nAbout us\nWe build machine learning platforms.' },
    { title: 'Chef de Projet Data & IA', description: 'Pilotage du projet. Build data pipelines with the team. Bac+5 avec 8 à 12 ans d’expérience.' },
    { title: 'GLOBAL IT DATA PROFESSIONAL', description: 'We are looking for senior data engineers.\nDesign and build data pipelines.\nRequirements\n8 years of work experience in IT.' },
    { title: 'Data Engineer', description: 'Build data pipelines.\nRequirements:\n5+ years of relevant experience.' }
  ];
  for (const input of rejected) assert.equal(selectSearchMatches({jobs:[{...source,...input}],summary:''},preferences).jobs.length,0,input.title);
  const accepted = [
    { title:'Data Engineer',description:'Build and maintain ETL data pipelines with Python and SQL.' },
    { title:'Junior AI Engineer',description:'Description du poste\nDévelopper des agents IA pour les utilisateurs.\nQualifications\nPrevious internships count as experience.' },
    { title:'Full-stack Developer',description:'Build React interfaces and Node.js APIs for our software product.' },
    { title:'Junior ML Engineer',description:'Train and deploy machine learning models with PyTorch.' },
    { title:'Data Scientist',description:'Build predictive models with Python. Work with senior engineers.' }
  ];
  for (const input of accepted) assert.equal(selectSearchMatches({jobs:[{...source,...input}],summary:''},preferences).jobs.length,1,input.title);
});

test('streamed and final provider ingestion cap Indeed at 100 matches while keeping LinkedIn unrestricted', async () => {
  const saved=[], calls=[];
  const result=await performAutomatedScan({settings:{indeedOpportunityScope:INDEED_MOROCCO_SCOPE},knownJobs:[],
    search:async(p,batch)=>{calls.push(p.jobSite);const jobs=Array.from({length:105},(_,i)=>({...source,url:p.jobSite==='indeed'?'https://www.indeed.com/viewjob?jk='+i.toString(16).padStart(16,'0'):'https://www.linkedin.com/jobs/view/'+(1000+i)+'/'}));batch(jobs.slice(0,60));batch(jobs);return {jobs,summary:'Fixture'};},
    saveJob:j=>{const job={...j,id:String(saved.length)};saved.push(job);return {job,created:true};}});
  assert.deepEqual(calls,['linkedin','indeed']);
  assert.equal(saved.filter(j=>j.url.includes('linkedin')).length,105);
  assert.equal(saved.filter(j=>j.url.includes('indeed')).length,100);
  assert.equal(result.sourceResults.at(-1).limitReached,true);
  assert.equal(result.newJobIds.length,205);
});

test('remote Indeed roles require junior evidence and cannot have known foreign-only eligibility', () => {
  const remote = { ...source, title: 'Junior Data Scientist', location: 'Remote' };
  assert.equal(indeedScopeDecision(remote).allowed, true);
  assert.match(indeedScopeDecision(remote).evidence, /Morocco is unconfirmed/);
  assert.equal(indeedScopeDecision({ ...remote, title: 'Data Scientist' }).allowed, false);
  assert.equal(indeedScopeDecision({ ...remote, title: 'Data Scientist', description: 'We mentor junior engineers.' }).allowed, false);
  assert.equal(indeedScopeDecision({ ...remote, title: 'Data Scientist', description: 'New graduates are welcome. Build predictive models with Python.' }).allowed, true);
  assert.equal(indeedScopeDecision({ ...remote, title: 'Data Scientist', description: 'Débutants acceptés. Développez des modèles Python.' }).allowed, true);
  for (const location of ['Remote, United States', 'Remote, London', 'India (Remote)', 'Remote - Europe']) assert.equal(indeedScopeDecision({ ...remote, location }).allowed, false, location);
  for (const description of ['Applicants must reside in Canada.', 'You must be authorized to work in the United States.', 'Remote worldwide. UK-only.', 'Only open to residents of Germany.', 'United States residents only.']) {
    assert.equal(indeedScopeDecision({ ...remote, description }).allowed, false, description);
  }
  for (const location of ['Remote - EMEA', 'Worldwide remote', 'Remote, Africa']) assert.equal(indeedScopeDecision({ ...remote, location }).allowed, true, location);
  assert.equal(indeedScopeDecision({ ...remote, location: 'Remote, London', description: 'Work from anywhere in the world.' }).allowed, true);
  assert.equal(indeedScopeDecision({ ...remote, location: 'Remote, London', description: 'Our company serves customers worldwide.' }).allowed, false);
});

test('a combined provider scan enforces the saved Indeed scope on streamed and final results while LinkedIn stays unchanged', async () => {
  const seen = [], saved = [];
  await performAutomatedScan({
    settings: { indeedOpportunityScope: INDEED_MOROCCO_SCOPE }, knownJobs: [],
    search: async (prefs, batch) => {
      seen.push(prefs);
      const base = prefs.jobSite === 'indeed' ? source.url : 'https://www.linkedin.com/jobs/view/12345/';
      const jobs = [{ ...source, location: 'Remote', url: base }, { ...source, url: base.replace('12345', '67890').replace('0123456789abcdef', 'abcdef0123456789') }];
      batch(jobs);
      return { jobs, summary: 'Fixture' };
    },
    saveJob: job => { saved.push(job); return { job: { ...job, id: String(saved.length) }, created: true }; }
  });
  assert.deepEqual(seen.map(p => p.jobSite), ['linkedin', 'indeed']);
  assert.ok(seen.every(p => p.indeedOpportunityScope === INDEED_MOROCCO_SCOPE));
  assert.equal(saved.filter(j => j.url.includes('linkedin')).length, 2);
  assert.equal(saved.filter(j => j.url.includes('indeed')).length, 1);
  assert.equal(saved.find(j => j.url.includes('indeed')).location, 'Casablanca');
});

test('Indeed scope reaches both query generators without narrowing LinkedIn or dropping Morocco synonyms', () => {
  const queries = searchQueries(preferences);
  const plan = indeedQueries(preferences);
  const local = plan.filter(task => !task.remote), remote = plan.filter(task => task.remote);
  assert.ok(local.length && remote.length);
  assert.ok(local.some(task => !juniorTitle(new URL(task.url).searchParams.get('q'))));
  assert.ok(remote.every(task => juniorTitle(new URL(task.url).searchParams.get('q'))));
  assert.ok(remote.every(task => new URL(task.url).searchParams.get('q').includes('(Morocco OR worldwide OR EMEA)')));
  assert.ok(local.every(task => new URL(task.url).hostname === 'ma.indeed.com' && new URL(task.url).searchParams.get('l') === 'Morocco'));
  for (const domainTitle of ['Data Scientist', 'Machine Learning Engineer', 'AI Engineer', 'Full Stack Developer', 'Data Engineer']) {
    assert.ok(local.some(task => new URL(task.url).searchParams.get('q') === domainTitle), domainTitle);
    assert.ok(remote.some(task => new URL(task.url).searchParams.get('q').includes(domainTitle)), domainTitle);
  }
  assert.ok(plan.some(task => task.review)); assert.ok(plan.filter(task => !task.review).every(task => new URL(task.url).searchParams.get('fromage') === '30'));
  assert.ok(queries.some(q => q.includes('remote (Morocco OR worldwide OR EMEA)')));
  const linkedin = { ...preferences, jobSite: 'linkedin' };
  assert.deepEqual(searchQueries(linkedin), searchQueries({ ...linkedin, indeedOpportunityScope: undefined }));
  assert.match(discoveryPrompt(preferences), /Indeed scope: include relevant Morocco-based roles/);
  assert.throws(() => indeedScope('invalid'), /valid Indeed/);
});

test('provider and browser matching share the scope; review dates, closures and explicit exclusions remain effective', () => {
  const result = jobs => ({ jobs, summary: 'Fixture' });
  const jobs = [source, { ...source, title: 'Senior Data Scientist' }, { ...source, title: 'Data Scientist', location: 'Remote' }, { ...source, title: 'Junior Data Scientist', location: 'Remote' }, { ...source, title: 'Junior Data Scientist', location: 'Remote - USA' }];
  const selected = selectSearchMatches(result(structuredClone(jobs)), preferences);
  assert.equal(selected.jobs.length, 2); assert.equal(selected.skipped.outsideLocation, 1);
  assert.match(selected.jobs[1].evidence, /Morocco is unconfirmed/);
  assert.equal(selectSearchMatches(result([{ ...source, location: 'Remote' }]), { ...preferences, jobSite: 'linkedin' }).jobs.length, 1);
  assert.equal(selectSearchMatches(result([{ ...source, location: 'Remote' }]), { ...preferences, indeedOpportunityScope: 'preferences' }).jobs.length, 1);
  assert.equal(selectSearchMatches(result([{ ...source, postedAt: '' }]), preferences).jobs[0].discoveryBucket, 'undated-review');
  assert.equal(selectSearchMatches(result([{ ...source, postedAt: '' }]), { ...preferences, includeReview: false }).jobs.length, 0);
  assert.equal(selectSearchMatches(result([{ ...source }]), { ...preferences, excludedUrls: [source.url] }).jobs.length, 0);
  assert.equal(selectSearchMatches(result([{ ...source, availabilityStatus: 'closed' }]), preferences).jobs.length, 0);
});
