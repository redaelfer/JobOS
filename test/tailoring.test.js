import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { createApp } from '../server.js';
import { validateLatex, starterLatex, sourceHash, cvWorkspace, validateTailoring, tailoringPrompt } from '../lib/tailoring.js';
import { tailorWithCodex } from '../lib/codex.js';
import { applicationContacts, searchNowButton } from '../public/application-tools.js';
import { tailoringPage, tailoringResult, emailDraftUrl } from '../public/tailoring-view.js';
const source = () => starterLatex('Synthetic Person\nPython and SQL engineer\nBuilt tested data pipelines with a 23% improvement.');
const output = () => ({ latex: source(), replacements: [], email: { subject: 'Data engineer application', body: 'Hello hiring team, I am interested in the role. My experience includes Python and SQL.' }, changes: ['Emphasized existing data experience'], questions: ['Confirm role availability and compensation'] });
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jobos-tailoring-'));
  const app = createApp({ dbPath: ':memory:', cvPath: join(dir, 'main.tex'), artifactRoot: join(dir, 'applications'), hydrator: async () => [], statusChecker: async () => ({ ready: true }), tailorer: async () => output(), latexCompiler: async () => ({ compilation: 'unavailable', compilationMessage: 'Not configured in fixture' }), ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.db.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`, headers = { 'X-JobOS-Token': app.store.get('settings', 'main').token, 'Content-Type': 'application/json' };
  const request = async (path, method = 'GET', body, custom = headers) => { const res = await fetch(base + '/api/' + path, { method, headers: custom, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); let value; try { value = JSON.parse(text); } catch { value = text; } return { status: res.status, body: value }; };
  const job = app.ingest({ title: 'Data Engineer', company: 'Acme', description: 'Build tested Python and SQL data pipelines in the engineering team.', url: 'https://example.com/jobs/data' }).job;
  return { ...app, request, job, dir };
}
async function waitRun(request, id) { for (let i = 0; i < 50; i++) { const result = await request('codex/tailor/' + id); if (result.body.status !== 'running') return result.body; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Draft did not finish'); }

test('standalone LaTeX validation preserves escaped facts and rejects external/executable input', () => {
  assert.match(validateLatex(source()), /23\\%/);
  for (const command of ['\\input{secret}', '\\includegraphics{photo}', '\\write18{cmd}', '\\directlua{code}', '\\csname input\\endcsname', '^^5cinput{secret}', '\\openout1=secret']) assert.throws(() => validateLatex(source().replace('\\end{document}', command + '\n\\end{document}')));
  assert.throws(() => validateLatex(source().replace('\\end{document}', '{\\end{document}'))); assert.throws(() => validateLatex('not a CV'));
});
test('master saves back up originals and refuse to overwrite concurrent VS Code edits', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jobos-master-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'main.tex'), workspace = cvWorkspace(path, join(dir, 'packages'));
  const saved = await workspace.save(source(), sourceHash('')); await workspace.save(source().replace('Python', 'React'), saved.hash);
  assert.equal((await readdir(join(dir, 'packages/master-backups'))).length, 1);
  await writeFile(path, source().replace('Python', 'Java'));
  await assert.rejects(workspace.save(source(), saved.hash), /changed on disk/);
  assert.match(await readFile(path, 'utf8'), /Java/);
});
test('tailoring uses a restricted Codex run and keeps CV data on stdin rather than command arguments', async () => {
  const fake = async (args, opts) => { assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('read-only')); assert.ok(args.includes('shell_tool')); assert.ok(args.includes('multi_agent')); assert.ok(!args.some(a => a.includes('PRIVATE CV'))); assert.match(opts.stdin, /PRIVATE CV/); await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(output())); return { code: 0 }; };
  const result = await tailorWithCodex({ source: source(), resume: 'PRIVATE CV', job: { title: 'Data Engineer', company: 'Acme' }, language: 'English', recipientName: '' }, fake);
  assert.match(result.email.subject, /application/); assert.match(tailoringPrompt({ source: source(), resume: '', job: {}, language: 'French' }), /Never add skills/);
  assert.throws(() => validateTailoring({ ...output(), email: { subject: 'Subject\nBcc: evil', body: 'Body' } }));
});
test('CV source and per-job packages require a token, persist files and leave the master unchanged', async t => {
  const { request, job, dir } = await setup(t);
  assert.equal((await request('codex/cv-source', 'GET', undefined, {})).status, 401);
  const master = (await request('codex/cv-source')).body; await request('codex/cv-source', 'PUT', { source: source(), expectedHash: master.hash });
  const original = await readFile(join(dir, 'main.tex'), 'utf8');
  const start = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', recipientEmail: 'careers@example.com' }); assert.equal(start.status, 202);
  const result = await waitRun(request, start.body.id); assert.equal(result.status, 'completed'); assert.equal(result.stale, false);
  assert.equal(await readFile(join(dir, 'main.tex'), 'utf8'), original);
  assert.match((await request(`codex/tailor/${result.id}/files/main.tex`)).body, /documentclass/);
  assert.match((await request(`codex/tailor/${result.id}/files/outreach.txt`)).body, /To: careers@example.com/);
  assert.equal((await request(`codex/tailor/${result.id}/files/unknown.txt`)).status, 404);
  const state = (await request('state')).body; assert.equal(state.tailorings[0].latex, undefined); assert.equal(state.tailorings[0].email, undefined);
  await request(`codex/tailor/${result.id}`, 'PUT', { email: { subject: 'Reviewed subject', body: 'Reviewed body' } });
  assert.match((await request(`codex/tailor/${result.id}/files/outreach.txt`)).body, /Reviewed body/);
  const latest = (await request('codex/cv-source')).body; await request('codex/cv-source', 'PUT', { source: source().replace('Python', 'React'), expectedHash: latest.hash });
  assert.equal((await request('codex/tailor/' + result.id)).body.stale, true);
  const reviewed = await request(`codex/tailor/${result.id}`, 'PUT', { confirmCurrentInputs: true }); assert.equal(reviewed.body.stale, false);
});
test('successful compilation exposes a token-protected PDF file with the correct bytes', async t => {
  const { request, job } = await setup(t, { latexCompiler: async path => { await writeFile(join(dirname(path), 'main.pdf'), '%PDF-1.7\nTEST'); return { compilation: 'compiled', compilationMessage: 'PDF generated' }; } });
  await request('codex/cv-source/starter', 'POST', {}); const start = await request('codex/tailor', 'POST', { jobId: job.id }); const run = await waitRun(request, start.body.id);
  assert.ok(run.files.includes('main.pdf')); assert.equal(run.compilation, 'compiled');
  assert.match((await request(`codex/tailor/${run.id}/files/main.pdf`)).body, /^%PDF-/); assert.equal((await request(`codex/tailor/${run.id}/files/main.pdf`, 'GET', undefined, {})).status, 401);
});
test('starter creation uses saved CV once and never overwrites an existing master', async t => {
  const { request } = await setup(t); await request('settings', 'PUT', { resume: 'Synthetic CV with SQL, Python and real project experience.' });
  const result = await request('codex/cv-source/starter', 'POST', {}); assert.equal(result.status, 201); assert.match(result.body.source, /Synthetic CV/);
  assert.equal((await request('codex/cv-source/starter', 'POST', {})).status, 409);
});
test('tailoring rejects missing source, invalid recipients, unavailable jobs and provider failures', async t => {
  const { request, job } = await setup(t, { tailorer: async () => { throw new Error('PRIVATE provider data'); } });
  assert.equal((await request('codex/tailor', 'POST', { jobId: job.id })).status, 400);
  await request('codex/cv-source/starter', 'POST', {});
  assert.equal((await request('codex/tailor', 'POST', { jobId: 'missing' })).status, 400);
  assert.equal((await request('codex/tailor', 'POST', { jobId: job.id, recipientEmail: 'invalid' })).status, 400);
  const start = await request('codex/tailor', 'POST', { jobId: job.id }); const run = await waitRun(request, start.body.id);
  assert.equal(run.status, 'failed'); assert.ok(!run.error.includes('PRIVATE'));
});
test('tailoring and search share the single-run guard', async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const { request, job } = await setup(t, { tailorer: () => pending }); await request('codex/cv-source/starter', 'POST', {});
  const run = await request('codex/tailor', 'POST', { jobId: job.id });
  assert.equal((await request('codex/scan', 'POST', {})).status, 409); assert.equal((await request('codex/tailor', 'POST', { jobId: job.id })).status, 409);
  finish(output()); assert.equal((await waitRun(request, run.body.id)).status, 'completed');
});

test('a provider cannot replace the full CV template or expose rejected edits', async t => {
  const { request, job, dir } = await setup(t, { tailorer: async () => { const { replacements, ...result } = output(); return { ...result, latex: result.latex.replace('1.7cm', '0.2cm') }; } });
  await request('codex/cv-source/starter', 'POST', {}); const master = await readFile(join(dir, 'main.tex'), 'utf8');
  const start = await request('codex/tailor', 'POST', { jobId: job.id }); const result = await waitRun(request, start.body.id);
  assert.equal(result.status, 'failed'); assert.equal(await readFile(join(dir, 'main.tex'), 'utf8'), master);
  assert.equal((await request(`codex/tailor/${result.id}/files/main.tex`)).status, 404);
});
test('contact sections, tailoring forms and draft URLs escape external content and preserve edited messages', () => {
  const contact = { emails: [{ email: 'careers@example.com', sourceUrl: 'https://example.com', status: 'Published' }], recruitmentTeam: [{ name: '<img src=x onerror=alert(1)>', role: 'HR', profileUrl: 'https://example.com/team', status: 'Public' }], careersUrl: 'https://example.com/careers' };
  const dom = new JSDOM(applicationContacts(contact) + searchNowButton()); assert.equal(dom.window.document.querySelectorAll('img').length, 0); assert.equal(dom.window.document.querySelector('[data-action="scan-now"]').disabled, false); assert.ok(dom.window.document.querySelector('a[href="https://example.com/careers"]')); assert.ok(dom.window.document.querySelector('a[href="https://example.com/team"]')); dom.window.close();
  const result = { ...output(), id: 'test', title: 'Data Engineer', company: 'Acme', status: 'completed', files: ['main.tex', 'outreach.txt'], recipientEmail: 'careers@example.com' };
  assert.match(tailoringResult(result), /Save reviewed draft/); assert.match(tailoringPage({ jobs: [], opportunities: { items: [] }, tailorings: [] }, { master: null, result: null }), /Upload .tex/);
  const url = emailDraftUrl({ recipientEmail: 'hr@example.com', subject: 'A & B', body: 'Hello\nWorld' }); assert.match(url, /subject=A%20%26%20B/); assert.match(url, /Hello%0AWorld/); assert.throws(() => emailDraftUrl({ recipientEmail: '' }));
});
