// Optional command bridge. JobOS inference uses the gateway's HTTP API and
// does not import or require the separate FreeLLMAPI app at startup.
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const gatewayUrl = 'http://127.0.0.1:3001';
export const gatewayWorkspace = (configured = process.env.FREELLMAPI_DIR) => resolve(projectRoot, configured || '../freellmapi');
export function standaloneEntry(command, directory = gatewayWorkspace()) {
  if (!['start', 'models', 'code', 'runtime'].includes(command)) throw new Error('Choose a supported gateway command.');
  const entry = join(directory, command === 'runtime' ? 'lib' : 'scripts', command + '.js');
  if (!existsSync(entry)) throw new Error('The separate FreeLLMAPI app was not found. Use the sibling project/freellmapi folder or set FREELLMAPI_DIR; see FREELLMAPI.md.');
  return entry;
}
export async function assertJobOSIdle(fetcher = fetch) {
  let state;
  try {
    const response = await fetcher('http://127.0.0.1:4317/api/state', { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (response.ok) state = await response.json();
  } catch { /* This compatibility command can run without JobOS. */ }
  if (state && ['scans', 'searches', 'rankings', 'tailorings', 'modelDownloads'].some(kind => state[kind]?.some(run => run.status === 'running'))) throw new Error('Wait for the active JobOS workflow before gateway setup or coding.');
}
export async function setupGateway(credentials, progress) {
  const runtime = await import(pathToFileURL(standaloneEntry('runtime')).href);
  return runtime.setupGateway(credentials, progress);
}
export async function runGatewayCommand(command, args = []) {
  if (command === 'code' && !args.includes('--help')) await assertJobOSIdle();
  const child = spawn(process.execPath, ['--env-file-if-exists=' + join(gatewayWorkspace(), '.env'), standaloneEntry(command), ...args], { cwd: process.cwd(), shell: false, stdio: 'inherit', windowsHide: true });
  await new Promise(resolveDone => {
    child.once('error', () => { console.error('The separate gateway command could not start. See FREELLMAPI.md.'); process.exitCode = 1; resolveDone(); });
    child.once('exit', code => { process.exitCode = code ?? 1; resolveDone(); });
  });
}
