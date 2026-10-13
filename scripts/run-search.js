import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${process.env.PORT || 4317}/api/`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getState() { const res = await fetch(base + 'state', { signal: AbortSignal.timeout(5000) }); if (!res.ok) throw new Error('Workspace is unavailable.'); return res.json(); }
let state;
try { state = await getState(); }
catch {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', resolve(project, 'server.js')], { cwd: project, detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
  for (let attempt = 0; attempt < 15; attempt++) { await pause(1000); try { state = await getState(); break; } catch {} }
  if (!state) throw new Error('Could not start JobOS. Run npm.cmd start in the project folder.');
}
const headers = { 'Content-Type': 'application/json', 'X-JobOS-Token': state.settings.token };
const start = await fetch(base + 'codex/scan', { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20000) });
const started = await start.json();
if (start.status === 409) { console.log(JSON.stringify({ skipped: true, reason: 'Codex is already processing a search or ranking.' })); process.exit(0); }
if (!start.ok) throw new Error(started.error || 'Manual search could not start.');
console.log(JSON.stringify({ scanId: started.id, status: 'running' }));
const deadline = Date.now() + 45 * 60000;
while (Date.now() < deadline) {
  await pause(5000);
  const response = await fetch(base + `codex/scan/${started.id}`, { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Could not read search status.');
  const run = await response.json();
  if (run.status === 'running') continue;
  if (run.status === 'failed') throw new Error(run.error);
  const latest = await getState();
  const previousMatches = new Set((state.opportunities?.items || []).filter(j => j.recommended).map(j => j.jobId));
  const newMatches = (latest.opportunities?.items || []).filter(j => j.recommended && !previousMatches.has(j.jobId));
  const previousContacts = new Set(state.contacts.map(c => `${c.company}|${c.name}|${c.email}|${c.linkedin}`));
  const newContacts = latest.contacts.filter(c => !previousContacts.has(`${c.company}|${c.name}|${c.email}|${c.linkedin}`));
  console.log(JSON.stringify({ status: run.status, newJobs: run.newJobIds.length, newJobIds: run.newJobIds, companiesResearched: run.companiesResearched, rankingId: run.rankingId, newRelevantJobs: newMatches.map(j => ({ id: j.jobId, title: j.title, company: j.company, url: j.url, score: j.score })), newContactCount: newContacts.length, pendingDescriptions: run.pendingDescriptions, pendingRankings: run.pendingRankings, warnings: run.warnings, summary: run.summary, feedUrl: base.replace('/api/', '/#daily') }));
  process.exit(0);
}
throw new Error('The scan is still running. Check its status in JobOS.');
