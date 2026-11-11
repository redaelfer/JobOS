import { mkdir, access, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { validateLocalSearchUrl } from './ai-config.js';

const name = 'jobos-searxng', image = 'docker.io/searxng/searxng:latest';
const exists = path => access(path).then(() => true, () => false);
export function dockerCommand(args, { processSpawn = spawn, timeoutMs = 120000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = processSpawn('docker', args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-100000); });
    child.stderr.on('data', () => {}); // Never return Docker configuration/credential diagnostics.
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local search container command timed out.')); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Docker Desktop is required. Start it, then retry Install / start local search.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise(output.trim()) : reject(new Error('Docker could not complete local search setup. Check Docker Desktop and available disk space.')); });
  });
}
export async function ensureDockerDesktop(progress = () => {}, { command = dockerCommand, platform = process.platform, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, startupTimeoutMs = 120000 } = {}) {
  progress('Checking Docker Desktop');
  const check = timeoutMs => command(['version', '--format', '{{.Server.Version}}'], { timeoutMs });
  try { await check(3000); return; } catch { /* A stopped engine can be started on demand. */ }
  if (platform !== 'win32') throw new Error('Start Docker Desktop or the Docker engine, then retry Search now.');
  progress('Starting Docker Desktop for local search');
  try { await command(['desktop', 'start', '--detach'], { timeoutMs: 30000 }); }
  catch { throw new Error('Docker Desktop could not start automatically. Open Docker Desktop, complete any setup prompts, then retry Search now. Install Docker Desktop first if it is missing.'); }
  progress('Waiting for Docker Desktop to be ready');
  const deadline = now() + startupTimeoutMs;
  while (now() < deadline) {
    try { await check(Math.min(3000, deadline - now())); return; } catch { /* Wait for the engine. */ }
    if (now() < deadline) await pause(Math.min(1000, deadline - now()));
  }
  throw new Error('Docker Desktop did not become ready within two minutes. Open Docker Desktop to check its startup status, then retry Search now.');
}

const reachable = async (base, fetcher) => {
  try {
    const response = await fetcher(base + '/', { redirect: 'error', signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
};

// Only an explicit search starts services. Custom addresses remain user-managed.
export async function ensureLocalSearch(baseUrl, progress = () => {}, options = {}) {
  const base = validateLocalSearchUrl(baseUrl), fetcher = options.fetcher || fetch;
  progress('Checking local SearXNG before searching');
  if (await reachable(base, fetcher)) return;
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.port !== '8888' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('The configured local SearXNG address is unavailable. Start that service manually or choose the JobOS service at http://127.0.0.1:8888 in AI models.');
  await setupLocalSearch(progress, { ...options, allowInstall: false });
  if (!await reachable(base, fetcher)) throw new Error('SearXNG started but its configured address is not reachable. Use http://127.0.0.1:8888 in AI models, then retry Search now.');
}

export async function setupLocalSearch(progress = () => {}, { root = resolve('data/searxng'), command = dockerCommand, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), allowInstall = true, ...dockerOptions } = {}) {
  await ensureDockerDesktop(progress, { ...dockerOptions, command, pause });
  const config = join(root, 'config'), cache = join(root, 'cache');
  let existing;
  try { existing = JSON.parse(await command(['inspect', name])); } catch { /* No owned container yet. */ }
  if (existing) {
    const container = existing[0], ports = container?.HostConfig?.PortBindings?.['8080/tcp'];
    const mounts = container?.Mounts || [];
    const pathKey = value => resolve(value).replace(/\\/g, '/').toLowerCase();
    if (container?.Config?.Labels?.['io.jobos.local-search'] !== '1' || !ports?.length || ports.some(port => port.HostIp !== '127.0.0.1' || port.HostPort !== '8888') || !mounts.some(m => m.Destination === '/etc/searxng' && pathKey(m.Source) === pathKey(config)) || !mounts.some(m => m.Destination === '/var/cache/searxng' && pathKey(m.Source) === pathKey(cache))) throw new Error('The jobos-searxng container is not the expected private local setup. Leave it intact and check LOCAL-SETUP.md.');
    progress('Starting the existing local SearXNG service');
    if (!container.State?.Running) await command(['start', name]);
  } else {
    if (!allowInstall) throw new Error('Local SearXNG is not installed. In AI models, click Install / start local search once, then retry Search now.');
    await mkdir(config, { recursive: true }); await mkdir(cache, { recursive: true });
    const settings = join(config, 'settings.yml');
    if (!await exists(settings)) await writeFile(settings, `use_default_settings: true\nserver:\n  secret_key: "${randomBytes(32).toString('hex')}"\n  limiter: false\n  bind_address: "0.0.0.0"\n  port: 8080\nsearch:\n  formats:\n    - html\n    - json\noutgoing:\n  request_timeout: 10.0\n`, { mode: 0o600 });
    progress('Downloading the official SearXNG container');
    await command(['pull', image], { timeoutMs: 10 * 60000 });
    const inspected = JSON.parse(await command(['image', 'inspect', image]));
    const imageId = inspected[0]?.Id;
    if (!/^sha256:[a-f0-9]{64}$/i.test(imageId || '')) throw new Error('The downloaded SearXNG image could not be identified.');
    progress('Starting SearXNG on 127.0.0.1:8888');
    await command(['run', '--detach', '--name', name, '--label', 'io.jobos.local-search=1', '--publish', '127.0.0.1:8888:8080', '--mount', `type=bind,source=${config},target=/etc/searxng`, '--mount', `type=bind,source=${cache},target=/var/cache/searxng`, '--restart', 'unless-stopped', imageId]);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await reachable('http://127.0.0.1:8888', fetcher)) return { baseUrl: 'http://127.0.0.1:8888' };
    await pause(1000);
  }
  throw new Error('SearXNG has not become reachable. Check its container in Docker Desktop, then retry.');
}
