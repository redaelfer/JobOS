import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { downloadVerifiedRuntime } from '../lib/runtime-download.js';

const bytes = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789ABCD');
const asset = { size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), browser_download_url: 'https://github.com/ollama/ollama/releases/download/v1/ollama-windows-amd64.zip' };
const segment = options => {
  const [start, end] = options.headers.Range.match(/\d+/g).map(Number);
  return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
};
async function workspace(t) { const root = await mkdtemp(join(tmpdir(), 'jobos-runtime-ranges-')); t.after(() => rm(root, { recursive: true, force: true })); return join(root, 'runtime.zip.partial'); }

test('parallel runtime segments write correct offsets and verify the complete official digest', async t => {
  const path = await workspace(t), calls = [], phases = [];
  await downloadVerifiedRuntime(asset, path, phase => phases.push(phase), { chunkBytes: 8, workers: 3, fetcher: async (_url, options) => { calls.push(options.headers.Range); return segment(options); } });
  assert.deepEqual(await readFile(path), bytes); assert.equal(calls.length, 5);
  await assert.rejects(access(path + '.json')); assert.ok(phases.includes('Verifying the official runtime checksum'));
});

test('an interrupted segmented runtime download resumes only missing segments', async t => {
  const path = await workspace(t), calls = [];
  await assert.rejects(downloadVerifiedRuntime(asset, path, () => {}, { chunkBytes: 8, workers: 1, fetcher: async (_url, options) => { if (options.headers.Range === 'bytes=16-23') throw new Error('Temporary connection loss'); return segment(options); } }), /resume saved progress/);
  const metadata = JSON.parse(await readFile(path + '.json', 'utf8')); assert.deepEqual(metadata.completed, [0, 1]);
  await downloadVerifiedRuntime(asset, path, () => {}, { chunkBytes: 8, workers: 2, fetcher: async (_url, options) => { calls.push(options.headers.Range); return segment(options); } });
  assert.equal(calls.length, 3); assert.ok(calls.every(range => !['bytes=0-7', 'bytes=8-15'].includes(range)));
  assert.deepEqual(await readFile(path), bytes);
});

test('a sequential partial archive can seed whole segments before a verified resume', async t => {
  const path = await workspace(t), calls = []; await writeFile(path, bytes.subarray(0, 12));
  await downloadVerifiedRuntime(asset, path, () => {}, { chunkBytes: 8, workers: 2, fetcher: async (_url, options) => { calls.push(options.headers.Range); return segment(options); } });
  assert.equal(calls.length, 4); assert.equal(calls.includes('bytes=0-7'), false); assert.deepEqual(await readFile(path), bytes);
});

test('incorrect runtime bytes fail the final digest and are discarded before execution', async t => {
  const path = await workspace(t);
  await assert.rejects(downloadVerifiedRuntime({ ...asset, digest: 'sha256:' + '0'.repeat(64) }, path, () => {}, { chunkBytes: 8, workers: 2, fetcher: async (_url, options) => segment(options) }), /checksum/);
  await assert.rejects(access(path)); await assert.rejects(access(path + '.json'));
});

test('ignored range responses preserve resumable state and never pretend installation succeeded', async t => {
  const path = await workspace(t);
  await assert.rejects(downloadVerifiedRuntime(asset, path, () => {}, { chunkBytes: 8, workers: 2, fetcher: async () => new Response(bytes) }), /interrupted/);
  assert.deepEqual(JSON.parse(await readFile(path + '.json', 'utf8')).completed, []);
});
