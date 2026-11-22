import { readIndeedPage } from './indeed-reader.js';
import { isClosureNotice } from './closure-notice.js';
const params = new URLSearchParams(location.hash.slice(1)), app = new URL(params.get('app'));
if (app.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(app.hostname)) throw Error('Invalid JobOS address.');
const ticket = params.get('ticket'), origins = ['https://ma.indeed.com/*', 'https://www.indeed.com/*'];
const el = id => document.getElementById(id), delay = ms => new Promise(r => setTimeout(r, ms));
el('return').href = app.origin + '/#pipeline';
let tabId, currentTaskId, currentTask, working = false, paused = false, done = false;
async function step(action, data = {}, keepalive = false) {
  const r = await fetch(app.origin + '/api/indeed/browser', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobOS-Search': ticket }, body: JSON.stringify({ action, ...data }), keepalive, signal: keepalive ? undefined : AbortSignal.timeout(15000) });
  const result = await r.json(); if (!r.ok) throw Error(result.error || 'JobOS could not continue Indeed.'); return result;
}
async function closeOwnedTab() { if (tabId !== undefined) { const id = tabId; tabId = undefined; await chrome.tabs.remove(id).catch(() => {}); } }
function controls() { el('resume').hidden = !paused || done; el('resume').disabled = working; el('skip').hidden = !paused || done || !currentTask; el('skip').disabled = working; el('pause').hidden = paused || done; el('open').hidden = tabId === undefined; }
async function stop(message) {
  paused = true; await step('pause').catch(() => {});
  el('status').textContent = message || 'Paused. Resume here when ready.'; controls();
}
async function inspect(task) {
  if (tabId !== undefined) { try { await chrome.tabs.get(tabId); } catch { tabId = undefined; } }
  if (tabId === undefined) { tabId = (await chrome.tabs.create({ url: task.url, active: false })).id; currentTaskId = task.id; }
  else if (currentTaskId !== task.id) { await chrome.tabs.update(tabId, { url: task.url }); currentTaskId = task.id; }
  controls();
  const deadline = Date.now() + 30000; let last;
  while (!paused && Date.now() < deadline) {
    await delay(1500);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') continue;
    // Do not inject on a redirect to a different site, even if separately permitted.
    if (!/^https:\/\/(?:ma|www)\.indeed\.com\//.test(tab.url || '')) return { attention: 'wrong_page' };
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: readIndeedPage, args: [task] });
    last = result;
    if (last?.blocked || last?.ready || last?.attention) {
      if (last.job) last.job.closed = last.notices?.some(isClosureNotice) || false;
      return last;
    }
  }
  // Unexpected layouts are paused, not interpreted as zero vacancies.
  return { attention: last ? 'unsupported_layout' : 'load_timeout', missing: last?.missing || [] };
}
async function run(resume = false, skip = false) {
  if (working || done) return;
  working = true; paused = false; controls();
  try {
    let next = await step(resume ? 'resume' : 'next');
    if (skip && next.task) next = await step('result', { taskId: next.task.id, url: next.task.url, unreadable: true, links: [] });
    while (!paused && next.task && next.status === 'running') {
      currentTask = next.task;
      el('status').textContent = `Indeed: ${next.checked} posting pages checked · ${next.saved} matching offers saved. Reading ${next.task.type === 'listing' ? 'search results' : 'a posting'}…`;
      const result = await inspect(next.task);
      if (paused) break;
      next = await step('result', { taskId: next.task.id, ...result });
    }
    if (next.done) { done = true; await closeOwnedTab(); el('status').textContent = next.reason || 'Indeed search finished. Your results are saved in JobOS.'; }
    else if (!paused) { paused = true; el('status').textContent = next.reason || 'Paused. Open Indeed, then Resume when ready.'; }
  } catch (e) { await stop(e.message + ' Your saved offers and cursor are kept.'); }
  finally { working = false; controls(); }
}
el('open').onclick = () => chrome.tabs.update(tabId, { active: true }).catch(() => stop('Indeed tab was closed. Resume to reopen it.'));
el('pause').onclick = () => stop();
el('resume').onclick = () => run(true);
el('skip').onclick = () => run(true, true);
el('allow').onclick = async () => {
  try { if (await chrome.permissions.request({ origins })) { el('allow').hidden = true; await run(true); } else await stop('Indeed permission was declined. Allow access to continue.'); }
  catch (e) { await stop(e.message); }
};
setInterval(() => { if (!done && !paused) step('heartbeat').then(r => { if (r.done) { done = true; closeOwnedTab(); el('status').textContent = 'This search was stopped in JobOS.'; controls(); } }).catch(() => stop('Connection to JobOS lost. Resume after the server is running.')); }, 15000);
window.addEventListener('pagehide', () => { if (!done) step('pause', {}, true).catch(() => {}); closeOwnedTab(); });
if (await chrome.permissions.contains({ origins })) run();
else { await stop('Allow this extension to read Indeed in your browser. This is a one-time browser permission.'); el('allow').hidden = false; el('resume').hidden = true; }
