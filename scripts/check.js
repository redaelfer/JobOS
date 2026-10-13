import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
let failed = false;
for (const file of ['server.js', ...['lib', 'public', 'extension', 'test', 'scripts'].flatMap(dir => readdirSync(dir).filter(n => n.endsWith('.js')).map(n => join(dir, n)))]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) { failed = true; console.error(result.stderr); }
}
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
