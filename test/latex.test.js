import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileLatex } from '../lib/latex.js';
import { starterLatex } from '../lib/tailoring.js';
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'jobos-latex-')); t.after(() => rm(dir, { recursive: true, force: true })); const path = join(dir, 'main.tex'); await writeFile(path, starterLatex('Synthetic CV')); return { dir, path }; }
test('PDF compilation uses two passes, prevents shell execution and accepts only PDF output', async t => {
  const { dir, path } = await fixture(t); let calls = 0;
  const result = await compileLatex(path, { executable: 'C:/MiKTeX/pdflatex.exe', runner: async (exe, args, cwd) => { calls++; assert.equal(cwd, dir); assert.ok(args.includes('-disable-write18')); assert.ok(args.includes('-disable-installer')); assert.ok(args.includes('-dont-parse-first-line')); await writeFile(join(dir, 'main.pdf'), '%PDF-1.7\nSynthetic test fixture'); return { code: 0 }; } });
  assert.equal(result.compilation, 'compiled'); assert.equal(calls, 2);
});
test('compiler failures remove stale PDF availability while preserving the editable source', async t => {
  const { dir, path } = await fixture(t); await writeFile(join(dir, 'main.pdf'), '%PDF-1.7 OLD');
  const result = await compileLatex(path, { executable: 'missing', runner: async () => ({ code: -1, unavailable: true }) });
  assert.equal(result.compilation, 'unavailable'); await assert.rejects(readFile(join(dir, 'main.pdf')), /ENOENT/); assert.match(await readFile(path, 'utf8'), /documentclass/);
  assert.equal((await compileLatex(path, { executable: 'test', runner: async () => ({ code: 1 }) })).compilation, 'failed');
});
test('a successful exit without a genuine PDF cannot become a completed PDF artifact', async t => {
  const { dir, path } = await fixture(t);
  const result = await compileLatex(path, { executable: 'test', runner: async () => { await writeFile(join(dir, 'main.pdf'), 'Not a PDF'); return { code: 0 }; } }); assert.equal(result.compilation, 'failed');
});
