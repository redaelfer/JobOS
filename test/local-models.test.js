import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { ensureLocalOllama, pullLocalModel } from '../lib/local-models.js';

test('local pull reports streaming progress, requires success and rejects cloud models', async () => {
  const phases = [];
  const fetcher = async (_url, options) => { assert.deepEqual(JSON.parse(options.body), { model: 'qwen3:4b', stream: true }); return new Response('{"status":"pulling layer","total":100,"completed":50}\n{"status":"success"}\n'); };
  await pullLocalModel('qwen3:4b', phase => phases.push(phase), { fetcher }); assert.ok(phases.some(phase => phase.includes('50%'))); assert.ok(phases.at(-1).includes('complete'));
  await assert.rejects(pullLocalModel('qwen3:4b', () => {}, { fetcher: async () => new Response('{"status":"pulling layer"}\n') }), /before completion/);
  await assert.rejects(pullLocalModel('some-cloud-model', () => {}, { fetcher }), /cloud/);
});

test('local setup reuses a running Ollama without downloading another runtime', async () => {
  const urls = []; await ensureLocalOllama(() => {}, { fetcher: async url => { urls.push(url); return new Response('{"version":"synthetic"}'); } });
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/version']);
});

test('checking a missing local runtime never initiates an unrequested download', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobos-ollama-no-download-')), calls = [];
  try {
    await assert.rejects(ensureLocalOllama(() => {}, { root, allowDownload: false, fetcher: async url => { calls.push(url); throw new Error('Offline'); } }), /not installed/);
    assert.deepEqual(calls, ['http://127.0.0.1:11434/api/version']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a mismatched official runtime checksum is rejected before extraction or execution', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobos-ollama-checksum-'));
  try {
    const fetcher = async url => {
      if (url.includes('/api/version')) throw new Error('Not installed');
      if (url.includes('api.github.com')) return new Response(JSON.stringify({ assets: [{ name: 'ollama-windows-amd64.zip', browser_download_url: 'https://github.com/ollama/ollama/releases/download/v1/ollama-windows-amd64.zip', size: 3, digest: 'sha256:' + '0'.repeat(64) }] }));
      return new Response('abc');
    };
    await assert.rejects(ensureLocalOllama(() => {}, { root, fetcher, processSpawn: () => { throw new Error('Must not execute'); } }), /checksum/);
    await assert.rejects(access(join(root, 'runtime.zip.partial')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verified runtime is extracted and launched hidden with project-local models and cloud disabled', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobos-ollama-install-')), digest = createHash('sha256').update('abc').digest('hex'); let started = false;
  try {
    const fetcher = async url => {
      if (url.includes('/api/version')) { if (!started) throw new Error('Not installed'); return new Response('{"version":"test"}'); }
      if (url.includes('api.github.com')) return new Response(JSON.stringify({ assets: [{ name: 'ollama-windows-amd64.zip', browser_download_url: 'https://github.com/ollama/ollama/releases/download/v1/ollama-windows-amd64.zip', size: 3, digest: 'sha256:' + digest }] }));
      return new Response('abc');
    };
    const processSpawn = (executable, args, options) => {
      assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
      const child = new EventEmitter(); child.kill = () => {}; child.unref = () => {};
      if (executable === 'powershell.exe') setImmediate(async () => { assert.ok(!args.includes('-ExecutionPolicy')); await mkdir(join(root, 'runtime'), { recursive: true }); await writeFile(join(root, 'runtime', 'ollama.exe'), 'synthetic'); child.emit('close', 0); });
      else { started = true; assert.equal(options.env.OLLAMA_MODELS, join(root, 'models')); assert.equal(options.env.OLLAMA_NO_CLOUD, '1'); assert.deepEqual(args, ['serve']); }
      return child;
    };
    await ensureLocalOllama(() => {}, { root, fetcher, processSpawn }); assert.equal(started, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
