import { mkdir, access, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

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
export async function setupLocalSearch(progress = () => {}, { root = resolve('data/searxng'), command = dockerCommand, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  progress('Checking Docker Desktop');
  try { await command(['version', '--format', '{{.Server.Version}}']); }
  catch { throw new Error('Start Docker Desktop, then retry Install / start local search in AI models.'); }
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
    try { const response = await fetcher('http://127.0.0.1:8888/', { redirect: 'error', signal: AbortSignal.timeout(2000) }); if (response.ok) return { baseUrl: 'http://127.0.0.1:8888' }; } catch { /* Wait for the owned service. */ }
    await pause(1000);
  }
  throw new Error('SearXNG has not become reachable. Check its container in Docker Desktop, then retry.');
}
