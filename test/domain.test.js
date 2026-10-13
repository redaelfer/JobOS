import test from 'node:test';
import assert from 'node:assert/strict';
import { jobUrl, validateJob, matchJob, analyzeResume } from '../lib/domain.js';
test('LinkedIn URLs canonicalize across search, tracking, and slug forms', () => {
  for (const url of ['https://www.linkedin.com/jobs/view/12345/?trackingId=a', 'https://www.linkedin.com/jobs/search/?currentJobId=12345', 'https://uk.linkedin.com/jobs/view/frontend-engineer-12345']) assert.equal(jobUrl(url), 'https://www.linkedin.com/jobs/view/12345/');
});
test('unsafe URLs and invalid job fields are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.org']) assert.throws(() => jobUrl(url));
  assert.throws(() => validateJob({ title: 'Engineer' }));
  assert.throws(() => validateJob({ title: 'Engineer', company: 'Test', stage: 'Fake' }));
  assert.equal(validateJob({ title: ' Engineer ', company: ' Test ' }).title, 'Engineer');
});
test('matching uses keyword OR, location AND, exclusion veto', () => {
  const job = { title: 'Frontend engineer', company: 'Test', location: 'Remote', description: 'React, SQL' };
  assert.equal(matchJob(job, { keywords: 'Python,React', locations: 'Casablanca,Remote' }).matched, true);
  assert.equal(matchJob(job, { keywords: 'Python' }).matched, false);
  assert.equal(matchJob(job, { keywords: 'React', locations: 'Paris' }).matched, false);
  assert.equal(matchJob(job, { keywords: 'React', exclude: 'engineer' }).matched, false);
  assert.equal(matchJob(job, {}).matched, true);
});
test('resume comparison uses skill boundaries and reports no invented score', () => {
  const r = analyzeResume('JavaScript, React and SQL.', 'Java, JavaScript, React, SQL, Docker');
  assert.deepEqual(r.matched, ['javascript', 'react', 'sql']);
  assert.deepEqual(r.missing, ['java', 'docker']);
  assert.equal(r.score, 60);
  assert.equal(analyzeResume('Anything', 'A unique role').score, null);
  assert.deepEqual(analyzeResume('C++ C# go', 'C++ C# go').missing, []);
});
