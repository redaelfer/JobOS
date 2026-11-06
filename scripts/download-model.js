// Use JobOS's protected, guarded download workflow rather than executing model
// names as commands. No CV, token or provider response body is logged.
const base = 'http://127.0.0.1:4317/api/';
const model = process.argv[2] || 'qwen3:4b', select = process.argv.slice(3).includes('--use');
try {
  let response;
  try { response = await fetch(base + 'state', { signal: AbortSignal.timeout(3000) }); } catch { throw new Error('Start JobOS with npm start, then retry this download command in another terminal.'); }
  if (!response.ok) throw new Error('JobOS is unavailable. Check its terminal and USER-GUIDE.md.');
  const state = await response.json(), revision = state.ai.revision;
  const headers = { 'Content-Type': 'application/json', 'X-JobOS-Token': state.settings.token };
  const request = async (path, body) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The local request failed.'); return result;
  };
  const started = await request('ai/local/setup', { model, expectedRevision: revision });
  console.log('Local model download started. Leave JobOS running; progress is also visible in AI models.');
  const deadline = Date.now() + 65 * 60000; let last = '';
  while (Date.now() < deadline) {
    const run = await request('ai/local/download/' + encodeURIComponent(started.id));
    if (run.status === 'failed') throw new Error(run.error || 'Download failed. Retry to resume.');
    if (run.phase !== last) { console.log(run.phase); last = run.phase; }
    if (run.status === 'completed') {
      if (select) { await request('ai/local/select', { model, expectedRevision: revision }); console.log('Downloaded model selected. Search settings kept. Test saved model in the app.'); }
      else console.log('Download complete. In AI models, Refresh installed models → Use this model → Test saved model.');
      process.exit(0);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Download is still pending. Check AI models; this command did not cancel it.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
