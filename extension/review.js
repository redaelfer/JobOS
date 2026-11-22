import { readRenderedPosting } from './rendered-posting.js';
import { isClosureNotice } from './closure-notice.js';

const params = new URLSearchParams(location.hash.slice(1));
const app = new URL(params.get('app'));
if (app.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(app.hostname)) throw Error('Invalid JobOS address.');
const ticket = params.get('ticket');
const status = document.querySelector('#status'), allow = document.querySelector('#allow'), resultLink = document.querySelector('#return');
resultLink.href = app.origin + '/#pipeline';
resultLink.hidden = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let tabId, finished = false, origins;
async function step(action, data = {}, keepalive = false) {
  const response = await fetch(app.origin + '/api/availability-check/browser', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobOS-Review': ticket },
    body: JSON.stringify({ action, ...data }), keepalive
  });
  if (!response.ok) throw Error('JobOS could not continue this review. Return to Applications to continue.');
  return response.json();
}
async function closeTab() {
  if (tabId !== undefined) {
    const id = tabId;
    tabId = undefined;
    await chrome.tabs.remove(id).catch(() => {});
  }
}
async function inspect(job) {
  const tab = await chrome.tabs.create({ url: job.navigationUrl || job.url, active: false });
  tabId = tab.id;
  const deadline = Date.now() + 25000;
  let identifiedSince = 0;
  while (Date.now() < deadline) {
    await pause(650);
    const current = await chrome.tabs.get(tab.id);
    if (current.status !== 'complete') { identifiedSince = 0; continue; }
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readRenderedPosting, args: [job] });
    const evidence = result?.lines.find(isClosureNotice);
    if (evidence) return { status: 'closed', evidence };
    if (!result?.identified) { identifiedSince = 0; continue; }
    identifiedSince ||= Date.now();
    if (Date.now() - identifiedSince >= 5500) return { status: 'noNotice' };
  }
  return { status: 'unknown' };
}
async function run() {
  allow.hidden = true;
  document.querySelector('#sites').textContent = '';
  let next = await step('next');
  while (next.job) {
    status.textContent = `Checking ${next.index + 1} of ${next.total}: ${next.job.title} · ${next.job.company}`;
    let outcome;
    try { outcome = await inspect(next.job); }
    catch { outcome = { status: 'unknown' }; }
    finally { await closeTab(); }
    next = await step('result', { index: next.index, jobId: next.job.jobId, ...outcome });
  }
  finished = true;
  status.textContent = next.status === 'completed' ? 'Check complete. Review the unavailable offers in JobOS.' : 'This review has stopped. Open JobOS to continue.';
}
async function stopped(error) {
  allow.hidden = true;
  await closeTab();
  await step('pause').catch(() => {});
  finished = true;
  status.textContent = error.message;
}
async function initialize() {
  const plan = await step('plan');
  if (plan.status !== 'running') return run();
  origins = plan.origins;
  if (await chrome.permissions.contains({ origins })) return run();
  status.textContent = 'Allow JobOS to read the application status on these saved posting sites. Keep this tab open during the check.';
  document.querySelector('#sites').textContent = origins.map(origin => new URL(origin).hostname).join(', ');
  allow.hidden = false;
}
allow.addEventListener('click', async () => {
  allow.disabled = true;
  try {
    if (!await chrome.permissions.request({ origins })) throw Error('Site access was declined. Return to JobOS to continue when ready.');
    await run();
  } catch (error) { await stopped(error); }
});
// The browser permission prompt can stay open while the user reads it.
setInterval(() => {
  if (!finished && !allow.hidden) step('plan').catch(stopped);
}, 30000);
window.addEventListener('pagehide', () => {
  if (!finished) { step('pause', {}, true).catch(() => {}); closeTab(); }
});
initialize().catch(stopped);
