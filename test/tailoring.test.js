import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { createApp } from '../server.js';
import { validateLatex, starterLatex, sourceHash, cvWorkspace, validateTailoring, tailoringPrompt, tailoringFailure, reportCvChanges } from '../lib/tailoring.js';
import { tailorWithCodex } from '../lib/codex.js';
import { applicationContacts, searchNowButton } from '../public/application-tools.js';
import { tailoringPage, tailoringResult, emailDraftUrl } from '../public/tailoring-view.js';
const source = () => starterLatex('Synthetic Person\nPython and SQL engineer\nBuilt tested data pipelines with a 23% improvement.');
const output = () => ({ latex: source(), replacements: [], email: { subject: 'Data engineer application', body: 'Hello hiring team, I am interested in the role. My experience includes Python and SQL.' }, changes: ['Emphasized existing data experience'], questions: ['Confirm role availability and compensation'] });
const analysisOutput = job => ({ summary: 'Prioritize existing Python and SQL evidence.', points: [{ requirement: 'Python and SQL', priority: 'required', jobEvidence: job.description.slice(0, 120), cvEvidence: 'Python and SQL engineer', match: 'supported', cvAction: 'Emphasize existing data pipeline evidence.', emailAction: 'Mention the existing Python and SQL project.' }], questions: [] });
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'jobos-tailoring-'));
  const app = createApp({ dbPath: ':memory:', cvPath: join(dir, 'main.tex'), artifactRoot: join(dir, 'applications'), hydrator: async () => [], statusChecker: async () => ({ ready: true }), analyzer: async ({ job }) => analysisOutput(job), tailorer: async () => output(), latexCompiler: async () => ({ compilation: 'unavailable', compilationMessage: 'Not configured in fixture' }), ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.store.db.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`, headers = { 'X-JobOS-Token': app.store.get('settings', 'main').token, 'Content-Type': 'application/json' };
  const request = async (path, method = 'GET', body, custom = headers) => { const res = await fetch(base + '/api/' + path, { method, headers: custom, body: body ? JSON.stringify(body) : undefined }); const text = await res.text(); let value; try { value = JSON.parse(text); } catch { value = text; } return { status: res.status, body: value }; };
  const job = app.ingest({ title: 'Data Engineer', company: 'Acme', description: 'Build tested Python and SQL data pipelines in the engineering team.', url: 'https://example.com/jobs/data' }).job;
  return { ...app, request, job, dir };
}
async function waitRun(request, id) { for (let i = 0; i < 50; i++) { const result = await request('codex/tailor/' + id); if (result.body.status !== 'running') return result.body; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Draft did not finish'); }

test('analysis-only preview writes no artifacts, is private, and is reused for a current draft', async t => {
  let analyses = 0, drafts = 0;
  const { request, job } = await setup(t, { analyzer: async ({ job }) => { analyses++; return analysisOutput(job); }, tailorer: async ({ analysis }) => { drafts++; assert.equal(analysis.points[0].match, 'supported'); return output(); } });
  await request('codex/cv-source', 'PUT', { source: source(), expectedHash: sourceHash('') });
  assert.equal((await request('codex/tailor', 'POST', { jobId: job.id, analysisOnly: true }, { 'Content-Type': 'application/json' })).status, 401);
  const start = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisOnly: true });
  const analysis = await waitRun(request, start.body.id);
  assert.equal(analysis.mode, 'analysis'); assert.equal(analysis.analysisReady, true); assert.equal(analysis.files, undefined); assert.equal(drafts, 0);
  assert.equal((await request('state')).body.tailorings[0].analysis, undefined);
  assert.equal((await request(`codex/tailor/${analysis.id}/files/main.tex`)).status, 404);
  assert.equal((await request(`codex/tailor/${analysis.id}`, 'PUT', { latex: source() })).status, 400);
  const draft = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisId: analysis.id });
  const ready = await waitRun(request, draft.body.id);
  assert.equal(ready.status, 'completed'); assert.equal(ready.analysisFromId, analysis.id); assert.equal(analyses, 1); assert.equal(drafts, 1);
  const master = (await request('codex/cv-source')).body;
  await request('codex/cv-source', 'PUT', { source: master.source.replace('Synthetic Person', 'Synthetic Person A'), expectedHash: master.hash });
  const changedMaster = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisId: analysis.id });
  await waitRun(request, changedMaster.body.id); assert.equal(analyses, 2);
  await request('jobs/' + job.id, 'PATCH', { description: job.description + ' Kubernetes is preferred.' });
  const changedJob = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisId: changedMaster.body.id });
  await waitRun(request, changedJob.body.id); assert.equal(analyses, 3);
  const config = (await request('ai/config')).body;
  await request('ai/config', 'PUT', { expectedRevision: config.revision, provider: 'codex', model: 'synthetic-model' });
  const changedModel = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisId: changedJob.body.id });
  await waitRun(request, changedModel.body.id); assert.equal(analyses, 4);
  await request('settings', 'PUT', { resume: 'Changed synthetic CV facts with sufficient text for validation.' });
  const changed = await request('codex/tailor', 'POST', { jobId: job.id, language: 'French', analysisId: analysis.id });
  await waitRun(request, changed.body.id); assert.equal(analyses, 5);
  const otherLanguage = await request('codex/tailor', 'POST', { jobId: job.id, language: 'English', analysisId: analysis.id });
  await waitRun(request, otherLanguage.body.id); assert.equal(analyses, 6);
});

test('automatic analysis finishes before writing, exposes its brief during generation and shares the guard', async t => {
  const calls = []; let release;
  const { request, job } = await setup(t, { analyzer: async ({ job }) => { calls.push('analyze'); return analysisOutput(job); }, tailorer: async ({ analysis }) => { calls.push('write'); assert.ok(analysis.points.length); await new Promise(resolve => { release = resolve; }); return output(); } });
  await request('codex/cv-source/starter', 'POST', {});
  const start = await request('codex/tailor', 'POST', { jobId: job.id });
  const progress = (await request('codex/tailor/' + start.body.id)).body;
  assert.deepEqual(calls, ['analyze', 'write']); assert.equal(progress.status, 'running'); assert.equal(progress.analysisReady, true); assert.ok(progress.analysis.points.length);
  assert.equal((await request('codex/tailor', 'POST', { jobId: job.id, analysisOnly: true })).status, 409);
  release(); assert.equal((await waitRun(request, start.body.id)).status, 'completed');
});

test('a source-unconfirmed analysis blocks writing and cannot expose a fabricated recommendation', async t => {
  let drafted = false;
  const { request, job } = await setup(t, { analyzer: async ({ job }) => ({ ...analysisOutput(job), points: [{ ...analysisOutput(job).points[0], jobEvidence: 'Fabricated requirement absent from this offer' }] }), tailorer: async () => { drafted = true; return output(); } });
  await request('codex/cv-source/starter', 'POST', {});
  const start = await request('codex/tailor', 'POST', { jobId: job.id }); const run = await waitRun(request, start.body.id);
  assert.equal(run.status, 'failed'); assert.equal(run.errorCode, 'ANALYSIS_EVIDENCE'); assert.equal(drafted, false); assert.equal(run.analysis, undefined); assert.equal(run.files, undefined);
});

test('a valid analysis survives a writing failure and can be reused without another analysis call', async t => {
  let analyses = 0, attempts = 0;
  const { request, job } = await setup(t, { analyzer: async ({ job }) => { analyses++; return analysisOutput(job); }, tailorer: async () => { if (++attempts === 1) throw new Error('The local model stopped before finishing.'); return output(); } });
  await request('codex/cv-source/starter', 'POST', {});
  const start = await request('codex/tailor', 'POST', { jobId: job.id }); const failed = await waitRun(request, start.body.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.analysisReady, true); assert.ok(failed.analysis.points.length);
  const retry = await request('codex/tailor', 'POST', { jobId: job.id, analysisId: failed.id }); const completed = await waitRun(request, retry.body.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.analysisFromId, failed.id); assert.equal(analyses, 1); assert.equal(attempts, 2);
});

test('standalone LaTeX validation preserves escaped facts and rejects external/executable input', () => {
  assert.match(validateLatex(source()), /23\\%/);
  for (const command of ['\\input{secret}', '\\includegraphics{photo}', '\\write18{cmd}', '\\directlua{code}', '\\csname input\\endcsname', '^^5cinput{secret}', '\\openout1=secret']) assert.throws(() => validateLatex(source().replace('\\end{document}', command + '\n\\end{document}')));
  assert.throws(() => validateLatex(source().replace('\\end{document}', '{\\end{document}'))); assert.throws(() => validateLatex('not a CV'));
});

test('unchanged CVs cannot be reported as modified by model-generated review notes', () => {
  const generated = { latex: source(), email: output().email, changes: ['The model claims it rewrote the CV.'], questions: [] };
  const unchanged = reportCvChanges(generated, source(), 'French');
  assert.equal(unchanged.cvChanged, false); assert.match(unchanged.changes[0], /conservé à l’identique/); assert.ok(!unchanged.changes.join(' ').includes('claims'));
  const edited = reportCvChanges({ ...generated, latex: source().replace('Python', 'React') }, source(), 'English');
  assert.equal(edited.cvChanged, true); assert.deepEqual(edited.changes, generated.changes);
});

test('tailoring failures identify actionable causes without exposing provider content or private CV data', () => {
  for (const [message, code, expected] of [
    ['PRIVATE_CV', 'MODEL_TIMEOUT', 'MODEL_TIMEOUT'], ['PRIVATE_CV', 'MODEL_CONNECTION', 'MODEL_CONNECTION'],
    ['PRIVATE_CV input is too large', '', 'MODEL_CONTEXT'], ['PRIVATE_CV stopped before finishing', '', 'MODEL_OUTPUT_LIMIT'],
    ['PRIVATE_CV did not return valid JSON', '', 'MODEL_OUTPUT'], ['PRIVATE_CV attempted to change the template', '', 'TEMPLATE_EDITS'],
    ['PRIVATE_CV HTTP 401', '', 'MODEL_AUTH'], ['PRIVATE_CV HTTP 429', '', 'MODEL_QUOTA'],
    ['PRIVATE_CV HTTP 500', '', 'MODEL_GENERATION'], ['PRIVATE_CV', 'ENOSPC', 'DRAFT_STORAGE'], ['PRIVATE_CV', '', 'TAILORING_FAILED']
  ]) {
    const result = tailoringFailure(Object.assign(new Error(message), { code }));
    assert.equal(result.errorCode, expected); assert.ok(!JSON.stringify(result).includes('PRIVATE_CV'));
  }
});

test('a timed-out tailoring run retains a safe cause and completion date without completed artifacts', async t => {
  const { request, job } = await setup(t, { tailorer: async () => { throw Object.assign(new Error('PRIVATE_CV'), { code: 'MODEL_TIMEOUT' }); } });
  await request('codex/cv-source/starter', 'POST', {});
  const start = await request('codex/tailor', 'POST', { jobId: job.id }); const run = await waitRun(request, start.body.id);
  assert.equal(run.status, 'failed'); assert.equal(run.errorCode, 'MODEL_TIMEOUT'); assert.ok(run.completedAt);
  assert.ok(!run.error.includes('PRIVATE')); assert.equal(run.latex, undefined); assert.equal(run.email, undefined);
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
