import { open, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function downloadVerifiedRuntime(asset, path, progress, { fetcher = fetch, chunkBytes = 8 * 1024 * 1024, workers = 4 } = {}) {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 24 * 1024 ** 3) throw new Error('The official runtime size is invalid.');
  const expected = asset.digest.slice(7).toLowerCase(), metadata = path + '.json';
  if (asset.size <= chunkBytes * 2) {
    const response = await fetcher(asset.browser_download_url, { signal: AbortSignal.timeout(30 * 60000) });
    if (!response.ok || !response.body) throw new Error('The official Ollama archive could not be downloaded.');
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      const counter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; hash.update(chunk); progress(`Downloading Ollama runtime · ${Math.min(100, Math.floor(bytes / asset.size * 100))}%`); done(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(path));
      if (bytes !== asset.size || hash.digest('hex') !== expected) throw new Error('The Ollama archive checksum did not match.');
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
    return;
  }
  let saved;
  try { saved = JSON.parse(await readFile(metadata, 'utf8')); } catch { /* A legacy sequential partial download can seed whole segments. */ }
  const count = Math.ceil(asset.size / chunkBytes);
  let currentSize = 0; try { currentSize = (await stat(path)).size; } catch { /* A fresh download has no partial file. */ }
  const matching = saved?.digest === expected && saved.size === asset.size && saved.chunkBytes === chunkBytes;
  let done = matching && currentSize === asset.size ? new Set((saved.completed || []).filter(index => Number.isInteger(index) && index >= 0 && index < count)) : new Set();
  if (!saved && currentSize > 0 && currentSize < asset.size) done = new Set(Array.from({ length: Math.floor(currentSize / chunkBytes) }, (_, index) => index));
  const record = () => writeFile(metadata, JSON.stringify({ digest: expected, size: asset.size, chunkBytes, completed: [...done] }));
  const file = await open(path, currentSize ? 'r+' : 'w+');
  const abort = new AbortController(), pending = Array.from({ length: count }, (_, index) => index).filter(index => !done.has(index)), inFlight = new Map();
  const length = index => Math.min(chunkBytes, asset.size - index * chunkBytes);
  let completedBytes = [...done].reduce((total, index) => total + length(index), 0), cursor = 0, previous = -1, records = Promise.resolve();
  const notify = () => { const bytes = completedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0), percent = Math.floor(bytes / asset.size * 100); if (percent !== previous) { previous = percent; progress(`Downloading Ollama runtime · ${Math.min(100, percent)}%`); } };
  try {
    await record(); await file.truncate(asset.size); notify();
    const work = async () => {
      while (cursor < pending.length && !abort.signal.aborted) {
        const index = pending[cursor++], start = index * chunkBytes, end = start + length(index) - 1;
        inFlight.set(index, 0);
        const response = await fetcher(asset.browser_download_url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5 * 60000)]) });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${asset.size}` || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error('The official runtime server did not return the requested download segment. Retry setup or use the manual guide.'); }
        let bytes = 0;
        for await (const buffer of response.body) {
          if (bytes + buffer.length > length(index)) throw new Error('The official runtime download segment is oversized.');
          let written = 0;
          while (written < buffer.length) { const output = await file.write(buffer, written, buffer.length - written, start + bytes + written); if (!output.bytesWritten) throw new Error('Could not write the runtime download.'); written += output.bytesWritten; }
          bytes += buffer.length; inFlight.set(index, bytes); notify();
        }
        if (bytes !== length(index)) throw new Error('The runtime download segment ended early. Retry setup to resume.');
        done.add(index); completedBytes += bytes; inFlight.delete(index);
        records = records.then(record); await records; notify();
      }
    };
    const tasks = Array.from({ length: Math.min(workers, pending.length) }, () => work().catch(error => { abort.abort(); throw error; }));
    const results = await Promise.allSettled(tasks);
    if (results.some(result => result.status === 'rejected')) throw new Error('Runtime download interrupted. Retry Install / download local model to resume saved progress, or use LOCAL-SETUP.md.');
    await file.sync();
  } finally { await records.catch(() => {}); await file.close(); }
  progress('Verifying the official runtime checksum');
  const hash = createHash('sha256'); for await (const buffer of createReadStream(path)) hash.update(buffer);
  if (hash.digest('hex') !== expected) { await unlink(path).catch(() => {}); await unlink(metadata).catch(() => {}); throw new Error('The Ollama archive checksum did not match.'); }
  await unlink(metadata).catch(() => {});
}
