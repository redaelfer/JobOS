import { mkdir, access, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { requestJSON } from './ai-client.js';
import { validateModel } from './ai-config.js';
import { downloadVerifiedRuntime } from './runtime-download.js';

const base = 'http://127.0.0.1:11434';
const exists = path => access(path).then(() => true, () => false);
const psLiteral = value => "'" + value.replace(/'/g, "''") + "'";
export async function ensureLocalOllama(progress = () => {}, { fetcher = fetch, root = resolve('data/ollama'), processSpawn = spawn, allowDownload = true } = {}) {
  try { await requestJSON(base + '/api/version', { fetcher, timeoutMs: 2000, label: 'Ollama' }); return; } catch { /* Start a portable runtime only when no server is available. */ }
  if (process.platform !== 'win32') throw new Error('Install Ollama from https://ollama.com/download for this platform.');
  await mkdir(root, { recursive: true });
  const runtime = join(root, 'runtime'), executable = join(runtime, 'ollama.exe'), archive = join(root, 'runtime.zip'), partial = archive + '.partial';
  if (!await exists(executable)) {
    if (!allowDownload) throw new Error('Local Ollama is not installed/running. Use Install / download local model in AI models.');
    progress('Finding the official Ollama Windows download');
    const release = await requestJSON('https://api.github.com/repos/ollama/ollama/releases/latest', { fetcher, timeoutMs: 30000, label: 'Official Ollama download', headers: { 'User-Agent': 'JobOS-local-model-setup' } });
    const asset = release.assets?.find(asset => asset.name === 'ollama-windows-amd64.zip');
    if (!asset || !/^https:\/\/github\.com\/ollama\/ollama\/releases\/download\/[^/]+\/ollama-windows-amd64\.zip$/.test(asset.browser_download_url) || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error('The official Ollama archive/checksum could not be verified.');
    await downloadVerifiedRuntime(asset, partial, progress, { fetcher });
    await rename(partial, archive);
    progress('Extracting the verified Ollama runtime');
    await new Promise((resolvePromise, reject) => {
      const child = processSpawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${psLiteral(archive)} -DestinationPath ${psLiteral(runtime)} -Force`], { shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Ollama extraction timed out.')); }, 10 * 60000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('Ollama extraction could not start.')); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error('Ollama extraction failed.')); });
    });
    await unlink(archive).catch(() => {});
  }
  if (!await exists(executable)) throw new Error('Ollama executable was not found in the verified archive.');
  progress('Starting local Ollama on this computer');
  const child = processSpawn(executable, ['serve'], { cwd: root, shell: false, windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: join(root, 'models'), OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: 'false' } });
  let launchError = false; child.on('error', () => { launchError = true; }); child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (launchError) throw new Error('The local Ollama service could not start.');
    try { await requestJSON(base + '/api/version', { fetcher, timeoutMs: 2000, label: 'Ollama' }); return; } catch { await new Promise(resolvePromise => setTimeout(resolvePromise, 500)); }
  }
  throw new Error('Local Ollama did not become ready.');
}
export async function pullLocalModel(model, progress = () => {}, { fetcher = fetch } = {}) {
  validateModel(model);
  if (/cloud/i.test(model)) throw new Error('Choose a downloaded local model, not an Ollama cloud model.');
  let response;
  try { response = await fetcher(base + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), redirect: 'error', signal: AbortSignal.timeout(60 * 60000) }); } catch { throw new Error('Could not connect to Ollama for the model download.'); }
  if (!response.ok || !response.body) throw new Error('Ollama could not download this model.');
  let pending = '', success = false;
  const parse = line => {
    if (!line.trim()) return;
    let item; try { item = JSON.parse(line); } catch { throw new Error('Invalid model-download progress.'); }
    if (item.error) throw new Error('Ollama model download failed. Check the model name, network and disk space.');
    const percent = item.total ? ` · ${Math.min(100, Math.floor((item.completed || 0) / item.total * 100))}%` : '';
    const phase = item.status === 'success' ? 'Model download verified and complete' : /pulling/.test(item.status || '') ? 'Downloading local model' : 'Preparing local model';
    progress(phase + percent); if (item.status === 'success') success = true;
  };
  for await (const chunk of response.body) { pending += Buffer.from(chunk).toString('utf8'); if (pending.length > 100000) throw new Error('Invalid model-download progress.'); let index; while ((index = pending.indexOf('\n')) !== -1) { parse(pending.slice(0, index)); pending = pending.slice(index + 1); } }
  parse(pending);
  if (!success) throw new Error('The model download ended before completion. Retry to resume.');
}
export async function setupLocalModel(model, progress, options = {}) {
  validateModel(model); if (/cloud/i.test(model)) throw new Error('Choose a local model, not a cloud model.');
  await ensureLocalOllama(progress, options);
  await pullLocalModel(model, progress, options);
}
