import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, dirname, join } from 'node:path';
import { openStore } from './lib/store.js';
import { clean, validateJob, matchJob, jobUrl } from './lib/domain.js';
import { extractEmailJobs, pollMailbox, mailboxConfigured } from './lib/email.js';
import { extractResume } from './lib/resume.js';
import { createAIBackend } from './lib/ai.js';
import { credentialStore, publicAI, updateAIConfig } from './lib/ai-config.js';
import { setupLocalModel } from './lib/local-models.js';
import { searchPreferences, hydrateSavedJobs } from './lib/discovery.js';
import { performAutomatedScan } from './lib/automation.js';
import { buildOpportunities } from './lib/opportunities.js';
import { automationPreferences, preferenceFingerprint } from './lib/profile.js';
import { cvWorkspace, validateTailoring, validateLatex, starterLatex, sourceHash } from './lib/tailoring.js';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('./public/', import.meta.url));
export function createApp({ dbPath = resolve('data/jobos.sqlite'), cvPath = resolve('main.tex'), artifactRoot = resolve('data/applications'), latexCompiler, tailorer, ranker, searcher, researcher, hydrator = hydrateSavedJobs, statusChecker, credentialsPath = dbPath === ':memory:' ? null : join(dirname(dbPath), 'ai-credentials.json'), aiFactory = createAIBackend, aiOptions = {}, localSetup = setupLocalModel, credentialEnv = process.env } = {}) {
  const store = openStore(dbPath);
  const credentials = credentialStore(credentialsPath, credentialEnv);
  const aiSnapshot = () => publicAI(store.get('settings', 'main').ai, credentials);
  const backend = () => { const provider = aiFactory(store.get('settings', 'main').ai, credentials, aiOptions); return { ...provider, status: statusChecker || provider.status, tailor: tailorer || provider.tailor, rank: ranker || provider.rank, search: searcher || provider.search, research: researcher || provider.research }; };
  const cv = cvWorkspace(cvPath, artifactRoot, latexCompiler);
  let polling = false, mailbox = { configured: mailboxConfigured(), lastCheck: null, error: null };
  let activeRun = false;
  const postingId = url => createHash('sha256').update(jobUrl(url)).digest('hex');
  const dismissedUrls = () => store.list('dismissedJobs').map(record => record.url);
  const isDismissed = job => { const url = typeof job === 'string' ? job : job?.url; return !!url && !!store.get('dismissedJobs', postingId(url)); };
  function updateAlert(job) {
    const existing = store.list('alerts').find(a => a.jobId === job.id);
    const match = matchJob(job, store.get('settings', 'main'));
    if (existing) store.put('alerts', { ...existing, title: job.title, company: job.company });
    else if (match.matched) store.put('alerts', { jobId: job.id, title: job.title, company: job.company, read: false, reasons: match.reasons, createdAt: new Date().toISOString() });
  }
  function ingest(input) {
    const metadata = Object.fromEntries(['verification', 'evidence', 'postedAt', 'sourceCheckedAt', 'discoveryBucket', 'availabilityStatus', 'availabilityEvidence', 'discoveryProvider', 'discoveryModel'].filter(key => key in input).map(key => [key, clean(input[key], key === 'evidence' ? 2000 : 300)]));
    const job = { ...validateJob(input), ...metadata };
    if (isDismissed(job)) return { job: null, created: false, skipped: true, reason: 'You previously deleted this posting. It will not be added again.' };
    const existing = job.url && store.list('jobs').find(j => j.url && jobUrl(j.url) === job.url);
    if (existing) {
      if (input.descriptionVerified || (['LinkedIn email', 'Codex LinkedIn search', 'Codex employer search', 'AI LinkedIn search', 'AI employer search'].includes(existing.source) && job.source === 'LinkedIn extension') || (['Codex LinkedIn search', 'Codex employer search', 'AI LinkedIn search', 'AI employer search'].includes(existing.source) && ['Codex LinkedIn search', 'Codex employer search', 'AI LinkedIn search', 'AI employer search'].includes(job.source) && !existing.description && job.description)) {
        const enriched = store.put('jobs', { ...existing, ...metadata, title: job.title, company: job.company, location: job.location || existing.location, description: job.description || existing.description, lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        updateAlert(enriched);
        return { job: enriched, created: false, updated: true };
      }
      const detailsChanged = Object.entries(metadata).some(([key, value]) => key !== 'sourceCheckedAt' && value !== (existing[key] || ''));
      const refreshed = input.verification || input.sourceCheckedAt ? store.put('jobs', { ...existing, ...metadata, ...(input.verification ? { lastSeenAt: new Date().toISOString() } : {}), ...(detailsChanged ? { updatedAt: new Date().toISOString() } : {}) }) : existing;
      return { job: refreshed, created: false };
    }
    const now = new Date().toISOString();
    const created = store.put('jobs', { ...job, createdAt: now, detectedAt: now, updatedAt: now, ...(input.verification ? { lastSeenAt: now } : {}) });
    updateAlert(created);
    return { job: created, created: true };
  }
  const opportunities = () => buildOpportunities({ jobs: store.list('jobs'), rankings: store.list('rankings'), companies: store.list('companies'), contacts: store.list('contacts'), settings: store.get('settings', 'main') });
  async function checkMail() {
    if (polling) return { busy: true };
    polling = true;
    try { const imported = await pollMailbox(ingest); mailbox = { configured: true, lastCheck: new Date().toISOString(), error: null }; return { imported }; }
    catch (e) { mailbox.error = mailboxConfigured() ? 'Mailbox check failed. Check your IMAP settings and connection.' : e.message; throw new Error(mailbox.error); }
    finally { polling = false; }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(req.headers.host)) return send(403, { error: 'Invalid host.' });
      const origin = req.headers.origin;
      const local = !origin || allowedHosts.some(h => origin === `http://${h}`);
      const extension = /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '');
      if (!local && !extension) return send(403, { error: 'Origin not allowed.' });
      if (extension) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-JobOS-Token'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); }
      const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (extension && path !== '/api/capture') return send(403, { error: 'Extension access is limited to capture.' });
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required.' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > (path === '/api/resume' ? 3000000 : 1500000)) { send(413, { error: 'Request too large.' }); return; } }
        try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'Invalid JSON.' }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return send(400, { error: 'JSON object required.' });
      }
      if (path === '/api/state' && req.method === 'GET') return send(200, { ai: aiSnapshot(), modelDownloads: store.list('modelDownloads').slice(0, 1), jobs: store.list('jobs'), dismissedJobUrls: dismissedUrls(), contacts: store.list('contacts'), reminders: store.list('reminders'), alerts: store.list('alerts'), settings: store.get('settings', 'main'), mailbox, rankings: store.list('rankings').slice(0, 10), searches: store.list('searches').slice(0, 5), companies: store.list('companies'), scans: store.list('scans').slice(0, 10), opportunities: opportunities(), tailorings: store.list('tailorings').slice(0, 20).map(({ latex, email, changes, questions, ...run }) => run) });
      if (path === '/api/opportunities' && req.method === 'GET') return send(200, opportunities());
      if (path === '/api/resume' && req.method === 'POST') {
        const resume = await extractResume(body);
        store.put('settings', { ...store.get('settings', 'main'), resume: resume.text, resumeFilename: resume.filename });
        return send(200, { ...resume, characters: resume.text.length });
      }
      if (path.startsWith('/api/ai/')) {
        if (req.headers['x-jobos-token'] !== store.get('settings', 'main').token) return send(401, { error: 'JobOS token required for AI settings.' });
        if (path === '/api/ai/config' && req.method === 'GET') return send(200, aiSnapshot());
        if (path === '/api/ai/config' && req.method === 'PUT') {
          if (activeRun) return send(409, { error: 'Wait for the current AI workflow or model download before changing providers.' });
          if ((origin && !body.expectedRevision) || ('expectedRevision' in body && body.expectedRevision !== aiSnapshot().revision)) return send(409, { error: 'AI settings changed or this page is outdated. Reload saved settings in AI models before saving.' });
          const settings = store.get('settings', 'main'), config = updateAIConfig(settings.ai, body);
          credentials.save(body.keys, body.clearKeys); store.put('settings', { ...settings, ai: config });
          return send(200, aiSnapshot());
        }
        if (path === '/api/ai/models' && req.method === 'GET') return send(200, { models: await backend().models() });
        if (['/api/ai/test', '/api/ai/search-test'].includes(path) && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'Wait for the current AI workflow before testing a model.' });
          if ('expectedRevision' in body && body.expectedRevision !== aiSnapshot().revision) return send(409, { error: 'AI settings changed. Reload saved settings in AI models before testing.' });
          activeRun = true;
          try { return send(200, path === '/api/ai/search-test' ? await backend().testSearch() : await backend().status('rank', true)); } finally { activeRun = false; }
        }
        if (path === '/api/ai/local/setup' && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'An AI workflow or model download is already running.' });
          const profile = aiSnapshot().profiles.ollama;
          if (profile.baseUrl !== 'http://127.0.0.1:11434') throw new Error('Portable setup uses http://127.0.0.1:11434. Set that local address first.');
          activeRun = true;
          let run = store.put('modelDownloads', { status: 'running', phase: 'Preparing local Ollama', model: profile.model, createdAt: new Date().toISOString() });
          Promise.resolve().then(() => localSetup(profile.model, phase => { run = store.put('modelDownloads', { ...run, phase }); })).then(() => store.put('modelDownloads', { ...run, status: 'completed', phase: 'Local model is ready. Select Ollama, save settings and test the connection.', completedAt: new Date().toISOString() })).catch(() => store.put('modelDownloads', { ...run, status: 'failed', error: 'Local setup could not finish. Check available disk space/network, install Ollama from its official site if needed, then retry.' })).finally(() => { activeRun = false; });
          return send(202, { id: run.id, status: run.status });
        }
        return send(404, { error: 'AI endpoint not found.' });
      }
      if (path.startsWith('/api/codex/')) {
        if (req.headers['x-jobos-token'] !== store.get('settings', 'main').token) return send(401, { error: 'JobOS token required for AI workflow endpoints.' });
        if (path === '/api/codex/cv-source' && req.method === 'GET') return send(200, await cv.load());
        if (path === '/api/codex/cv-source' && req.method === 'PUT') return send(200, await cv.save(body.source, body.expectedHash));
        if (path === '/api/codex/cv-source/starter' && req.method === 'POST') {
          const master = await cv.load(); if (master.exists) return send(409, { error: 'main.tex already exists. Reload or edit it instead.' });
          return send(201, await cv.save(starterLatex(store.get('settings', 'main').resume), master.hash));
        }
        if (path === '/api/codex/tailor' && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'An AI workflow or model download is already running. Wait for it to finish.' });
          const job = store.get('jobs', body.jobId); if (!job || job.description.length < 40) throw new Error('Choose a saved opportunity with a full description.');
          const master = await cv.load(); if (!master.exists) throw new Error('Add and save your main.tex CV first.');
          const source = validateLatex(master.source), resume = store.get('settings', 'main').resume;
          if (source.length + resume.length + job.description.length > 160000) throw new Error('The CV and job input are too long. Shorten the master CV or job description.');
          const language = body.language || 'English'; if (!['English', 'French'].includes(language)) throw new Error('Choose English or French.');
          const recipientEmail = clean(body.recipientEmail, 254), recipientName = clean(body.recipientName, 200);
          if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new Error('Enter a valid recipient email, or leave it blank.');
          const ai = backend(), ready = await ai.status('tailor'); if (!ready.ready) return send(503, { error: ready.message });
          if (activeRun) return send(409, { error: 'An AI workflow is already running.' }); activeRun = true;
          const run = store.put('tailorings', { provider: ai.provider, model: ai.model, providerLabel: ai.providerLabel, jobId: job.id, title: job.title, company: job.company, language, recipientEmail, recipientName, templateLocked: true, sourceHash: master.hash, resumeHash: sourceHash(resume), jobUpdatedAt: job.updatedAt, createdAt: new Date().toISOString(), status: 'running' });
          Promise.resolve().then(() => ai.tailor({ source, resume, job, language, recipientName })).then(async output => {
            const result = validateTailoring(output, source); const files = await cv.savePackage(run.id, result, recipientEmail);
            store.put('tailorings', { ...run, ...result, ...files, status: 'completed', completedAt: new Date().toISOString() });
          }).catch(() => store.put('tailorings', { ...run, status: 'failed', error: 'The CV draft could not be completed. Check the selected model connection, context size and standalone template, then retry.' })).finally(() => { activeRun = false; });
          return send(202, { id: run.id, status: run.status });
        }
        const tailoringMatch = path.match(/^\/api\/codex\/tailor\/([^/]+)(?:\/files\/([^/]+))?$/);
        if (tailoringMatch) {
          const [, id, file] = tailoringMatch, run = store.get('tailorings', id); if (!run) return send(404, { error: 'CV draft not found.' });
          if (file && req.method === 'GET') {
            if (run.status !== 'completed' || !run.files?.includes(file)) return send(404, { error: 'File not found.' });
            const text = await cv.readPackageFile(id, file); res.writeHead(200, { 'Content-Type': file === 'main.pdf' ? 'application/pdf' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${file}"` }); return res.end(text);
          }
          if (!file && req.method === 'GET') return send(200, { ...run, stale: run.sourceHash !== (await cv.load()).hash || run.resumeHash !== sourceHash(store.get('settings', 'main').resume) || run.jobUpdatedAt !== store.get('jobs', run.jobId)?.updatedAt });
          if (!file && req.method === 'PUT') {
            if (activeRun) return send(409, { error: 'Wait for the current AI workflow or model download to finish before updating a draft.' });
            if (run.status !== 'completed') throw new Error('Wait for this draft to finish.');
            const result = validateTailoring({ ...run, latex: body.latex ?? run.latex, email: body.email ?? run.email });
            const recipientEmail = body.recipientEmail === undefined ? run.recipientEmail : clean(body.recipientEmail, 254);
            if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new Error('Enter a valid recipient email.');
            activeRun = true;
            try {
              const files = await cv.savePackage(id, result, recipientEmail);
              const reviewedInputs = body.confirmCurrentInputs === true ? { sourceHash: (await cv.load()).hash, resumeHash: sourceHash(store.get('settings', 'main').resume), jobUpdatedAt: store.get('jobs', run.jobId)?.updatedAt } : {};
              const saved = store.put('tailorings', { ...run, ...result, ...files, ...reviewedInputs, recipientEmail, reviewedAt: new Date().toISOString() });
              return send(200, { ...saved, stale: saved.sourceHash !== (await cv.load()).hash || saved.resumeHash !== sourceHash(store.get('settings', 'main').resume) || saved.jobUpdatedAt !== store.get('jobs', saved.jobId)?.updatedAt });
            } finally { activeRun = false; }
          }
        }
        if (path === '/api/codex/status' && req.method === 'GET') return send(200, await backend().status());
        if (path === '/api/codex/scan' && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'An AI workflow or model download is already running. This scan will not start twice.' });
          const settings = store.get('settings', 'main');
          if (settings.resume.length < 40) throw new Error('Upload your CV before starting automation.');
          const ai = backend(), ready = await ai.status('scan'); if (!ready.ready) return send(503, { error: ready.message });
          if (activeRun) return send(409, { error: 'An AI workflow is already running.' });
          activeRun = true;
          const resumeHash = createHash('sha256').update(settings.resume).digest('hex');
          let run = store.put('scans', { provider: ai.provider, model: ai.model, providerLabel: ai.providerLabel, status: 'running', phase: 'Starting manual search workflow', createdAt: new Date().toISOString() });
          Promise.resolve().then(() => performAutomatedScan({
            settings: { ...settings, resumeHash, rankInputBudget: ai.inputBudget, rankBatchSize: ai.rankBatchSize }, knownJobs: store.list('jobs'), ignoredUrls: dismissedUrls(), isIgnored: isDismissed, companies: store.list('companies'), rankings: store.list('rankings'), search: ai.search, research: ai.research, rank: ai.rank, hydrate: hydrator, saveJob: ingest,
            progress: phase => { run = store.put('scans', { ...run, phase }); },
            saveCompany: company => {
              store.put('companies', { ...company, id: createHash('sha256').update(company.name.toLowerCase()).digest('hex').slice(0, 24) });
              for (const member of company.recruitmentTeam || []) if (!store.list('contacts').some(c => c.name.toLowerCase() === member.name.toLowerCase() && c.company.toLowerCase() === company.name.toLowerCase())) store.put('contacts', { name: member.name, role: member.role, company: company.name, email: '', linkedin: member.profileUrl || '', notes: `${member.status}\nSource: ${member.sourceUrl}` });
              for (const email of company.contacts || []) if (!store.list('contacts').some(c => c.email.toLowerCase() === email.email.toLowerCase())) store.put('contacts', { name: `Recruitment contact — ${company.name}`, role: 'Published business contact; role unverified', company: company.name, email: email.email, linkedin: '', notes: `${email.status}\nSource: ${email.sourceUrl}` });
            }
          })).then(result => {
            let rankingId = '';
            if (result.report) rankingId = store.put('rankings', { ...result.report, provider: ai.provider, model: ai.model, providerLabel: ai.providerLabel, status: 'completed', createdAt: run.createdAt, completedAt: new Date().toISOString(), jobIds: result.rankedJobs.map(j => j.id), jobUpdatedAt: Object.fromEntries(result.rankedJobs.map(j => [j.id, j.updatedAt])), resumeHash, preferencesHash: result.preferencesHash }).id;
            const { report, rankedJobs, ...summary } = result;
            store.put('scans', { ...run, ...summary, rankingId, status: 'completed', completedAt: new Date().toISOString() });
          }).catch(error => store.put('scans', { ...run, status: 'failed', error: clean(error.message, 500) })).finally(() => { activeRun = false; });
          return send(202, { id: run.id, status: run.status });
        }
        const scanId = path.match(/^\/api\/codex\/scan\/([^/]+)$/)?.[1];
        if (scanId && req.method === 'GET') { const run = store.get('scans', scanId); return send(run ? 200 : 404, run || { error: 'Scan not found.' }); }
        if (path === '/api/codex/search' && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'An AI workflow or model download is already running. Wait for it to finish.' });
          const preferences = { ...searchPreferences(body), knownUrls: store.list('jobs').map(job => job.url).filter(Boolean), excludedUrls: dismissedUrls() };
          const ai = backend(), ready = await ai.status('search'); if (!ready.ready) return send(503, { error: ready.message });
          if (activeRun) return send(409, { error: 'An AI workflow is already running.' });
          activeRun = true;
          store.put('settings', { ...store.get('settings', 'main'), searchDomains: preferences.domains.join(', '), searchLocation: preferences.location, searchLevel: preferences.level, searchExclude: preferences.exclude, searchMaxAgeDays: preferences.maxAgeDays, searchIncludeReview: preferences.includeReview });
          const run = store.put('searches', { provider: ai.provider, model: ai.model, providerLabel: ai.providerLabel, status: 'running', createdAt: new Date().toISOString(), preferences });
          Promise.resolve().then(() => ai.search(preferences)).then(result => store.put('searches', { ...run, ...result, jobs: result.jobs.filter(job => !isDismissed(job)), status: 'completed', completedAt: new Date().toISOString() })).catch(error => store.put('searches', { ...run, status: 'failed', error: clean(error.message, 500) })).finally(() => { activeRun = false; });
          return send(202, { id: run.id, status: run.status });
        }
        const searchMatch = path.match(/^\/api\/codex\/search\/([^/]+)(\/save)?$/);
        if (searchMatch) {
          const run = store.get('searches', searchMatch[1]); if (!run) return send(404, { error: 'Search not found.' });
          if (req.method === 'GET' && !searchMatch[2]) return send(200, run);
          if (req.method === 'POST' && searchMatch[2]) {
            if (run.status !== 'completed' || !Number.isInteger(body.index) || !run.jobs?.[body.index]) throw new Error('Choose a job from a completed search.');
            const job = run.jobs[body.index], result = ingest({ ...job, notes: [job.verification, job.postedAt ? `Posted: ${job.postedAt}` : '', `Search evidence: ${job.evidence}`].filter(Boolean).join('\n') });
            return send(result.created ? 201 : 200, result);
          }
        }
        if (path === '/api/codex/rank' && req.method === 'POST') {
          if (activeRun) return send(409, { error: 'An analysis is already running. Wait for it to finish.' });
          const resume = clean(store.get('settings', 'main').resume, 50000);
          if (resume.length < 40) throw new Error('Upload or paste your CV before ranking jobs.');
          if (!Array.isArray(body.jobIds) || !body.jobIds.length || body.jobIds.length > 10 || new Set(body.jobIds).size !== body.jobIds.length) throw new Error('Select between 1 and 10 distinct jobs.');
          const jobs = body.jobIds.map(id => store.get('jobs', id));
          if (jobs.some(j => !j || j.description.trim().length < 40)) throw new Error('Every selected job needs a description of at least 40 characters. Capture or paste its full description first.');
          if (jobs.reduce((n, j) => n + j.description.length, resume.length) > 120000) throw new Error('Selected content is too long. Rank fewer jobs at once.');
          const ai = backend(), ready = await ai.status('rank'); if (!ready.ready) return send(503, { error: ready.message });
          // Re-check after the asynchronous sign-in check to prevent concurrent starts.
          if (activeRun) return send(409, { error: 'An analysis is already running.' });
          activeRun = true;
          const settings = store.get('settings', 'main');
          const run = store.put('rankings', { provider: ai.provider, model: ai.model, providerLabel: ai.providerLabel, status: 'running', createdAt: new Date().toISOString(), jobIds: body.jobIds, researchContacts: body.researchContacts === true, resumeHash: createHash('sha256').update(resume).digest('hex'), preferencesHash: preferenceFingerprint(settings), jobUpdatedAt: Object.fromEntries(jobs.map(j => [j.id, j.updatedAt])) });
          Promise.resolve().then(() => ai.rank({ resume, jobs, preferences: automationPreferences(settings), researchContacts: run.researchContacts })).then(result => store.put('rankings', { ...run, status: 'completed', completedAt: new Date().toISOString(), ...result })).catch(error => store.put('rankings', { ...run, status: 'failed', error: clean(error.message, 500) })).finally(() => { activeRun = false; });
          return send(202, { id: run.id, status: run.status });
        }
        const runId = path.match(/^\/api\/codex\/rank\/([^/]+)$/)?.[1];
        if (runId && req.method === 'GET') { const run = store.get('rankings', runId); return send(run ? 200 : 404, run || { error: 'Analysis not found.' }); }
      }
      if (path === '/api/export' && req.method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename=jobos-workspace.json'); const { token, ...settings } = store.get('settings', 'main'); return send(200, { version: 1, exportedAt: new Date().toISOString(), jobs: store.list('jobs'), dismissedJobs: store.list('dismissedJobs'), contacts: store.list('contacts'), reminders: store.list('reminders'), alerts: store.list('alerts'), settings }); }
      if ((path === '/api/jobs' || path === '/api/capture') && req.method === 'POST') {
        if (path === '/api/capture' && req.headers['x-jobos-token'] !== store.get('settings', 'main').token) return send(401, { error: 'Pair the extension with the token in Settings.' });
        const result = ingest(body); return send(result.created ? 201 : 200, result);
      }
      const item = path.match(/^\/api\/(jobs|contacts|reminders|alerts)\/([^/]+)$/);
      if (item) {
        const [, kind, id] = item, existing = store.get(kind, id);
        if (!existing) return send(404, { error: 'Record not found.' });
        if (req.method === 'DELETE') {
          store.db.exec('BEGIN');
          try {
            if (kind === 'jobs' && existing.url) store.put('dismissedJobs', { id: postingId(existing.url), url: jobUrl(existing.url), deletedAt: new Date().toISOString() });
            store.remove(kind, id);
            if (kind === 'jobs') for (const k of ['reminders', 'alerts']) for (const r of store.list(k)) if (r.jobId === id) store.remove(k, r.id);
            store.db.exec('COMMIT');
          } catch (error) { store.db.exec('ROLLBACK'); throw error; }
          return send(200, { ok: true });
        }
        if (req.method === 'PATCH') {
          let fields;
          if (kind === 'jobs') {
            fields = validateJob({ ...existing, ...body });
            if (isDismissed(fields)) return send(409, { error: 'You previously deleted this posting. It will not be added again.' });
            if (fields.url && store.list('jobs').some(j => j.id !== id && j.url && jobUrl(j.url) === fields.url)) return send(409, { error: 'This job URL is already saved.' });
          } else if (kind === 'reminders') fields = { done: body.done === true };
          else if (kind === 'alerts') fields = { read: body.read === true };
          else fields = contact({ ...existing, ...body });
          const saved = store.put(kind, { ...existing, ...fields, updatedAt: new Date().toISOString() });
          if (kind === 'jobs') updateAlert(saved);
          return send(200, saved);
        }
      }
      if (path === '/api/contacts' && req.method === 'POST') return send(201, store.put('contacts', contact(body)));
      if (path === '/api/reminders' && req.method === 'POST') {
        if (!clean(body.title) || !Number.isFinite(Date.parse(body.dueAt))) throw new Error('A reminder title and valid due date are required.');
        if (body.jobId && !store.get('jobs', body.jobId)) throw new Error('Choose an existing job.');
        return send(201, store.put('reminders', { title: clean(body.title, 300), dueAt: new Date(body.dueAt).toISOString(), jobId: body.jobId || '', done: false }));
      }
      if (path === '/api/settings' && req.method === 'PUT') {
        const settings = store.get('settings', 'main');
        if ('searchDomains' in body || 'searchMaxAgeDays' in body || 'searchIncludeReview' in body) {
          const preferences = searchPreferences({ domains: body.searchDomains ?? settings.searchDomains, location: body.searchLocation, level: body.searchLevel, exclude: body.searchExclude, maxAgeDays: body.searchMaxAgeDays ?? settings.searchMaxAgeDays, includeReview: body.searchIncludeReview ?? settings.searchIncludeReview });
          settings.searchMaxAgeDays = preferences.maxAgeDays;
          settings.searchIncludeReview = preferences.includeReview;
        }
        if ('minimumFit' in body) {
          const score = Number(body.minimumFit);
          if (!Number.isInteger(score) || score < 0 || score > 100 || body.minimumFit === '') throw new Error('Minimum fit must be a whole number from 0 to 100.');
          settings.minimumFit = score;
        }
        for (const key of ['name', 'keywords', 'locations', 'exclude', 'resume', 'searchDomains', 'searchLocation', 'searchLevel', 'searchExclude', 'automationId', 'automationCadence']) if (key in body) settings[key] = clean(body[key], key === 'resume' ? 50000 : 1000);
        return send(200, store.put('settings', settings));
      }
      if (path === '/api/import-email' && req.method === 'POST') {
        const jobs = await extractEmailJobs(clean(body.raw, 1400000)); let imported = 0;
        for (const job of jobs) if (ingest(job).created) imported++;
        return send(200, { found: jobs.length, imported });
      }
      if (path === '/api/check-mail' && req.method === 'POST') { try { return send(200, await checkMail()); } catch (e) { return send(400, { error: e.message }); } }
      if (path.startsWith('/api/')) return send(404, { error: 'Route not found.' });
      if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
      const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/domain.js': '../lib/domain.js', '/opportunities-view.js': 'opportunities-view.js', '/application-tools.js': 'application-tools.js', '/tailoring-view.js': 'tailoring-view.js', '/job-order.js': 'job-order.js', '/ai-settings-view.js': 'ai-settings-view.js' };
      if (!files[path]) return send(404, { error: 'File not found.' });
      const content = await readFile(resolve(root, files[path]));
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' })[extname(files[path])], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" }); res.end(content);
    } catch (e) { send(e.status || 400, { error: e.message || 'Request failed.' }); }
  });
  server.once('listening', () => {
    for (const kind of ['rankings', 'searches', 'scans', 'tailorings', 'modelDownloads']) for (const run of store.list(kind)) if (run.status === 'running') store.put(kind, { ...run, status: 'failed', error: 'The server restarted during this workflow. Please retry.' });
  });
  return { server, store, ingest, checkMail };
}
function contact(body) {
  if (!clean(body.name)) throw new Error('Contact name is required.');
  const email = clean(body.email, 300); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return { name: clean(body.name, 200), company: clean(body.company, 200), role: clean(body.role, 200), email, linkedin: jobUrl(body.linkedin), notes: clean(body.notes) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log(`JobOS is ready at http://127.0.0.1:${app.server.address().port}`));
  if (mailboxConfigured()) { app.checkMail().catch(() => {}); setInterval(() => app.checkMail().catch(() => {}), 300000).unref(); }
}
