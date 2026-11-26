import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesDomains } from '../lib/search-policy.js';
import { searchQueries } from '../lib/web-search.js';
import { discoveryPrompt } from '../lib/discovery.js';
import { performAutomatedScan } from '../lib/automation.js';

const domains = ['AI engineering', 'Machine learning', 'Data science', 'Full-stack development', 'Data engineering'];
const preferences = { domains, location:'Morocco and remote roles', level:'Graduate / Entry level', includeEmployerSites:true };

test('domain matching accepts English and French titles and role responsibilities', () => {
  for (const [domain, title, description = ''] of [
    ['Data science', 'Junior Data Scientist'], ['Data science', 'Scientifique des données'],
    ['Data engineering', 'Analytics Engineer'], ['Data engineering', 'Ingénieure des données'],
    ['Data engineering', 'Développeur ETL'], ['Data engineering', 'Software Engineer', 'Build data pipelines.'],
    ['Data science', 'Chargée d’études', 'Développement de modèles prédictifs'],
    ['AI engineering', 'Ingénieur IA'], ['AI engineering', 'Software Engineer', 'Build NLP services'],
    ['Machine learning', 'MLOps Engineer'], ['Machine learning', 'Ingénieur vision par ordinateur'],
    ['Full-stack development', 'Développeuse full‑stack'], ['Full-stack development', 'Ingénieur études et développement', 'Services Spring Boot et interfaces React'],
  ]) assert.ok(matchesDomains({title,description}, [domain]), title);
  assert.equal(matchesDomains({title:'Office assistant',description:'J’ai besoin de rigueur.'},domains),false);
  assert.equal(matchesDomains({title:'Talent Acquisition Specialist',description:'Recruit data scientists and ML engineers.'},domains),false);
  assert.equal(matchesDomains({title:'Data Entry Clerk',description:'Enter invoices in a database.'},domains),false);
});

test('both sites search all five fields early, including ordinary and junior titles in English and French', () => {
  for (const jobSite of ['linkedin','indeed']) {
    const queries = searchQueries({...preferences,jobSite,resume:'PRIVATE_FIXTURE_CV'});
    const primary = ['AI Engineer','Machine Learning Engineer','Data Scientist','Full Stack Developer','Data Engineer'];
    assert.ok(primary.every((role,i)=>queries[i].startsWith('junior '+role+' ')));
    assert.ok(primary.every((role,i)=>queries[primary.length+i].startsWith(role+' ')));
    for (const role of primary) {
      assert.ok(queries.some(q=>q.startsWith('junior '+role+' ')), role);
      assert.ok(queries.some(q=>q.startsWith(role+' remote ')), role);
    }
    for(const alias of ['Ingénieur IA','Ingénieur machine learning','Science des données','Développeur full stack', 'Ingénieur données']) {
      assert.ok(queries.some(q=>q.startsWith(alias+' ')), alias);
      assert.ok(discoveryPrompt({...preferences,jobSite}).includes(alias));
    }
    assert.ok(queries.every(q=>!q.includes('PRIVATE_FIXTURE_CV')));
  }
});

test('using AI tools in a communications role is not AI engineering, but technical work on those products remains eligible', () => {
  for (const job of [
    { title: 'Chargé(e) de communication', description: 'Créer du contenu de communication. Analyser les indicateurs. Bac + 5 junior en communication. Aisance avec les outils d’intelligence artificielle.' },
    { title: 'Community Manager', description: 'Develop social media content with generative AI tools.' },
    { title: 'AI Content Creator', description: 'Write promotional articles and manage online communications.' },
    { title: 'Account Executive, AI', description: 'Sell our machine learning and data science products.' },
    { title: 'Assistant administratif', description: 'Aisance avec les outils d’intelligence artificielle et les outils digitaux.' },
    { title: 'Project assistant', description: 'Our company builds AI products.\nCreate newsletters and coordinate meetings.' }
  ]) assert.equal(matchesDomains(job, domains), false, job.title);
  for (const job of [
    { title: 'AI Engineer', description: 'Build models for communication products.' },
    { title: 'Data Scientist, Marketing', description: 'Analyse data and build predictive models.' },
    { title: 'Software Engineer, Marketing Platform', description: 'Build machine learning services with Python.' },
    { title: 'Ingénieur IA', description: 'Développer des solutions de communication.' },
    { title: 'Software Engineer', description: 'Build NLP services for customers.' },
    { title: 'Ingénieur études et développement', description: 'Développer des modèles de machine learning pour les utilisateurs.' },
    { title: 'Développeur full stack', description: 'Utiliser React et Node.js pour notre outil de communication.' }
  ]) assert.equal(matchesDomains(job, domains), true, job.title);
});

test('closing one posting preserves another same-title opportunity from the same company even below the fit threshold', async () => {
  const posting = {title:'Data Scientist',company:'FixtureCo',stage:'Saved',postedAt:'1 day ago',description:'Développer et évaluer des modèles prédictifs sur des données de production.',verification:'Title and company found on public posting'};
  const closed = {...posting,id:'closed',stage:'Closed',url:'https://www.linkedin.com/jobs/view/701/'};
  const fresh = {...posting,id:'fresh',url:'https://www.linkedin.com/jobs/view/702/'};
  const result=await performAutomatedScan({
    settings:{searchDomains:domains.join(', '),resume:'Synthetic candidate with software engineering experience.',minimumFit:90},
    knownJobs:[closed],searchSite:'linkedin',
    search:async p=>{
      assert.ok(p.excludedUrls.includes(closed.url)); assert.ok(!p.excludedUrls.includes(fresh.url));
      return {summary:'Two source listings',jobs:[{...posting,url:'https://ma.linkedin.com/jobs/view/data-scientist-701/?trk=test'},fresh]};
    }, saveJob:j=>({created:true,job:j}), research:async()=>[], saveCompany:()=>{},
    rank:async({jobs})=>({summary:'Compared',rankings:jobs.map(j=>({jobId:j.id,score:40}))})
  });
  assert.deepEqual(result.newJobIds,['fresh']); assert.equal(result.report, undefined);
});
