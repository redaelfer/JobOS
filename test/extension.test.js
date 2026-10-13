import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractLinkedInJob } from '../extension/extract.js';
import { readFileSync } from 'node:fs';
function extract(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  try { return JSON.parse(JSON.stringify(dom.window.eval(`(${extractLinkedInJob.toString()})()`))); } finally { dom.window.close(); }
}
test('extension extracts an authenticated LinkedIn job detail fixture', () => {
  const job = extract('<div class="job-details-jobs-unified-top-card__job-title"><h1>React Engineer</h1></div><div class="job-details-jobs-unified-top-card__company-name">Example</div><div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">Remote</span></div><div class="jobs-description__content">React and SQL</div>', 'https://www.linkedin.com/jobs/search/?currentJobId=987');
  assert.equal(job.title, 'React Engineer'); assert.equal(job.company, 'Example'); assert.equal(job.location, 'Remote'); assert.equal(job.description, 'React and SQL'); assert.equal(job.url, 'https://www.linkedin.com/jobs/view/987/');
});
test('extension falls back to structured JobPosting metadata', () => {
  const job = extract('<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Build things</p>","jobLocation":{"address":{"addressLocality":"Rabat"}}}]}</script>', 'https://www.linkedin.com/jobs/view/engineer-678/');
  assert.equal(job.title, 'Engineer'); assert.equal(job.company, 'Acme'); assert.equal(job.description, 'Build things'); assert.equal(job.location, 'Rabat');
});
test('extension rejects wrong hosts and pages without a selected job', () => {
  assert.throws(() => extract('<h1>No</h1>', 'https://linkedin.com.evil.test/jobs/view/5/'), /specific LinkedIn job/);
  assert.throws(() => extract('<h1>No</h1>', 'https://www.linkedin.com/feed/'), /specific LinkedIn job/);
});
test('extension ignores invalid JSON and supports public-page selectors', () => {
  const j = extract('<script type="application/ld+json">{broken</script><h1 class="top-card-layout__title">Developer</h1><a class="topcard__org-name-link">Acme</a><span class="topcard__flavor--bullet">Paris</span>', 'https://fr.linkedin.com/jobs/view/12/');
  assert.equal(j.title, 'Developer'); assert.equal(j.location, 'Paris');
});
test('extension requests only user-triggered page access and local endpoint access', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3); assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']); assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.host_permissions.every(h => /localhost|127\.0\.0\.1/.test(h)));
});
test('new LinkedIn layout captures a semantic h2 title, company and location without legacy classes', () => {
  const job = extract(`<main><aside><h2>Jobs based on your preferences</h2><ul><li><h2>Wrong recommendation</h2><a href="/company/wrong/">Wrong Company</a></li></ul></aside><article><div><a href="/company/orange-business/">Orange Business</a><h2>Data Engineer</h2><p>Salé El Jadida, Rabat-Salé-Kénitra, Morocco · 5 days ago · Over 100 people clicked apply</p><button>Apply</button></div><section><h2>About the job</h2><p>Build production data pipelines with Python, SQL and Spark. Work with a team of data engineers on reliable cloud infrastructure.</p></section></article></main>`, 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4472945902');
  assert.equal(job.title, 'Data Engineer'); assert.equal(job.company, 'Orange Business'); assert.equal(job.location, 'Salé El Jadida, Rabat-Salé-Kénitra, Morocco'); assert.match(job.description, /Python, SQL and Spark/); assert.ok(!job.description.includes('Wrong recommendation'));
});
test('hidden headings are skipped and French job description sections are captured', () => {
  const job = extract('<main><h1 hidden>Wrong hidden job</h1><article><div><a href="/company/acme/">Acme</a><h2>Ingénieur IA</h2><span>Rabat, Maroc · il y a 3 jours · 20 candidats</span><button>Postuler</button></div><section><h3>À propos de l’offre</h3><p>Nous recherchons un ingénieur spécialisé en intelligence artificielle, Python et systèmes multi-agents.</p></section></article></main>', 'https://www.linkedin.com/jobs/view/654/');
  assert.equal(job.title, 'Ingénieur IA'); assert.equal(job.location, 'Rabat, Maroc'); assert.match(job.description, /multi-agents/);
});
test('LinkedIn global notification heading is never used as the job title', () => {
  const j = extract('<h1>0 notifications</h1><main><article><a href="/company/orange-business/">Orange Business</a><h2>Data Engineer</h2><button>Apply</button><section><h2>About the job</h2><p>Develop reliable data pipelines using Python, SQL and Spark in a production engineering team.</p></section></article></main>', 'https://www.linkedin.com/jobs/view/4472945902/');
  assert.equal(j.title, 'Data Engineer'); assert.equal(j.company, 'Orange Business');
});
test('feedback headings are excluded from job-title detection', () => {
  const j = extract('<main><h2>Are these results helpful?</h2><article><a href="/company/orange-business/">Orange Business</a><h2>Data Engineer</h2><button>Apply</button></article></main>', 'https://www.linkedin.com/jobs/view/4472945902/'); assert.equal(j.title, 'Data Engineer');
});
