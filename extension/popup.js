import { extractLinkedInJob } from './extract.js';
const status = document.querySelector('#status'), form = document.querySelector('#capture');
function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
async function capture() {
  const button = document.querySelector('#save'); button.disabled = true;
  try {
    message('Reading the selected job…');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let result, error;
    for (let attempt = 0; attempt < 4; attempt++) {
      [{ result, error }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinkedInJob });
      if (error || (result?.title && result?.company && result?.description)) break;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 600));
    }
    if (error || !result) throw new Error(error?.message || 'Could not read this job. Open a LinkedIn job, or fill the fields manually.');
    for (const [key, value] of Object.entries(result)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    const missing = ['title', 'company', 'description'].filter(key => !result[key]);
    message(missing.length ? `Could not read ${missing.join(', ')}. Open the full job page, wait for it to load, and click “Capture current job again”. You can also fill the missing fields.` : 'Job captured. Review the details, then save.', missing.length > 0);
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
}
const saved = await chrome.storage.local.get(['endpoint', 'token']);
document.querySelector('#connection').elements.endpoint.value = saved.endpoint || 'http://127.0.0.1:4317';
document.querySelector('#connection').elements.token.value = saved.token || '';
if (!saved.token) document.querySelector('details').open = true;
document.querySelector('#retry').addEventListener('click', capture);
document.querySelector('#connection').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(e.target)), url = new URL(values.endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) throw new Error('Use the local JobOS address (http://127.0.0.1:4317).');
    await chrome.storage.local.set({ endpoint: url.origin, token: values.token.trim() }); message('Connection saved.'); document.querySelector('details').open = false;
  } catch (error) { message(error.message, true); }
});
form.addEventListener('submit', async e => {
  e.preventDefault(); const button = document.querySelector('#save'); button.disabled = true;
  try {
    const config = await chrome.storage.local.get(['endpoint', 'token']);
    if (!config.token) throw new Error('Add your pairing token in Connection settings first.');
    const res = await fetch(`${config.endpoint || 'http://127.0.0.1:4317'}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobOS-Token': config.token }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), source: 'LinkedIn extension' }), signal: AbortSignal.timeout(10000) });
    const result = await res.json(); if (!res.ok) throw new Error(result.error);
    message(result.skipped ? result.reason : result.created ? 'Saved to your JobOS workspace.' : result.updated ? 'Added captured details to your imported opportunity.' : 'This opportunity is already saved.');
  } catch (error) { message(error.message === 'Failed to fetch' ? 'Cannot reach JobOS. Start the server and check the address.' : error.message, true); }
  finally { button.disabled = false; }
});
await capture();
