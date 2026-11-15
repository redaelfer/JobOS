import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPostingAvailability } from '../lib/availability.js';

const linkedin = 'https://www.linkedin.com/jobs/view/125/';
const employer = 'https://careers.example.org/jobs/data-engineer';
const indeed = 'https://www.indeed.com/viewjob?jk=abcdef1234567890';
const check = (url, body, options = {}) => checkPostingAvailability({ url, title: 'Data Engineer', company: 'Sample Co' }, async () => ({
  url: options.finalUrl || url, text: `<html><head>${options.head || ''}</head><body><main>${body}</main></body></html>`
}));
test('review quotes the public closure notice in English and French across posting sources', async () => {
  for (const [url, evidence] of [[linkedin, 'No longer accepting applications'], [linkedin, 'Les candidatures ne sont plus acceptées'], [indeed, 'This job has expired on Indeed'], [employer, 'Cette offre d’emploi n’est plus disponible.']]) {
    assert.deepEqual(await check(url, `<h1>Data Engineer</h1><p>Sample Co</p><div role="alert">${evidence}</div>`), { status: 'closed', evidence });
  }
  assert.equal((await check(employer, '<h1>This job has been filled</h1>')).status, 'closed');
});
test('review keeps inaccessible pages, changed URLs and ambiguous page content out of the close list', async () => {
  const details = '<h1>Data Engineer</h1><p>Sample Co</p>';
  const closed = '<span>No longer accepting applications</span>';
  assert.equal((await check(linkedin, details + '<button>Apply</button>')).status, 'noNotice');
  assert.equal((await check(linkedin, details + '<p>We are not accepting applications from staffing agencies.</p>')).status, 'noNotice');
  assert.equal((await check(linkedin, details + `<aside>${closed}</aside><div hidden>${closed}</div><div class="description__text">${closed}</div>`)).status, 'noNotice');
  assert.equal((await check(linkedin, details + closed, { finalUrl: linkedin.replace('125', '887') })).status, 'unknown');
  assert.equal((await check(linkedin, details + closed, { head: '<link rel="canonical" href="/jobs/">' })).status, 'unknown');
  assert.equal((await check(linkedin, closed, { head: '<title>Sign in | LinkedIn</title>' })).status, 'unknown');
  assert.equal((await check(indeed, details + closed + '<p>Verify you are human</p>')).status, 'unknown');
  assert.equal((await check(employer, '<h1>Careers</h1><p>Join our team</p>')).status, 'unknown');
  assert.equal((await checkPostingAvailability({ url: linkedin }, async () => { throw Error('HTTP 403'); })).status, 'unknown');
});
