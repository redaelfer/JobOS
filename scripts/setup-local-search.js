import { setupLocalSearch } from '../lib/local-search.js';
try {
  let state;
  try { const response = await fetch('http://127.0.0.1:4317/api/state', { signal: AbortSignal.timeout(2000) }); if (response.ok) state = await response.json(); } catch { /* Setup also works before the app is started. */ }
  if (state && ['scans', 'searches', 'rankings', 'tailorings', 'modelDownloads'].some(kind => state[kind]?.some(run => run.status === 'running'))) throw new Error('Wait for the active JobOS workflow before starting local search setup.');
  await setupLocalSearch(phase => console.log(phase));
  console.log('Local search is reachable at http://127.0.0.1:8888. Select Local model + local search in AI models, then test both connections.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
