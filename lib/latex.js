import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';

export function latexExecutable(source) {
  if (process.env.TEX_BIN) return process.env.TEX_BIN;
  const engine = /\\usepackage(?:\[[^\]]*\])?\{fontspec\}/.test(source) ? 'xelatex' : 'pdflatex';
  if (process.platform === 'win32') {
    const path = join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', engine + '.exe');
    if (existsSync(path)) return path;
  }
  return engine;
}
function runCompiler(executable, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let finished = false;
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish({ code: -1, timedOut: true }); }, 90000);
    // Drain diagnostics without logging private CV content.
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    child.on('error', error => finish({ code: -1, unavailable: error.code === 'ENOENT' }));
    child.on('close', code => finish({ code }));
  });
}
export async function compileLatex(path, { runner = runCompiler, executable } = {}) {
  const source = await readFile(path, 'utf8'), cwd = dirname(path), pdf = join(cwd, 'main.pdf');
  executable ||= latexExecutable(source);
  await unlink(pdf).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const miktex = /miktex/i.test(executable);
  const args = [...(miktex ? ['-disable-write18', '-disable-installer', '-dont-parse-first-line'] : ['-no-shell-escape']), '-interaction=nonstopmode', '-halt-on-error', '-output-directory=' + cwd, miktex ? '-job-name=main' : '-jobname=main', path];
  for (let pass = 0; pass < 2; pass++) {
    const result = await runner(executable, args, cwd);
    if (result.code !== 0) return { compilation: result.unavailable ? 'unavailable' : 'failed', compilationMessage: result.unavailable ? 'Install a LaTeX compiler or set TEX_BIN to generate a PDF. The .tex and email are saved.' : 'PDF compilation failed or timed out. Review the standalone .tex in a LaTeX editor; the source and email remain available.' };
  }
  let bytes; try { bytes = await readFile(pdf); } catch { return { compilation: 'failed', compilationMessage: 'The compiler did not create a PDF. The .tex and email are saved.' }; }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') return { compilation: 'failed', compilationMessage: 'The compiler output was not a valid PDF file.' };
  return { compilation: 'compiled', compilationMessage: 'PDF generated. Review the facts and layout before attaching it.' };
}
