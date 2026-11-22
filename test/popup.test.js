import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { captureJob, captureSource } from '../extension/capture-reader.js';

test('real popup fills Indeed fields and saves the reviewed offer with the Indeed source', async t => {
  const url = 'https://ma.indeed.com/viewjob?jk=0000000000000001';
  const posting = new JSDOM('<h5 data-testid="vj-job-title">Junior AI Engineer</h5><div data-testid="company-info-metadata"><a href="/cmp/Fixture">Fixture</a>\n<div>Casablanca</div></div><div data-testid="viewjob-job-content"><div class="simple-job-description-html">Build machine learning applications with Python and SQL in our engineering team.</div></div>', { url, runScripts: 'outside-only' });
  posting.window.HTMLElement.prototype.getClientRects = () => [{}];
  const popup = new JSDOM(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'), { url: 'http://127.0.0.1/popup.html' });
  t.after(() => { posting.window.close(); popup.window.close(); });
  const chrome = { tabs: { query: async () => [{ id: 7, url }] }, storage: { local: { get: async () => ({ endpoint: 'http://127.0.0.1:4317', token: 'synthetic-pairing-token' }) } }, scripting: { executeScript: async ({ func, args, target }) => {
    assert.equal(target.tabId, 7);
    return [{ result: posting.window.eval('(' + func.toString() + ')')(...args) }];
  } } };
  let request;
  const fetch = async (address, options) => { request = { address, options }; return { ok: true, json: async () => ({ created: true }) }; };
  const code = readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('chrome', 'captureJob', 'captureSource', 'document', 'FormData', 'fetch', code)(chrome, captureJob, captureSource, popup.window.document, popup.window.FormData, fetch);
  const form = popup.window.document.querySelector('#capture');
  assert.equal(form.elements.title.value, 'Junior AI Engineer');
  assert.equal(form.elements.company.value, 'Fixture');
  assert.equal(form.elements.location.value, 'Casablanca');
  assert.equal(form.elements.url.value, url);
  assert.match(form.elements.description.value, /Python and SQL/);
  assert.match(popup.window.document.querySelector('#status').textContent, /Job captured/);
  form.dispatchEvent(new popup.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && !request; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(request.address, 'http://127.0.0.1:4317/api/capture');
  assert.equal(JSON.parse(request.options.body).source, 'Indeed extension');
  assert.equal(JSON.parse(request.options.body).title, 'Junior AI Engineer');
});
