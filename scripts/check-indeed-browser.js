// Isolated Chromium integration check. No real Indeed requests, accounts or CVs.
// A temporary browser profile maps Indeed ONLY inside this test to a local HTTPS
// fixture, with a pinned test certificate and synthetic sign-in/verification UI.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import https from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import { createApp } from '../server.js';
const dir = await mkdtemp(join(tmpdir(), 'jobos-indeed-check-'));
const key = join(dir, 'fixture.key'), cert = join(dir, 'fixture.crt');
execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=ma.indeed.com'], { stdio: 'ignore', windowsHide: true });
const pem = await readFile(cert), spki = createHash('sha256').update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const visits = [], posting = n => 'https://ma.indeed.com/viewjob?jk=' + String(n).padStart(16, '0');
const fixture = https.createServer({ cert: pem, key: await readFile(key) }, (req, res) => {
  const url = new URL(req.url, 'https://ma.indeed.com'); visits.push(url.pathname);
  let html;
  if (!req.headers.cookie?.includes('fixture=verified')) {
    html = '<title>Additional verification required · synthetic test</title><button id="human">Complete synthetic verification</button><script>document.getElementById("human").onclick=()=>{document.cookie="fixture=verified;path=/;Secure";location.reload()}</script>';
  } else if (url.pathname === '/jobs') {
    const second = url.searchParams.has('start'), ids = second ? [103] : [101,102];
    const next = new URL(url); next.searchParams.set('start', '25');
    html = '<title>Indeed fixture</title><main>' + ids.map(n => `<div class="job_seen_beacon"><a data-jk="${String(n).padStart(16, '0')}" href="${posting(n)}">Junior Data Scientist</a></div>`).join('') + (second ? '' : `<a data-testid="pagination-page-next" href="${next.href.replaceAll('&','&amp;')}">Next</a>`) + '</main>';
  } else if (url.pathname === '/viewjob') {
    const id = Number(url.searchParams.get('jk'));
    html = `<title>Junior Data Scientist</title><div class="jobsearch-JobInfoHeader"><h1 class="jobsearch-JobInfoHeader-title">Junior Data Scientist</h1><div data-testid="inlineHeader-companyName">Fixture Company ${id}</div><div data-testid="inlineHeader-companyLocation">Morocco</div>${id === 102 ? '<div role="alert">No longer accepting applications</div>' : ''}</div><div id="jobDescriptionText">Build machine learning models with Python and SQL for a data science team. This is a synthetic posting.</div><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Junior Data Scientist', datePosted: new Date(Date.now() - 86400000).toISOString(), url: posting(id) })}</script>`;
  } else html = '<title>Not found</title>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const ext = join(dir, 'extension'); await cp(resolve('extension'), ext, { recursive: true });
const manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
// Simulate previously granted permissions, in the disposable copy only.
manifest.host_permissions.push('https://ma.indeed.com/*', 'https://www.indeed.com/*');
await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest));
const calls = [];
const app = createApp({ dbPath: ':memory:', statusChecker: async () => ({ ready: true }), searcher: async prefs => { calls.push(prefs.jobSite); return { jobs: [], summary: 'Synthetic LinkedIn pass completed', warnings: [] }; }, researcher: async () => [] });
app.store.put('settings', { ...app.store.get('settings', 'main'), searchDomains: 'Data science', searchLocation: 'Morocco', searchIncludeReview: false });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const origin = 'http://127.0.0.1:' + app.server.address().port;
await writeFile(join(ext, 'review-worker.js'), (await readFile(join(ext, 'review-worker.js'), 'utf8')).replace('http://127.0.0.1:4317', origin));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless', '--no-first-run', '--disable-gpu', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + join(dir, 'profile'), '--disable-extensions-except=' + ext, '--no-proxy-server', '--host-resolver-rules=MAP ma.indeed.com 127.0.0.1:' + fixture.address().port + ',MAP www.indeed.com 127.0.0.1:' + fixture.address().port, '--ignore-certificate-errors-spki-list=' + spki, '--load-extension=' + ext, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
try {
  let entry;
  for (let i = 0; i < 120 && !entry; i++) { try { entry = (await readFile(join(dir, 'profile', 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); } catch { await delay(150); } }
  assert.ok(entry, 'Isolated browser opened');
  ws = new WebSocket('ws://127.0.0.1:' + entry[0] + entry[1]); await once(ws, 'open');
  let seq = 0; const pending = new Map();
  const call = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; const timeout = setTimeout(() => { pending.delete(id); no(Error('CDP timeout: ' + method)); }, 15000); pending.set(id, { ok, no, timeout }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (!m.id) return; const p = pending.get(m.id); if (!p) return; clearTimeout(p.timeout); pending.delete(m.id); m.error ? p.no(Error(m.error.message)) : p.ok(m.result); };
  const targets = async () => (await call('Target.getTargets')).targetInfos;
  const attach = async target => (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  const session = await attach((await targets()).find(t => t.type === 'page'));
  const js = async (expression, sessionId = session) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
  const wait = async (predicate, label) => { for (let i = 0; i < 220; i++) { if (await predicate()) return; await delay(200); } throw Error(label); };
  await call('Page.navigate', { url: origin + '/#pipeline' }, session);
  await wait(() => js("document.documentElement.dataset.jobosIndeedSearch==='1' && !!document.querySelector('[data-action=scan-now]')"), 'extension setup');
  await js("document.querySelector('[data-action=scan-now]').click()");
  await wait(() => app.store.list('indeedBrowserRuns').length > 0, 'LinkedIn handoff');
  const run = app.store.list('indeedBrowserRuns')[0];
  // One generated query suffices to exercise two real pages and the end transition.
  // Unlimited domain/query coverage is exercised separately by unit tests.
  app.store.put('indeedBrowserRuns', { ...run, queue: run.queue.slice(0, 1) });
  await wait(() => app.store.get('scans', run.id).status === 'paused', 'verification pauses');
  assert.deepEqual(calls, ['linkedin']); assert.equal(app.store.list('jobs').length, 0);
  const postingTarget = (await targets()).find(t => t.url.startsWith('https://ma.indeed.com/jobs'));
  assert.ok(postingTarget); const postingSession = await attach(postingTarget);
  // This clicks our fake verification button, never a real site's challenge.
  await js("document.querySelector('#human').click()", postingSession);
  const controller = (await targets()).find(t => /indeed\.html(?:\?[^#]*)?#/.test(t.url)); assert.ok(controller);
  const controlSession = await attach(controller);
  await wait(() => js("!document.querySelector('#resume').disabled", controlSession), 'resume enabled');
  // Exercise JobOS-side resume too: a fresh ticket must reload/reuse this controller,
  // rather than opening another active search or leaving its module on the old ticket.
  await js("document.querySelector('[data-action=refresh-status]').click()");
  await wait(() => js("!!document.querySelector('[data-action=indeed-resume]')"), 'workspace resume shown');
  await js("document.querySelector('[data-action=indeed-resume]').click()");
  try { await wait(() => app.store.get('scans', run.id).status === 'completed', 'browser search completed'); }
  catch (error) {
    console.error(JSON.stringify({ phase: app.store.get('scans', run.id).phase, status: app.store.get('scans', run.id).status, controller: await js("document.querySelector('#status')?.textContent", controlSession), visits, pages: (await targets()).filter(t => t.type === 'page').map(t => new URL(t.url).pathname) }));
    throw error;
  }
  assert.equal((await targets()).filter(t => /indeed\.html(?:\?[^#]*)?#/.test(t.url)).length, 1);
  assert.equal((await targets()).find(t => /indeed\.html(?:\?[^#]*)?#/.test(t.url)).targetId, controller.targetId);
  const jobs = app.store.list('jobs'); assert.equal(jobs.length, 2);
  assert.ok(jobs.every(j => j.source === 'Indeed browser' && j.postingUrl.startsWith('https://ma.indeed.com/')));
  assert.ok(jobs.some(j => j.url.endsWith('0000000000000103')));
  assert.ok(!jobs.some(j => j.url.endsWith('0000000000000102')));
  assert.equal(app.store.get('scans', run.id).sourceResults.at(-1).jobCount, 2);
  await js("document.querySelector('[data-action=refresh-status]').click()");
  await wait(() => js("document.querySelectorAll('#jobs-area .offer-link').length===2"), 'saved offers in UI');
  assert.equal(await js("document.querySelector('#job-count').textContent"), '2');
  assert.ok(await js("!document.querySelector('#main').innerText.includes('Search in progress')"));
  assert.equal(await js("document.querySelector('.offer-link').hostname"), 'ma.indeed.com');
  await mkdir('test-results', { recursive: true });
  await call('Page.bringToFront', {}, session);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
  await delay(500);
  const png = await call('Page.captureScreenshot', { format: 'png' }, session);
  await writeFile('test-results/indeed-browser.png', Buffer.from(png.data, 'base64'));
  console.log('PASS Edge: Search now → LinkedIn → real extension → synthetic verification pause/resume → 2 pages → 2 saved roles, closed role skipped, regional links retained. No live Indeed or candidate data used.');
} finally {
  fixture.closeAllConnections(); fixture.close(); ws?.close(); edge.kill();
  app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); app.store.db.close();
}
