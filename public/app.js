import { stages, analyzeResume, jobUrl } from '/domain.js';
import { dailyOpportunities, filterOpportunities, opportunityCards } from '/opportunities-view.js';
import { applicationContacts, applicationList, availabilityReview, closeOpportunityButton, searchNowButton } from '/application-tools.js';
import { orderJobs, matchesPublication } from '/job-order.js';
import { tailoringPage, tailoringResult, emailDraftUrl } from '/tailoring-view.js';
import { aiModelsPage, updateAIForm, modelDownloadStatus, groundingSuggestions, aiQuotaHelp, searchAccessHelp, localModelCatalog } from '/ai-settings-view.js';
import { uniqueSearchWarnings, searchSummary, searchFailureText, searchRunSource, searchSourceLabel } from '/search-warnings.js';
import { helpPage } from '/help-view.js';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const route = () => ['', 'daily', 'offers'].includes(location.hash.slice(1)) ? 'pipeline' : location.hash.slice(1);
let lastSearchOnly = false;
let state, page = route(), query = '', view = page === 'board' ? 'board' : 'list', filter = 'Saved', jobOrder = 'detected', jobPosted = 'all', toastTimer;
const dailyFilters = { range: 'all', mode: 'all', query: '', order: 'newest', posted: 'recent' };
let texMaster = null, texLoading = false, texDirty = false, tailorJobId = '', tailorResult = null;
let installedModels = [], installedModelsLoaded = false, downloadModelChoice = '';
let connectionLost = false, lastStatusCheck = null, polling = false, offersDirty = false, searchSubmitting = false;
const codexBusy = () => searchSubmitting || ['scans', 'searches', 'rankings', 'tailorings', 'modelDownloads'].some(kind => state?.[kind]?.some(r => r.status === 'running'));
const pendingIndeed = () => state?.scans?.find(r => r.browserIndeed && ['running', 'waiting_browser', 'paused'].includes(r.status));
const indeedLaunched = new Set();
function updateSearchControls() {
  const pending = pendingIndeed(), paused = pending && pending.status !== 'running', busy = codexBusy();
  for (const button of document.querySelectorAll('[data-action="scan-now"], #linkedin-search-form button[type="submit"], #linkedin-search-form button:not([type])')) {
    button.disabled = connectionLost || busy;
    button.setAttribute('aria-busy', String(busy && !connectionLost));
    button.textContent = connectionLost ? 'Reconnect to search' : busy ? pending?.status === 'running' ? 'Searching Indeed in Chrome…' : 'Search in progress…' : paused ? 'Start a new search' : '⌕ Search now';
    button.title = paused ? 'Ends the paused Indeed step and searches again from LinkedIn. All saved offers and contacts are kept.' : connectionLost ? 'Waiting for the local JobOS server.' : 'Search LinkedIn, company career pages and Indeed';
  }
}
async function startSearchNow(preferences) {
  if (codexBusy() || connectionLost) throw new Error('Wait for the current workflow or reconnect before searching.');
  const previous = pendingIndeed();
  searchSubmitting = true; updateSearchControls();
  try {
    if (preferences) await api('settings', 'PUT', preferences);
    if (previous) await api('codex/scan/' + previous.id + '/browser', 'POST', { action: 'stop', expectedStatus: previous.status });
    await api('codex/scan', 'POST', { jobSite: 'all' });
    await refresh();
    toast('Search started now. LinkedIn, company careers and Indeed use your saved preferences.');
  } finally { searchSubmitting = false; updateWorkflowStatus(); }
}
function indeedPanel() {
  const run = pendingIndeed(), installed = document.documentElement.dataset.jobosIndeedSearch === '1';
  if (!run) return '';
  return '<section class="panel indeed-browser-status" role="status"><h2>Indeed in your browser</h2><p>' + esc(run.phase) + '</p>' + (run.status !== 'running' ? '<p>This search is paused, not loading. Choose <strong>Start a new search</strong> to end this Indeed step and search again from LinkedIn. Your saved offers and contacts are kept. Or resume this Indeed step below.</p>' : '') + '<p class="help">' + (installed ? 'Keep Chrome and the Indeed search controller open. If Indeed requests verification, complete it yourself in its tab and resume there.' : 'Open JobOS in Chrome. Reload the JobOS extension (version 0.4+) at chrome://extensions, then refresh JobOS. First install: Load unpacked → select the extension folder inside JOB.') + '</p><div class="actions">' + (run.status !== 'running' ? btn(installed ? 'Open / resume Indeed' : 'Check extension & resume', 'indeed-resume', '', 'data-id="' + esc(run.id) + '"') : '') + btn('Stop Indeed · keep saved offers', 'indeed-stop', '', 'data-id="' + esc(run.id) + '"') + '</div></section>';
}
async function launchIndeed(id) {
  if (document.documentElement.dataset.jobosIndeedSearch !== '1') throw new Error('Reload JobOS extension version 0.4+ in Chrome, then refresh this page.');
  indeedLaunched.add(id);
  const result = await api('codex/scan/' + id + '/browser', 'POST', {});
  window.dispatchEvent(new CustomEvent('jobos-start-indeed', { detail: result.ticket }));
}
window.addEventListener('jobos-indeed-launch-failed', () => toast('Could not open the Indeed controller. Check the extension pairing address; the saved search can be resumed.'));
function autoLaunchIndeed() {
  const run = pendingIndeed();
  if (run?.status === 'waiting_browser' && !indeedLaunched.has(run.id) && document.documentElement.dataset.jobosIndeedSearch === '1') launchIndeed(run.id).catch(e => toast(e.message));
}
function indeedSettings() {
  return `<section class="panel"><h2>Indeed search connection</h2><form id="indeed-settings" class="form-grid"><label class="full">Indeed source<select name="indeedSearchMode"><option value="browser" ${state.settings.indeedSearchMode !== 'provider' ? 'selected' : ''}>Chrome session · JobOS extension (recommended)</option><option value="provider" ${state.settings.indeedSearchMode === 'provider' ? 'selected' : ''}>Configured search provider · server access</option></select></label><label class="full">Indeed opportunities<select name="indeedOpportunityScope" aria-describedby="indeed-scope-help"><option value="preferences" ${state.settings.indeedOpportunityScope !== 'morocco-junior-remote' ? 'selected' : ''}>Use general location and experience preferences</option><option value="morocco-junior-remote" ${state.settings.indeedOpportunityScope === 'morocco-junior-remote' ? 'selected' : ''}>Morocco roles + junior remote</option></select></label><p id="indeed-scope-help" class="help full">Morocco roles + junior remote covers your domains in Morocco, including titles without “junior”, and excludes explicit senior or advanced requirements. Remote roles outside Morocco need junior/entry-level evidence; known country restrictions are excluded. Unconfirmed locations and Morocco eligibility stay flagged for review. Existing saved offers are kept.</p><div class="actions full"><button class="btn">Save Indeed settings</button><button type="button" class="btn" data-action="indeed-setup-test">Check Indeed browser setup</button></div></form><p class="help">Search now runs LinkedIn first, then Indeed. Browser mode needs Chrome and JobOS extension 0.4+. If challenged, complete verification yourself and Resume. Provider mode uses server requests and may receive HTTP 403. The general live-search test does not test Indeed.</p></section>`;
}
const aiName = () => state?.ai?.provider === 'codex' ? 'Codex' : state?.ai?.label || 'Codex';
function searchAttemptNotice(run) {
  const then = searchRunSource(run), current = state.ai?.provider === 'codex' ? 'codex' : state.ai?.searchProvider;
  const when = Date.parse(run.createdAt) ? new Date(run.createdAt).toLocaleString() : 'Date not recorded';
  return `<div class="help search-attempt-notice"><p>Saved search attempt: ${esc(when)}. Search used: <strong>${esc(searchSourceLabel(then))}</strong>. Current search: <strong>${esc(searchSourceLabel(current))}</strong>.</p><p>${then && then !== current ? 'Your search settings have changed since this attempt. ' : ''}This is a saved report, not a new test of your current setup. Open <a href="#models">AI models</a>, test the current model/search, then start Search now when ready. <a href="#help">Setup help</a>.</p></div>`;
}
async function loadInstalledModels() {
  const result = await api('ai/local/models');
  installedModels = result.models; installedModelsLoaded = true;
  if ($('#installed-local-models')) $('#installed-local-models').innerHTML = localModelCatalog(installedModels, state.ai.provider === 'ollama' ? state.ai.profiles.ollama.model : '', true);
  updateWorkflowStatus();
}
function updateWorkflowStatus() {
  const target = $('#workflow-status'); if (!target || !state) return;
  const tasks = ['scans', 'searches', 'rankings', 'tailorings', 'modelDownloads'].flatMap(kind => (state[kind] || []).map(run => ({ kind, run })));
  autoLaunchIndeed();
  const active = tasks.find(task => task.run.status === 'running') || tasks.find(task => ['waiting_browser', 'paused'].includes(task.run.status) && task.run.browserIndeed);
  const latest = active || tasks.sort((a, b) => (Date.parse(b.run.createdAt) || 0) - (Date.parse(a.run.createdAt) || 0))[0];
  const names = { scans: latest?.run.jobSite === 'all' ? 'LinkedIn + Indeed search' : latest?.run.jobSite === 'indeed' ? 'Indeed search' : 'Search', searches: 'Job search', rankings: 'CV comparison', tailorings: latest?.run.mode === 'analysis' ? 'Offer analysis' : 'CV draft', modelDownloads: latest?.run.tool === 'searxng' ? 'Local search setup' : 'Local model download' };
  const links = { scans: '#automation', searches: '#search', rankings: '#codex', tailorings: '#tailor', modelDownloads: '#models' };
  const savedWarnings = uniqueSearchWarnings(latest?.run.warnings || []);
  const accessHelp = searchAccessHelp(latest?.run.status === 'failed' ? [latest.run.error || ''] : savedWarnings, state.ai);
  let title = '', detail = '', help = '';
  if (connectionLost) {
    title = 'Cannot reach JobOS';
    detail = 'The displayed status may be outdated. Keep the app terminal open; JobOS will check the connection again automatically.';
  } else if (latest) {
    const { kind, run } = latest;
    if (run.status === 'running') {
      title = `${names[kind]} in progress`;
      const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(run.createdAt)) / 60000));
      const elapsed = Number.isFinite(minutes) ? (minutes < 1 ? 'Less than a minute elapsed' : `${minutes} minute${minutes === 1 ? '' : 's'} elapsed`) : 'Just started';
      detail = `${run.phase || ({ scans: 'Starting the search workflow', searches: 'Searching public job postings', rankings: 'Comparing jobs with your CV', tailorings: 'Preparing your CV and email draft' })[kind]} · ${elapsed}`;
      help = kind === 'modelDownloads' ? run.tool === 'searxng' ? 'Installing or starting local SearXNG through Docker Desktop. No CV data is used.' : 'Downloading Ollama and the local model. This sends no CV data and does not use Codex.' : run.model ? `Using ${run.providerLabel || aiName()} · ${run.model}. You can keep using JobOS and this chat. Source checks and local inference can take several minutes.` : 'This is a separate background Codex run; you can keep using JobOS and this chat. A full search checks postings, saves verified offers, so it can take more than 10 minutes.';
    } else if (run.browserIndeed && ['waiting_browser', 'paused'].includes(run.status)) {
      title = 'Indeed is waiting for your browser'; detail = run.phase; help = 'LinkedIn results are already saved. No AI model is running for this paused step.';
    } else if (run.status === 'failed') {
      title = `${names[kind]} needs attention`;
      detail = (['scans', 'searches'].includes(kind) ? searchFailureText(run.error) : run.error) || 'This task did not finish. Open its details before retrying.';
      if (['scans', 'searches'].includes(kind)) help = `This is the saved failure from that attempt. ${state.ai?.searchProvider === 'gemini' ? `Your current Gemini search model is ${state.ai.searchModel}. ` : ''}${state.ai?.provider === 'codex' ? 'Check the AI connection before retrying.' : 'Test live search in AI models before retrying.'}`;
      if (['scans', 'searches'].includes(kind) && /Ollama · local|Local Ollama/.test(detail)) help = 'This is the saved failure from that attempt. Test saved model in AI models checks local generation; Test live search checks public websites separately.';
    } else if (run.status === 'completed') {
      title = `${names[kind]} completed${['scans', 'searches'].includes(kind) && accessHelp ? ' with limited coverage' : ''}`;
      detail = kind === 'scans' ? `${run.newJobIds?.length || 0} new opportunities saved · ${run.companiesResearched || 0} employers researched` : kind === 'searches' ? `${run.jobs?.length || 0} public postings found` : 'Your results are ready to review.';
      if (savedWarnings.length) detail += ` · ${savedWarnings.length} warning${savedWarnings.length === 1 ? '' : 's'} to review`;
    }
  }
  if (latest?.run.browserIndeed && latest.run.status === 'running') help = 'Reading Indeed in your Chrome session. No CV or local model is used for this step.';
  target.innerHTML = title ? `<section class="panel workflow-status ${connectionLost || latest?.run.status === 'failed' ? 'workflow-warning' : ''}"><div><strong>${esc(title)}</strong><p class="help">${esc(detail)}</p>${help ? `<p class="help">${esc(help)}</p>` : ''}${lastStatusCheck ? `<small class="muted">Status checked ${esc(lastStatusCheck.toLocaleTimeString())}</small>` : ''}</div><div class="actions">${!connectionLost && latest ? `<a class="btn" href="${links[latest.kind]}">View details</a>` : ''}${btn('Refresh status', 'refresh-status')}</div></section>` : '';
  if (!connectionLost && latest?.run.status === 'failed') target.querySelector('.workflow-status > div').insertAdjacentHTML('beforeend', aiQuotaHelp(latest.run.error));
  if (!connectionLost && latest?.run.status === 'failed' && ['scans', 'searches'].includes(latest.kind)) target.querySelector('.workflow-status > div').insertAdjacentHTML('beforeend', searchAttemptNotice(latest.run));
  if (!connectionLost && accessHelp) target.querySelector('.workflow-status > div').insertAdjacentHTML('beforeend', accessHelp);
  document.querySelectorAll('[data-action="scan-now"], #linkedin-search-form button[type="submit"], #linkedin-search-form button:not([type]), #codex-rank-form button, #tailor-form button, #ai-config-form button, [data-action="setup-local-model"], [data-action="use-local-model"], [data-action="use-local-search"], [data-action="setup-local-search"], #local-model-download-form button, [data-action="use-installed-model"]').forEach(button => { button.disabled = connectionLost || codexBusy(); });
  updateSearchControls();
  let panel = $('#indeed-browser-status'); if (!panel) { panel = document.createElement('div'); panel.id = 'indeed-browser-status'; target.after(panel); } panel.innerHTML = indeedPanel();
  const aiForm = $('#ai-config-form'), searchTest = $('[data-action="ai-search-test"]');
  if (searchTest) searchTest.disabled = connectionLost || codexBusy() || aiForm.elements.provider.value === 'codex' || aiForm.elements.searchProvider.value === 'none';
  if (page === 'models' && $('#local-model-status')) $('#local-model-status').innerHTML = modelDownloadStatus(state.modelDownloads?.[0]?.tool === 'searxng' ? null : state.modelDownloads?.[0]);
  if (page === 'models' && $('#local-search-status')) $('#local-search-status').innerHTML = state.modelDownloads?.[0]?.tool === 'searxng' ? modelDownloadStatus(state.modelDownloads[0]) : '';
}
const titles = { board: 'Application board', 'daily-report': 'Historical fit reports', help: 'Help & local setup', models: 'AI models', tailor: 'CV & email tailoring', daily: 'Daily opportunities', pipeline: 'Offers', search: 'Job search', automation: 'Search history & employers', alerts: 'Discover & alerts', reminders: 'Follow-ups', contacts: 'People', studio: 'Career studio', codex: 'CV & AI ranking', settings: 'Settings & integrations' };
async function api(path, method = 'GET', body) { const headers = body ? { 'Content-Type': 'application/json' } : {}; if (path.startsWith('codex/') || path.startsWith('ai/') || path.startsWith('availability-check')) headers['X-JobOS-Token'] = state?.settings.token || ''; const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: path === 'state' ? AbortSignal.timeout(10000) : undefined }); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Something went wrong.'); return data; }
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5500); }
async function refresh() { state = await api('state'); connectionLost = false; lastStatusCheck = new Date(); render(); }
async function loadTex() {
  if (texLoading) return; texLoading = true;
  try { texMaster = await api('codex/cv-source'); texDirty = false; if (page === 'tailor') { $('#tex-source').value = texMaster.source; $('#tex-source-status').textContent = texMaster.exists ? 'Loaded main.tex from this workspace.' : 'Upload, paste or create your main.tex to begin.'; } }
  catch (error) { toast(error.message); }
  finally { texLoading = false; }
}
async function saveTex() {
  if (!texMaster) throw new Error('Wait for main.tex to load.');
  texMaster = await api('codex/cv-source', 'PUT', { source: $('#tex-source').value, expectedHash: texMaster.hash }); texDirty = false;
  $('#tex-source-status').textContent = 'Saved main.tex. The previous source is backed up.';
}
async function showTailoring(id) {
  const result = await api(`codex/tailor/${id}`); tailorResult = result;
  if (page === 'tailor' && $('#tailoring-result')) $('#tailoring-result').innerHTML = tailoringResult(result);
}
async function startTailoring(values, analysisOnly = false) {
  if (codexBusy() || connectionLost) throw new Error('Wait for the current workflow or reconnect before preparing an application.');
  if (texDirty) await saveTex();
  const analysisId = !analysisOnly && tailorResult?.analysisReady && tailorResult.jobId === values.jobId && tailorResult.language === values.language ? tailorResult.id : undefined;
  const run = await api('codex/tailor', 'POST', { ...values, ...(analysisOnly ? { analysisOnly: true } : {}), ...(analysisId ? { analysisId } : {}) });
  tailorJobId = values.jobId; tailorResult = { ...run, jobId: values.jobId, language: values.language, recipientEmail: values.recipientEmail, recipientName: values.recipientName };
  await refresh(); await showTailoring(run.id);
  toast(analysisOnly ? 'Reading the offer: requirements, CV evidence and CV/email priorities.' : 'Analyzing the offer before preparing your CV and email.');
}
async function updateTailoring(next) {
  if (page !== 'tailor') return;
  if (tailorResult?.status === 'running') { const latest = next.tailorings?.find(r => r.id === tailorResult.id); if (latest && (latest.status !== 'running' || latest.phase !== tailorResult.phase || latest.analysisReady !== tailorResult.analysisReady)) await showTailoring(latest.id); }
  document.querySelectorAll('#tailor-form button').forEach(button => { button.disabled = codexBusy(); button.textContent = codexBusy() ? `${aiName()} is working…` : button.dataset.action === 'analyze-offer' ? 'Analyze offer first' : 'Tailor CV & write email'; });
}
function updateDailyCards() {
  const items = filterOpportunities(state.opportunities, dailyFilters);
  $('#daily-cards').innerHTML = opportunityCards(items);
  $('#daily-result-count').textContent = `${items.length} opportunities · Dates in Morocco time`;
}
const date = v => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function heading(eyebrow, title, subtitle, action = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtext">${subtitle}</p></div>${action}</div>`; }
function empty(symbol, title, text, action = '') { return `<div class="empty"><div class="empty-symbol">${symbol}</div><h2>${title}</h2><p>${text}</p>${action}</div>`; }
function btn(label, action, cls = '', attrs = '') { return `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`; }
const options = (items, selected) => items.map(v => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
function render() {
  if (!titles[page]) page = 'pipeline';
  $('#breadcrumb').textContent = titles[page]; $('#job-count').textContent = state.jobs.filter(j => j.stage === 'Saved' && !j.expiredAt).length; $('#alert-count').textContent = state.alerts.filter(a => !a.read).length;
  $('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('#main').innerHTML = ({ help: helpPage, models: () => aiModelsPage(state, { downloadModel: downloadModelChoice || state.ai.profiles.ollama.model, models: installedModels, loaded: installedModelsLoaded }), tailor: () => tailoringPage(state, { master: texMaster, selectedJobId: tailorJobId, result: tailorResult }), 'daily-report': () => dailyOpportunities(state, dailyFilters), board: pipeline, pipeline, alerts, reminders, contacts, studio, settings, codex, search: searchPage, automation: automationPage })[page]();
  $('#main').insertAdjacentHTML('afterbegin', '<div id="workflow-status" role="status" aria-live="polite"></div>');
  if (page === 'pipeline' || page === 'board' || page === 'daily-report') {
    $('.page-heading').insertAdjacentHTML('afterend', `<section class="panel" id="availability-review">${availabilityReview(state.jobs, state.availabilityCheck)}</section>`);
  }
  updateWorkflowStatus();
  if (page === 'models') updateAIForm(document, state.ai);
  if (page === 'tailor' && texMaster === null) loadTex();
}
function pipeline() {
  const last = state.scans?.[0];
  const failed = (last?.sourceResults || []).filter(s => ['failed', 'partial', 'skipped'].includes(s.status));
  return heading('YOUR JOB SEARCH', 'Offers', 'Review new postings, find a recruiting contact, and prepare a CV and email when you choose.', '<div class="actions heading-actions">' + searchNowButton(codexBusy()) + btn('＋ Add opportunity', 'add-job') + '</div>')
    + (last ? '<div class="panel" role="status"><strong>' + (last.newJobIds?.length || 0) + ' new in last search</strong>' + (last.status === 'running' ? ' · Search in progress' : '') + failed.map(s => ' · ' + (s.jobSite === 'indeed' ? 'Indeed' : 'LinkedIn and company careers') + ' incomplete ' + btn('Retry ' + (s.jobSite === 'indeed' ? 'Indeed' : 'LinkedIn and company careers'), 'retry-source', '', 'data-site="' + esc(s.jobSite) + '" data-run="' + esc(last.id) + '"' + (codexBusy() ? ' disabled' : ''))).join('') + '</div>' : '')
    + `<div class="toolbar application-toolbar"><div class="tabs">${btn('New in last search', 'last-search-filter', lastSearchOnly ? 'selected' : '', 'aria-pressed="' + lastSearchOnly + '"')}</div><div class="tools"><input class="search" id="search" aria-label="Search opportunities" placeholder="Search opportunities…" value="${esc(query)}"><label>Publication<select id="job-posted" aria-label="Filter applications by publication date">${[['all', 'All saved'], ['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['unknown', 'Date unconfirmed']].map(([value, label]) => `<option value="${value}" ${jobPosted === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Sort<select id="job-sort" aria-label="Sort applications">${[['newest', 'Latest posted'], ['detected', 'Recently detected']].map(([value, label]) => `<option value="${value}" ${jobOrder === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Stage<select id="stage-filter" aria-label="Filter by stage">${options(['All stages', ...stages, 'Expired'], filter)}</select></label></div></div>`
    + `<div id="jobs-area">${jobArea()}</div><p class="section-note">Latest posted uses source dates; relative dates are approximate and unknown dates appear last. Open an opportunity for details or choose Tailor CV & email.</p>`;
}
function jobArea() {
  const lastIds = new Set(state.scans?.[0]?.newJobIds || []);
  const jobs = orderJobs(state.jobs.filter(j => (!lastSearchOnly || lastIds.has(j.id)) && matchesPublication(j, jobPosted) && `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All stages' || (filter === 'Expired' ? !!j.expiredAt : j.stage === filter && !(filter === 'Saved' && j.expiredAt)))), jobOrder);
  if (view === 'list' || filter === 'Expired') return jobs.length ? applicationList(jobs, state.opportunities.items, stages) : empty('⌕', 'No opportunities here yet', 'Add an opportunity or try another search.');
  return `<div class="board">${stages.filter(s => filter === 'All stages' || s === filter).map(s => { const group = jobs.filter(j => j.stage === s && !(s === 'Saved' && j.expiredAt)); return `<section class="column"><div class="column-header"><span class="dot"></span>${s}<span class="count">${group.length}</span><button data-action="add-job" data-stage="${s}" aria-label="Add to ${s}">＋</button></div>${group.map(j => `<article class="job-card"><button class="job-card-open" data-action="edit-job" data-id="${j.id}"><div class="company-line"><span class="company-icon">${esc(j.company.slice(0, 2).toUpperCase())}</span>${esc(j.company)}</div><h3>${esc(j.title)}</h3><div class="location">${esc(j.location || 'Location not added')}</div>${j.salary ? `<div class="tags"><span class="tag">${esc(j.salary)}</span></div>` : ''}<div class="job-bottom"><span>${esc(j.source)}</span><span>${date(j.createdAt)}</span></div></button>${applicationContacts(state.opportunities.items.find(item => item.jobId === j.id), true)}<button class="btn card-tailor" data-action="prepare-job" data-id="${j.id}">Tailor CV & email</button>${closeOpportunityButton(j)}</article>`).join('') || `<div class="empty-column">Room for your next<br>${s === 'Offer' ? 'great offer' : 'opportunity'}.</div>`}</section>`; }).join('')}</div>`;
}
function alerts() {
  const configured = state.mailbox.configured;
  return heading('KEEP YOUR SEARCH MOVING', 'The right roles, within reach.', 'Capture what catches your eye. Let your preferences sort the signal.', btn('↻ Check mailbox', 'check-mail')) + `<div class="grid-two"><section class="panel"><h2>Your matching preferences</h2><p><strong>Job search fields</strong><br>${esc(state.settings.searchDomains || "No fields saved")}${state.settings.searchLevel ? " · " + esc(state.settings.searchLevel) : ""} · <a class="text-link" href="#search">Edit search preferences</a></p><p class="help">Alert keywords and locations are comma-separated. Match any keyword and any location, with no excluded terms. Blank fields match everything. Applies when jobs are captured or edited.</p><form id="preferences" class="form-grid"><label class="full">Role or skill keywords<input name="keywords" placeholder="Frontend, React, full stack" value="${esc(state.settings.keywords)}"></label><label>Locations<input name="locations" placeholder="Remote, Casablanca" value="${esc(state.settings.locations)}"></label><label>Exclude<input name="exclude" placeholder="Senior, unpaid" value="${esc(state.settings.exclude)}"></label><div class="full"><button class="btn primary">Save preferences</button></div></form><div class="actions"><a class="btn" href="https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(state.settings.keywords)}&location=${encodeURIComponent(state.settings.locations)}" target="_blank" rel="noopener noreferrer">Open LinkedIn search ↗</a></div><p class="help">Enable job-alert emails on LinkedIn for your search. JobOS detects offers from those emails; it does not crawl LinkedIn.</p></section><section class="panel"><h2>Bring your alerts into JobOS</h2><p class="help">Import a LinkedIn alert email (.eml), or paste its source below. Job links are deduplicated automatically. Missing details can be filled in on the job card.</p><form id="email-import"><label>Email source or job links<textarea name="raw" placeholder="Paste a LinkedIn job-alert email or job links…" required></textarea></label><div class="actions"><button class="btn primary">Import opportunities</button><label class="btn file-label">Choose .eml file<input type="file" id="email-file" accept=".eml,text/plain,message/rfc822" aria-label="Import email file"></label></div></form><p class="help">${configured ? '● Mailbox connected in configuration. Checks run every 5 minutes while the server is running.' : 'Automatic inbox checks are not connected yet. Configure your mailbox in Settings.'}</p>${state.mailbox.lastCheck ? `<p class="help">Last successful check: ${esc(new Date(state.mailbox.lastCheck).toLocaleString())}</p>` : ''}${state.mailbox.error ? `<p class="error-inline">${esc(state.mailbox.error)}</p>` : ''}</section></div><section class="panel"><h2>Matching opportunities <span class="muted">· ${state.alerts.length}</span></h2>${state.alerts.length ? state.alerts.map(a => `<div class="row ${a.read ? '' : 'alert-unread'}"><div><h3>${esc(a.title)}</h3><p>${esc(a.company)} · ${date(a.createdAt)}${a.reasons.length ? ` · Matched: ${esc(a.reasons.join(', '))}` : ' · Matches your open preferences'}</p></div><div class="actions">${btn('View job', 'edit-job', '', `data-id="${a.jobId}"`)}${!a.read ? btn('Mark read', 'read-alert', '', `data-id="${a.id}"`) : '<span class="help">Read</span>'}</div></div>`).join('') : empty('⌁', 'Your next match is out there', 'Save your preferences, then capture a job or import a LinkedIn job-alert email.')}</section>`;
}
function reminders() {
  const rows = [...state.reminders].sort((a, b) => Number(a.done) - Number(b.done) || new Date(a.dueAt) - new Date(b.dueAt));
  return heading('GOOD TIMING MATTERS', 'Keep the conversation going.', 'A thoughtful follow-up, right when you need it.', btn('＋ Add follow-up', 'add-reminder', 'primary')) + `<section class="panel">${rows.length ? rows.map(r => { const j = state.jobs.find(j => j.id === r.jobId); return `<div class="row"><div class="${r.done ? 'done' : ''}"><h3>${esc(r.title)}</h3><p class="${!r.done && Date.parse(r.dueAt) < Date.now() ? 'overdue' : ''}">${esc(new Date(r.dueAt).toLocaleString())}${j ? ` · ${esc(j.company)} / ${esc(j.title)}` : ''}</p></div><div class="actions">${btn(r.done ? 'Reopen' : 'Mark done', 'toggle-reminder', '', `data-id="${r.id}"`)}${btn('Delete', 'delete-reminder', '', `data-id="${r.id}"`)}</div></div>`; }).join('') : empty('◷', 'Make room for a follow-up', 'Schedule a recruiter check-in or a thank-you after an interview.', btn('Plan a follow-up', 'add-reminder', 'primary'))}</section><p class="help">Due reminders appear in this workspace. Enable browser notifications in Settings for reminders while the app is open.</p>`;
}
function contacts() { return heading('OPPORTUNITIES START WITH PEOPLE', 'Build real connections.', 'Recruiters, hiring managers, and the people in your corner.', btn('＋ Add contact', 'add-contact', 'primary')) + `<section class="panel">${state.contacts.length ? state.contacts.map(c => `<div class="row"><div><h3>${esc(c.name)}</h3><p>${esc([c.role, c.company].filter(Boolean).join(' · '))}</p><p>${esc(c.email)}</p>${/^https?:\/\//i.test(c.sourceUrl || '') ? '<a class="text-link" href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Contact source ↗</a>' : ''}${c.notes ? `<p>${esc(c.notes)}</p>` : ''}</div><div class="actions">${c.linkedin ? `<a class="btn" href="${esc(c.linkedin)}" target="_blank" rel="noopener noreferrer">Profile ↗</a>` : ''}${btn('Edit', 'edit-contact', '', `data-id="${c.id}"`)}</div></div>`).join('') : empty('♧', 'Your network, thoughtfully organized', 'Save a contact and keep the context that makes your next conversation easier.', btn('Add your first contact', 'add-contact', 'primary'))}</section>`; }
function studio() { return heading('PREPARE WITH PURPOSE', 'Put your best words forward.', 'A practical resume check and a starting point for your next introduction.') + `<div class="banner"><span class="banner-icon">✧</span><div><strong>Local tools. Your words stay here.</strong><p>Keyword comparison and editable templates. Use CV & AI ranking for AI analysis.</p></div></div><div class="grid-two"><section class="panel"><h2>Resume keyword check</h2><form id="analyze"><label>Your resume text<textarea name="resume" rows="8" required placeholder="Paste your resume text…">${esc(state.settings.resume)}</textarea></label><div class="actions"></div><label>Compare with a saved job<select name="jobId" required><option value="">Choose an opportunity</option>${state.jobs.map(j => `<option value="${j.id}">${esc(j.title)} — ${esc(j.company)}</option>`).join('')}</select></label><div class="actions"><button class="btn primary">Compare keywords</button></div></form><div id="analysis-result"></div><p class="help">Checks a fixed dictionary of common skills. This is not an ATS score or a hiring prediction. Only add skills you actually have.</p></section><section class="panel"><h2>Outreach draft</h2><form id="draft-form" class="form-grid"><label>Your name<input name="name" value="${esc(state.settings.name)}" required></label><label>Contact name<input name="recipient" placeholder="Alex" required></label><label class="full">Opportunity<select name="jobId" required><option value="">Choose an opportunity</option>${state.jobs.map(j => `<option value="${j.id}">${esc(j.title)} — ${esc(j.company)}</option>`).join('')}</select></label><label class="full">Your relevant experience<textarea name="experience" placeholder="One truthful sentence about your experience…" required></textarea></label><div class="full"><button class="btn primary">Create draft</button></div></form><div id="draft-result"></div><p class="help">Templates only. Review and personalize before sending. JobOS never sends messages.</p></section></div>`; }
function settings() { return '<section class="panel"><h2>Your search and CV</h2><div class="actions"><a class="btn" href="#search">Search preferences</a><a class="btn" href="#tailor">Master main.tex &amp; drafts</a></div></section>' + `<section class="panel"><h2>AI provider & model</h2><p class="help">Choose Codex, Gemini, Kimi, a local Ollama model or another compatible API.</p><a class="btn primary" href="#models">Open AI models</a></section>` + heading('MAKE IT YOURS', 'A workspace that works for you.', 'Connect your tools and take care of your data.') + `<div class="grid-two"><section class="panel"><h2>Profile</h2><form id="profile"><label>Your name<input name="name" value="${esc(state.settings.name)}" placeholder="Your name"></label><div class="actions"><button class="btn primary">Save profile</button></div></form><h2>Notifications</h2><p class="help">Show new matches and due follow-ups while this page is open. Notification delivery depends on browser permissions.</p>${btn('Enable browser notifications', 'notifications')}<h2>Backup</h2><p class="help">Your records live in data/jobos.sqlite on this computer. Download a portable JSON export below. Keep it somewhere private.</p>${btn('↓ Export workspace', 'export')}</section><section class="panel"><h2>Chrome capture extension</h2><ol class="help"><li>Open Chrome’s extension manager and enable Developer mode.</li><li>Choose “Load unpacked” and select the project’s extension folder.</li><li>Copy the pairing token below into the extension’s settings.</li><li>Open a LinkedIn job, click the extension, review the details, and save.</li></ol><label>Pairing token<input type="password" id="pair-token" readonly value="${esc(state.settings.token)}"></label><div class="actions">${btn('Copy pairing token', 'copy-token')}</div><p class="help">Keep the local JobOS server running. LinkedIn page changes can affect extraction; the extension always lets you correct the captured fields.</p></section><section class="panel full"><h2>Automatic LinkedIn job-alert detection</h2><p class="help">${state.mailbox.configured ? 'Configured' : 'Not connected'} · Set up LinkedIn job-alert emails first. Copy .env.example to .env in the project folder, then enter your mailbox settings and restart JobOS.</p><div class="code">IMAP_HOST=imap.your-provider.com<br>IMAP_PORT=993<br>IMAP_USER=you@example.com<br>IMAP_PASSWORD=your-app-password<br>IMAP_FOLDER=INBOX</div><p class="help">Uses encrypted IMAP with an app password. Providers that require OAuth-only access need an additional integration. Reads up to 100 matching emails from the last 7 days every 5 minutes, without changing read status. No emails are sent. Direct LinkedIn job links are imported; tracking-only links may need manual capture. Checks require this server and computer to stay on.</p>${btn('Check mailbox now', 'check-mail')}</section></div>`; }
function modal(title, html) { $('#modal-content').innerHTML = `<div class="modal-heading"><h2>${title}</h2><button class="close" data-action="close" aria-label="Close dialog">×</button></div>${html}<p id="form-error" class="error-inline" role="alert"></p>`; $('#modal').showModal(); }
function searchPage() {
  const s = state.settings, running = codexBusy();
  return heading('SEARCH WHEN YOU CHOOSE', 'Find recent roles in your domains.', 'Recent offers first, plus older or undated roles to check. No fixed result count.') + indeedSettings() + `<section class="panel"><form id="linkedin-search-form" class="form-grid"><label class="full">Your target domains<input name="domains" value="${esc(s.searchDomains || 'Data science, Machine learning, AI engineering, Full-stack development, Data engineering')}" placeholder="AI engineering, Data engineering, Full-stack development" required></label><label>Preferred location<input name="location" value="${esc(s.searchLocation || 'Morocco and remote roles')}" placeholder="Morocco, Rabat, Remote"></label><label>Experience level<select name="level">${options(['Any experience level', 'Internship', 'Graduate / Entry level', 'Mid level', 'Senior'], s.searchLevel || 'Graduate / Entry level')}</select></label><label>Exclude terms<input name="exclude" value="${esc(s.searchExclude ?? 'unpaid, senior')}" placeholder="Unpaid, senior, freelance"></label><label>Posted within<select name="maxAgeDays">${['1', '7', '14', '30'].map(value => `<option value="${value}" ${value === String(s.searchMaxAgeDays || 30) ? 'selected' : ''}>${value === '1' ? 'Last 24 hours' : `Last ${value} days`}</option>`).join('')}</select></label><label class="check full"><input type="checkbox" name="includeReview" value="true" ${s.searchIncludeReview !== false ? 'checked' : ''}>Broader coverage: also check older or undated openings</label><div class="actions full"><button class="btn primary" ${running ? 'disabled' : ''}>${running ? `${aiName()} is searching…` : '⌕ Search now'}</button><button type="button" class="btn" data-action="save-search-preferences">Save domains</button></div></form><p class="help">Search now searches LinkedIn, company career pages and Indeed in one workflow, saves verified offers immediately, then looks up their employers. It covers saved domains with role-title synonyms, Morocco and eligible remote variants. With broader coverage enabled, a second pass checks readable older or undated postings; these need availability review and do not appear as fresh offers. Your CV is not used in public search queries. Private or inaccessible postings may be missed; coverage is not exhaustive.</p><div id="search-message" role="status"></div></section><div id="scan-result">${scanResult()}</div><div id="search-results">${searchResults()}</div>`;
}
function searchResults() {
  const run = state.searches?.[0];
  if (!run) return empty('⌕', 'Choose a direction. Find your next role.', `Enter your professional domains above, then let ${esc(aiName())} search LinkedIn, company career pages and Indeed.`);
  if (run.status === 'running') return `<section class="panel"><h2>${esc(run.providerLabel || 'Codex')} is searching LinkedIn postings…</h2><p class="help">Looking for roles in ${esc(run.preferences.domains.join(', '))}${run.preferences.location ? ` · ${esc(run.preferences.location)}` : ''}. This screen updates automatically.</p></section>`;
  if (run.status === 'failed') return `<section class="panel"><h2>Saved search could not finish</h2><p class="error-inline">${esc(searchFailureText(run.error))}</p>${searchAttemptNotice(run)}</section>`;
  const closed = new Set(state.jobs.filter(job => (job.stage === 'Closed' || job.expiredAt) && job.url).map(job => jobUrl(job.url)));
  const visible = run.jobs.map((job, index) => ({ job, index })).filter(({ job }) => !closed.has(jobUrl(job.url)));
  return `<section class="panel"><h2>${visible.length} opportunit${visible.length === 1 ? 'y' : 'ies'} found</h2><p class="help">${visible.length === run.jobs.length ? esc(run.summary) : 'Closed and expired postings are hidden.'}</p><p class="help">Search completed ${esc(new Date(run.completedAt).toLocaleString())}. Open the posting to confirm it is still accepting applications.</p></section>${visible.length ? visible.map(({ job: j, index }) => { const saved = state.jobs.find(item => item.url === j.url), dismissed = state.dismissedJobUrls?.includes(j.url); return `<section class="panel"><div class="eyebrow">${esc(j.company)}</div><h2>${esc(j.title)}</h2><p class="help">${esc(j.location || 'Location not available')}${j.postedAt ? ` · ${esc(j.postedAt)}` : ''}</p><p class="help">${esc(j.verification)}</p>${/-review$/.test(j.discoveryBucket || '') ? `<p class="help"><strong>${j.discoveryBucket === 'older-review' ? 'Older posting' : 'Date unconfirmed'}</strong> — confirm hiring is still active. ${esc(j.availabilityEvidence || '')}</p>` : ''}<blockquote class="help">${esc(j.evidence)}</blockquote><p class="help">${j.description ? 'Description available for CV comparison.' : 'Use the extension on this posting to capture its full description before ranking.'}</p><div class="actions"><a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Open LinkedIn posting ↗</a>${dismissed ? '<span class="help">Previously deleted — this posting will not be added again.</span>' : saved ? btn('View saved opportunity', 'edit-job', '', `data-id="${saved.id}"`) : btn('Save opportunity', 'save-search-job', 'primary', `data-run="${run.id}" data-index="${index}"`)}</div></section>`; }).join('') : empty('⌕', 'No reliable public results found', 'Try broader domains or locations, or use LinkedIn search in Chrome and capture a job with the extension.')}` + groundingSuggestions(run.searchSuggestions);
}
function updateSearchResults() {
  if (page !== 'search' || !$('#search-results')) return;
  $('#search-results').innerHTML = searchResults();
  updateSearchControls();
}
function automationPage() {
  const run = state.scans?.[0], s = state.settings;
  return heading('MANUAL SEARCH WORKSPACE', 'Search history & employers.', 'New roles, required technologies, and recruiting contacts in one place.', searchNowButton(codexBusy())) + `<section class="panel"><h2>Manual search only</h2><p class="help">${esc(s.searchDomains || 'Data science, Machine learning, AI engineering, Full-stack development, Data engineering')} · ${esc(s.searchLocation || 'Morocco and remote roles')} · ${esc(s.searchLevel || 'Graduate / Entry level')}</p><p class="help">Click Search now to search LinkedIn, company career pages and Indeed. There is no hourly schedule. Searches use your saved preferences. New offers appear immediately; separate employer lookups add contacts. No CV is needed.</p><div class="actions"><a href="#search" class="btn">Edit search domains</a><a href="#codex" class="btn">Optional CV rankings</a><a href="#contacts" class="btn">See recruiting contacts</a></div></section><div id="scan-result">${scanResult()}</div><section class="panel"><h2>Employers & recruiting teams</h2>${state.companies?.length ? state.companies.map(c => `<div class="company-research"><h3>${esc(c.name)}</h3><p class="help">${esc(c.industry || 'Industry not confirmed')} · ${esc(c.evidenceStatus)}</p><div class="actions">${c.website ? `<a class="btn" href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Company website ↗</a>` : ''}${c.sourceUrl ? `<a class="btn" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">Research source ↗</a>` : ''}</div>${c.recruitmentTeam.map(m => `<div class="row"><div><strong>${esc(m.name)}</strong><p>${esc(m.role)}</p><p>${esc(m.status)}</p></div><a href="${esc(m.profileUrl || m.sourceUrl)}" class="btn" target="_blank" rel="noopener noreferrer">Professional profile ↗</a></div>`).join('') || '<p class="help">No recruiting team member could be confirmed from accessible sources.</p>'}${c.contacts.map(e => `<div class="row"><div><strong>${esc(e.email)}</strong><p>${esc(e.status)}</p></div><a href="${esc(e.sourceUrl)}" class="btn" target="_blank" rel="noopener noreferrer">Email source ↗</a></div>`).join('')}</div>`).join('') : '<p class="help">Employer research appears after the first completed scan.</p>'}</section>`;
}
function scanResult() {
  const saved = state.scans?.[0];
  const r = saved ? { ...saved, warnings: uniqueSearchWarnings(saved.warnings || []) } : null;
  if (!r) return empty('◷', 'Ready for the next opportunity', 'The first scan will save new offers and research their employers.');
  if (r.browserIndeed && ['waiting_browser', 'paused'].includes(r.status)) return '<section class="panel"><h2>Indeed needs your browser</h2><p>' + esc(r.phase) + '</p><p>' + (r.newJobIds?.length || 0) + ' new offers saved so far.</p></section>';
  if (r.status === 'running') return `<section class="panel"><h2>${esc(r.phase)}</h2><p class="help">The workflow is running in the background. This page updates automatically.</p></section>`;
  if (r.status === 'failed') return `<section class="panel"><h2>Saved search needs attention</h2><p class="error-inline">${esc(searchFailureText(r.error))}</p>${searchAttemptNotice(r)}</section>`;
  return `<section class="panel"><h2>${r.newJobIds.length} new opportunit${r.newJobIds.length === 1 ? 'y' : 'ies'} saved</h2><p class="help">Completed ${esc(new Date(r.completedAt).toLocaleString())} · ${r.companiesResearched || 0} employers researched · ${r.closedJobs?.length || 0} potentially closed listings skipped</p>${r.sourceResults?.length ? `<p class="help source-coverage">${r.sourceResults.map(source => `${source.jobSite === 'indeed' ? 'Indeed' : 'LinkedIn and company careers'}: ${['failed', 'partial', 'skipped'].includes(source.status) ? 'Search incomplete (' + (Number(source.jobCount) || 0) + ' saved)' : `${Number(source.jobCount) || 0} source-checked opportunities`}`).join(' · ')}</p>` : ''}<p class="help">${esc(searchSummary(r.summary, r.warnings))}</p>${r.warnings.map(w => `<p class="error-inline">${esc(w)}</p>`).join('')}<h3>Technologies requested</h3>${(r.technologies || []).filter(item => !state.jobs.some(j => j.id === item.jobId && j.stage === 'Closed')).map(item => { const j = state.jobs.find(j => j.id === item.jobId); return `<div class="row"><div><strong>${esc(j?.title || 'Saved opportunity')} · ${esc(item.company)}</strong><p>${esc(item.technologies.join(', ') || 'Full description needed to extract technologies')}</p></div>${j ? btn('View job', 'edit-job', '', `data-id="${j.id}"`) : ''}</div>`; }).join('')}</section>` + groundingSuggestions(r.searchSuggestions);
}
function updateScanResult() {
  updateSearchControls();
  if (['automation', 'search'].includes(page) && $('#scan-result')) {
    $('#scan-result').innerHTML = scanResult();
  }
}
function codex() {
  const running = state.rankings?.some(r => r.status === 'running');
  return heading('FROM POSSIBILITIES TO PRIORITIES', 'Your CV. Your next best move.', 'Compare your experience with saved roles using the selected AI model.', btn('Check AI connection', 'codex-status')) + `<div id="codex-status" role="status"></div><div class="grid-two"><section class="panel"><h2>1. Add your CV</h2><p class="help">Upload a PDF, DOCX, or TXT file (up to 2 MB), or paste the text. Review the extracted text before ranking. Scanned PDFs need text pasted manually.</p><label class="btn file-label">↑ Upload CV<input id="cv-file" type="file" accept=".pdf,.docx,.txt" aria-label="Upload CV"></label><span id="cv-file-status" class="help">${esc(state.settings.resumeFilename || '')}</span><form id="cv-form"><label class="actions">CV text<textarea name="resume" rows="12" required>${esc(state.settings.resume)}</textarea></label><div class="actions"><button class="btn primary">Save CV text</button></div></form><p class="help">This separate CV input is used only for optional manual ranking. Analysis sends CV text to your selected model; public searches use role and company terms. Original files are not retained.</p></section><section class="panel"><h2>2. Choose opportunities</h2><p class="help">Select up to 10 jobs with full descriptions. Use the Chrome extension or paste the description on a job card first.</p><form id="codex-rank-form"><div class="rank-job-list">${state.jobs.length ? state.jobs.map(j => `<label class="rank-job"><input type="checkbox" name="jobIds" value="${j.id}" ${j.description.length < 40 ? 'disabled' : ''}><span><strong>${esc(j.title)}</strong><small>${esc(j.company)}${j.description.length < 40 ? ' · Add a full description first' : ''}</small></span></label>`).join('') : '<p class="help">No jobs saved yet. Add your first opportunity in Applications.</p>'}</div><label class="check actions"><input name="researchContacts" type="checkbox">Research public recruiting emails</label><p class="help">Optional: search employer careers/contact pages. An email is shown only when found in your saved posting or independently retrieved source page. Role and deliverability are not guaranteed.</p><div class="actions"><button class="btn primary" ${running ? 'disabled' : ''}>${running ? `${aiName()} is analyzing…` : `Send to ${aiName()} & rank`}</button></div><p class="help">Sends your saved CV and selected job descriptions to the provider chosen in AI models. Ollama runs locally; API providers receive the input and have their own usage limits. This starts a separate task and does not call this chat. Public searches use company and role names only.</p></form></section></div><div id="codex-report">${codexReport()}</div>`;
}
function codexReport() {
  const run = state.rankings?.[0];
  if (!run) return empty('↗', 'Your shortlist starts here', `Add your CV, select jobs, and ask ${esc(aiName())} for an explained ranking.`);
  if (run.status === 'running') return `<section class="panel"><h2>${esc(run.providerLabel || 'Codex')} is comparing your opportunities…</h2><p class="help">This can take a few minutes. Results are saved automatically; you can leave this screen.</p></section>`;
  if (run.status === 'failed') return `<section class="panel"><h2>Analysis could not finish</h2><p class="error-inline">${esc(run.error)}</p><p class="help">Check the selected model in AI models, then select jobs and retry.</p></section>`;
  return `<section class="panel"><h2>Your ranked opportunities</h2><p class="help">${esc(run.summary)}</p><p class="help">Snapshot from ${esc(new Date(run.completedAt).toLocaleString())}. Re-run after changing your CV or job descriptions. Scores are qualitative fit estimates, not hiring probabilities.</p></section>${run.rankings.map((r, i) => `<section class="panel"><div class="rank-heading"><div><div class="eyebrow">PRIORITY ${i + 1}</div><h2>${esc(state.jobs.find(j => j.id === r.jobId)?.title || r.title)} · ${esc(r.company)}</h2></div><div class="rank-score">${r.score}<small>/100</small></div></div><p class="help">${esc(r.fit)}</p><div class="grid-two"><div><h3>Why it fits</h3><ul class="help">${r.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div><div><h3>Gaps & questions</h3><ul class="help">${r.gaps.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div></div><p class="help"><strong>Next step:</strong> ${esc(r.nextStep)}</p><h3>Published contact emails</h3>${r.contacts.length ? r.contacts.map(c => `<div class="row"><div><strong>${esc(c.email)}</strong><p>${esc(c.status)}</p></div>${c.sourceUrl ? `<a class="btn" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source ↗</a>` : ''}</div>`).join('') : '<p class="help">No email could be verified in the available sources.</p>'}<div class="actions">${state.jobs.some(j => j.id === r.jobId) ? btn('Open opportunity', 'edit-job', '', `data-id="${r.jobId}"`) : '<span class="help">This opportunity has been deleted.</span>'}</div></section>`).join('')}`;
}
function field(label, name, value = '', full = false, type = 'text', required = false) { return `<label class="${full ? 'full' : ''}">${label}<input type="${type}" name="${name}" value="${esc(value)}" ${required ? 'required' : ''}></label>`; }
function jobModal(id, stage = 'Saved') {
  const j = state.jobs.find(j => j.id === id) || { stage };
  modal(id ? 'Opportunity details' : 'A new possibility', `<form id="job-form" data-id="${id || ''}" class="form-grid">${field('Job title', 'title', j.title, false, 'text', true)}${field('Company', 'company', j.company, false, 'text', true)}${field('Location', 'location', j.location)}${field('Salary / compensation', 'salary', j.salary)}${field('Job URL', 'url', j.url, true, 'url')}<label>Stage<select name="stage">${options(stages, j.stage)}</select></label>${field('Source', 'source', j.source || 'Manual')}<label class="full">Job description<textarea name="description" rows="5">${esc(j.description)}</textarea></label><label class="full">Your notes<textarea name="notes">${esc(j.notes)}</textarea></label><div class="actions full"><button class="btn primary">${id ? 'Save changes' : 'Save opportunity'}</button>${id ? `${btn('Plan follow-up', 'job-reminder', '', `data-id="${id}"`)}${j.url ? `<a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Open posting ↗</a>` : ''}${closeOpportunityButton(j)}${btn('Delete', 'delete-job', 'danger', `data-id="${id}"`)}` : ''}</div></form>${id ? applicationContacts(state.opportunities.items.find(item => item.jobId === id)) + `<div class="actions">${btn('Tailor CV & email', 'prepare-job', 'primary', `data-id="${id}"`)}</div>` : ''}`);
}
function reminderModal(jobId = '') { modal('Make time for a follow-up', `<form id="reminder-form" class="form-grid">${field('What would you like to do?', 'title', '', true, 'text', true)}${field('When', 'dueAt', '', true, 'datetime-local', true)}<label class="full">Related opportunity<select name="jobId"><option value="">General reminder</option>${state.jobs.map(j => `<option value="${j.id}" ${j.id === jobId ? 'selected' : ''}>${esc(j.title)} — ${esc(j.company)}</option>`).join('')}</select></label><div class="full"><button class="btn primary">Save follow-up</button></div></form>`); }
function contactModal(id) { const c = state.contacts.find(c => c.id === id) || {}; modal(id ? 'Edit contact' : 'A new connection', `<form id="contact-form" data-id="${id || ''}" class="form-grid">${field('Name', 'name', c.name, false, 'text', true)}${field('Company', 'company', c.company)}${field('Role', 'role', c.role)}${field('Email', 'email', c.email, false, 'email')}${field('LinkedIn / profile URL', 'linkedin', c.linkedin, true, 'url')}<label class="full">Notes<textarea name="notes">${esc(c.notes)}</textarea></label><div class="actions full"><button class="btn primary">Save contact</button>${id ? btn('Delete', 'delete-contact', 'danger', `data-id="${id}"`) : ''}</div></form>`); }
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const action = el.dataset.action, id = el.dataset.id;
  try {
    if (action === 'ai-reload') { await refresh(); return toast('Current saved AI settings loaded.'); }
    if (['ai-test', 'ai-search-test', 'ai-models'].includes(action)) {
      const isTest = action !== 'ai-models';
      el.disabled = true; $('#ai-message').textContent = action === 'ai-search-test' ? 'Testing live search with a public documentation query…' : isTest ? 'Testing the saved model with synthetic data…' : 'Reading the provider model list…';
      try { const result = await api(action === 'ai-search-test' ? 'ai/search-test' : isTest ? 'ai/test' : 'ai/models', isTest ? 'POST' : 'GET', isTest ? { expectedRevision: $('#ai-config-form').dataset.configRevision } : undefined); if (isTest) { $('#ai-message').textContent = result.message; if (result.searchSuggestions?.length) $('#ai-message').insertAdjacentHTML('beforeend', groundingSuggestions(result.searchSuggestions)); } else { $('#ai-model-options').innerHTML = result.models.map(model => `<option value="${esc(model)}"></option>`).join(''); $('#ai-message').textContent = `${result.models.length} models available. Choose a name and save.`; } } finally { el.disabled = false; }
      $('#ai-message').insertAdjacentHTML('beforeend', aiQuotaHelp($('#ai-message').textContent));
      return;
    }
    if (action === 'use-local-model') {
      const form = $('#ai-config-form'), profile = state.ai.profiles.ollama;
      await api('ai/config', 'PUT', { expectedRevision: form.dataset.configRevision, provider: 'ollama', model: profile.model, baseUrl: profile.baseUrl, contextTokens: state.ai.contextTokens, searchProvider: 'linkedin' });
      await refresh(); return toast('Local Ollama and public search selected. Test the model and live search before use.');
    }
    if (action === 'use-local-search') {
      const form = $('#ai-config-form'), profile = state.ai.profiles.ollama;
      await api('ai/config', 'PUT', { expectedRevision: form.dataset.configRevision, provider: 'ollama', model: profile.model, baseUrl: profile.baseUrl, contextTokens: state.ai.contextTokens, searchProvider: 'searxng', searchBaseUrl: 'http://127.0.0.1:8888' });
      await refresh(); return toast('Local model and local SearXNG selected. Start local search and test both connections.');
    }
    if (action === 'choose-ai-provider') {
      $('#ai-provider').value = el.dataset.provider; updateAIForm(document, state.ai, true);
      $(`[name="key-${el.dataset.provider}"]`).focus(); return toast('Enter your own API key, then Save AI settings and test. Free services have quotas.');
    }
    if (action === 'setup-local-search') { el.disabled = true; await api('ai/search/local/setup', 'POST', {}); await refresh(); return toast('Local search setup started. Start Docker Desktop if setup requests it.'); }
    if (action === 'setup-local-model') { el.disabled = true; await api('ai/local/setup', 'POST', {}); await refresh(); return toast('Local setup started. Progress appears in AI models.'); }
    if (action === 'local-models-refresh') { el.disabled = true; try { await loadInstalledModels(); return toast('Installed models refreshed.'); } finally { el.disabled = codexBusy(); } }
    if (action === 'use-installed-model') {
      await api('ai/local/select', 'POST', { model: el.dataset.model, expectedRevision: state.ai.revision });
      await refresh(); return toast('Downloaded model selected. Search settings kept. Test saved model before use.');
    }
    if (action === 'refresh-status') { await backgroundRefresh(false); return; }
    if (action === 'check-availability') {
      if (document.documentElement.dataset.jobosBrowserReview !== '1') {
        $('#browser-review-help').hidden = false;
        return;
      }
      el.disabled = true;
      try {
        const { report, ticket } = await api('availability-check', 'POST', { mode: 'browser' });
        state.availabilityCheck = report;
        if (ticket) {
          const failed = async () => {
            try {
              await fetch('/api/availability-check/browser', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JobOS-Review': ticket }, body: JSON.stringify({ action: 'pause' }) });
              await refresh();
              if ($('#browser-review-help')) $('#browser-review-help').hidden = false;
            } catch (error) { toast(error.message); }
          };
          window.addEventListener('jobos-review-launch-failed', failed, { once: true });
          setTimeout(() => window.removeEventListener('jobos-review-launch-failed', failed), 15000);
          window.dispatchEvent(new CustomEvent('jobos-start-browser-review', { detail: ticket }));
        }
        render();
      } finally { el.disabled = false; }
      return;
    }
    if (action === 'last-search-filter') { lastSearchOnly = !lastSearchOnly; return render(); }
    if (action === 'indeed-resume') { el.disabled = true; try { await launchIndeed(el.dataset.id); await refresh(); } finally { el.disabled = false; } return; }
    if (action === 'indeed-stop') { await api('codex/scan/' + el.dataset.id + '/browser', 'POST', { action: 'stop' }); await refresh(); return toast('Indeed stopped. All saved offers are kept.'); }
    if (action === 'indeed-setup-test') return toast(document.documentElement.dataset.jobosIndeedSearch === '1' ? 'JobOS extension 0.4+ detected. Site permission is requested on first use. This checks setup, not live access to Indeed.' : 'Open JobOS in Chrome, reload JobOS extension 0.4+, then refresh this page.');
    if (action === 'retry-source') { el.disabled = true; try { await api('codex/scan', 'POST', { jobSite: el.dataset.site, retryOf: el.dataset.run }); await refresh(); return toast('Retrying only the unavailable source.'); } finally { el.disabled = false; } }
    if (action === 'scan-now') return await startSearchNow();
    if (action === 'publication-view') { dailyFilters.posted = el.dataset.view; $('#daily-posted').value = dailyFilters.posted; return updateDailyCards(); }
    if (action === 'prepare-job') { tailorJobId = id; tailorResult = null; $('#modal').close(); location.hash = 'tailor'; if (page === 'tailor') render(); return; }
    if (action === 'reload-tex') return loadTex();
    if (action === 'starter-tex') { texMaster = await api('codex/cv-source/starter', 'POST', {}); texDirty = false; render(); return toast('main.tex created from your saved CV. Review the layout.'); }
    if (action === 'open-tailoring') { await showTailoring(id); tailorJobId = tailorResult.jobId; return render(); }
    if (action === 'analyze-offer') { await startTailoring(Object.fromEntries(new FormData($('#tailor-form'))), true); return; }
    if (action === 'download-tailoring') {
      const response = await fetch(`/api/codex/tailor/${encodeURIComponent(id)}/files/${encodeURIComponent(el.dataset.file)}`, { headers: { 'X-JobOS-Token': state.settings.token } });
      if (!response.ok) throw new Error('The draft file could not be downloaded.');
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = el.dataset.file; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); return;
    }
    if (action === 'copy-draft-field') { const value = $('#tailored-review-form').elements[el.dataset.field]?.value; if (!value) return toast('There is nothing to copy in this field.'); await navigator.clipboard.writeText(value); return toast('Copied.'); }
    if (action === 'copy-tailored-email' || action === 'compose-tailored-email') {
      const values = Object.fromEntries(new FormData($('#tailored-review-form')));
      if (action === 'copy-tailored-email') { await navigator.clipboard.writeText(`Subject: ${values.subject}\n\n${values.body}`); return toast('Email draft copied.'); }
      location.href = emailDraftUrl(values); return;
    }
    if (action === 'save-search-preferences') { const values = Object.fromEntries(new FormData($('#linkedin-search-form'))); values.includeReview = $('#linkedin-search-form [name="includeReview"]').checked; await api('settings', 'PUT', { searchDomains: values.domains, searchLocation: values.location, searchLevel: values.level, searchExclude: values.exclude, searchMaxAgeDays: Number(values.maxAgeDays), searchIncludeReview: values.includeReview }); state.settings = { ...state.settings, searchDomains: values.domains, searchLocation: values.location, searchLevel: values.level, searchExclude: values.exclude, searchMaxAgeDays: Number(values.maxAgeDays), searchIncludeReview: values.includeReview }; return toast('Your search domains are saved.'); }
    if (action === 'save-search-job') { const result = await api(`codex/search/${el.dataset.run}/save`, 'POST', { index: Number(el.dataset.index) }); await refresh(); return toast(result.skipped ? result.reason : result.created ? 'Opportunity saved. Capture its full description in Chrome if needed.' : 'This opportunity is already saved.'); }
    if (action === 'codex-status') { el.disabled = true; const result = await api('codex/status'); $('#codex-status').textContent = result.message; $('#codex-status').className = result.ready ? 'panel help' : 'panel error-inline'; el.disabled = false; return; }
    if (action === 'close') return $('#modal').close();
    if (action === 'add-job') return jobModal(null, el.dataset.stage);
    if (action === 'edit-job') return jobModal(id);
    if (action === 'expire-job' || action === 'expire-unavailable') {
      const jobIds = action === 'expire-job' ? [id] : [...document.querySelectorAll('#unavailable-offers [data-action="expire-job"]')].map(b => b.dataset.id);
      el.disabled = true;
      try {
        const result = await api('availability-check/expire', 'POST', { reviewId: el.dataset.review, jobIds });
        await refresh(); return toast(result.expired + ' marked expired. Contacts and application history kept.');
      } finally { el.disabled = false; }
    }
    if (action === 'close-job') {
      if (state.jobs.find(job => job.id === id)?.stage === 'Closed') return;
      el.disabled = true;
      try {
        const fields = { stage: 'Closed' };
        if (el.dataset.expectedUrl) fields.expectedUrl = el.dataset.expectedUrl;
        await api(`jobs/${id}`, 'PATCH', fields);
        if ($('#modal').open) $('#modal').close();
        await refresh(); return toast('Posting closed. Other openings at this company can still appear. History and notes kept.');
      } finally { el.disabled = false; }
    }
    if (action === 'add-contact' || action === 'edit-contact') return contactModal(id);
    if (action === 'add-reminder') return reminderModal();
    if (action === 'job-reminder') { $('#modal').close(); return reminderModal(id); }
    if (action === 'board-view' || action === 'list-view') { e.preventDefault(); page = action === 'board-view' ? 'board' : 'pipeline'; view = page === 'board' ? 'board' : 'list'; history.replaceState(null, '', '#' + page); return render(); }
    if (action.startsWith('delete-')) {
      if (!confirm(action === 'delete-job' ? 'Delete this offer? JobOS will remember its posting link and skip it in future searches and imports. This cannot be undone.' : 'Delete this record? This cannot be undone.')) return;
      await api(`${{ 'delete-job': 'jobs', 'delete-contact': 'contacts', 'delete-reminder': 'reminders' }[action]}/${id}`, 'DELETE'); $('#modal').close(); await refresh(); return toast(action === 'delete-job' ? 'Offer deleted. This posting will not be added again.' : 'Record deleted.');
    }
    if (action === 'toggle-reminder') { await api(`reminders/${id}`, 'PATCH', { done: !state.reminders.find(r => r.id === id).done }); return refresh(); }
    if (action === 'read-alert') { await api(`alerts/${id}`, 'PATCH', { read: true }); return refresh(); }
    if (action === 'copy-token') { await navigator.clipboard.writeText(state.settings.token); return toast('Pairing token copied.'); }
    if (action === 'copy-draft') { await navigator.clipboard.writeText($('#draft-text').value); return toast('Draft copied.'); }
    if (action === 'check-mail') { el.disabled = true; el.textContent = 'Checking…'; const r = await api('check-mail', 'POST', {}); await refresh(); return toast(r.busy ? 'A mailbox check is already running.' : `${r.imported} new opportunities imported.`); }
    if (action === 'notifications') { if (!('Notification' in window)) throw new Error('This browser does not support notifications.'); const result = await Notification.requestPermission(); toast(result === 'granted' ? 'Notifications enabled while JobOS is open.' : 'Notifications are not enabled. Check your browser settings.'); return; }
    if (action === 'export') { const a = document.createElement('a'); a.href = '/api/export'; a.download = 'jobos-workspace.json'; document.body.append(a); a.click(); a.remove(); }
  } catch (error) { toast(error.message); if (action === 'scan-now') updateSearchControls(); if (action === 'check-mail') await refresh(); }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target, values = Object.fromEntries(new FormData(form)), submit = form.querySelector('[type="submit"],button:not([type])'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'local-model-download-form') {
      downloadModelChoice = values.downloadModel;
      await api('ai/local/setup', 'POST', { model: values.downloadModel, expectedRevision: state.ai.revision });
      await refresh(); if (!codexBusy()) await loadInstalledModels(); toast('Model download started. Progress appears below; your active model is unchanged.');
    }
    if (form.id === 'ai-config-form') {
      const keys = {}, clearKeys = [];
      for (const name of Object.keys(state.ai.keys)) { if (values[`key-${name}`]) keys[name] = values[`key-${name}`]; if (form.elements[`clear-${name}`].checked) clearKeys.push(name); }
      await api('ai/config', 'PUT', { expectedRevision: form.dataset.configRevision, provider: values.provider, model: values.model, baseUrl: values.baseUrl, contextTokens: Number(values.contextTokens), searchProvider: form.elements.searchProvider.value, searchModel: values.searchModel, searchBaseUrl: values.searchBaseUrl, keys, clearKeys }); await refresh(); toast('AI provider saved. Test the model and live search before your next workflow.');
    }
    if (form.id === 'tex-source-form') { await saveTex(); toast('Master CV saved.'); }
    if (form.id === 'tailor-form') {
      await startTailoring(values);
    }
    if (form.id === 'tailored-review-form') {
      tailorResult = await api(`codex/tailor/${form.dataset.id}`, 'PUT', { confirmCurrentInputs: true, latex: values.latex, recipientEmail: values.recipientEmail, email: { subject: values.subject, body: values.body } });
      $('#tailoring-result').innerHTML = tailoringResult(tailorResult); toast('Reviewed CV and email saved.');
    }
    if (form.id === 'fit-preferences') { await api('settings', 'PUT', { minimumFit: Number(values.minimumFit) }); await refresh(); toast('Strong-match threshold saved.'); }
    if (form.id === 'indeed-settings') { await api('settings', 'PUT', { indeedSearchMode: values.indeedSearchMode, indeedOpportunityScope: values.indeedOpportunityScope }); await refresh(); return toast('Indeed settings saved. They apply to your next search.'); }
    if (form.id === 'linkedin-search-form') { await startSearchNow({ searchDomains: values.domains, searchLocation: values.location, searchLevel: values.level, searchExclude: values.exclude, searchMaxAgeDays: Number(values.maxAgeDays), searchIncludeReview: form.elements.includeReview.checked }); }
    if (form.id === 'cv-form') { await api('settings', 'PUT', { resume: values.resume }); state.settings.resume = values.resume; toast('CV text saved.'); }
    if (form.id === 'codex-rank-form') {
      const cvText = $('#cv-form textarea').value;
      if (cvText !== state.settings.resume) { await api('settings', 'PUT', { resume: cvText }); state.settings.resume = cvText; }
      await api('codex/rank', 'POST', { jobIds: new FormData(form).getAll('jobIds'), researchContacts: values.researchContacts === 'on' }); await refresh(); toast(`${aiName()} analysis started.`);
    }
    if (form.id === 'job-form') { const r = await api(form.dataset.id ? `jobs/${form.dataset.id}` : 'jobs', form.dataset.id ? 'PATCH' : 'POST', values); $('#modal').close(); await refresh(); toast(r.skipped ? r.reason : r.created === false ? 'This job is already in your workspace.' : 'Opportunity saved.'); }
    if (form.id === 'contact-form') { await api(form.dataset.id ? `contacts/${form.dataset.id}` : 'contacts', form.dataset.id ? 'PATCH' : 'POST', values); $('#modal').close(); await refresh(); toast('Contact saved.'); }
    if (form.id === 'reminder-form') { values.dueAt = new Date(values.dueAt).toISOString(); await api('reminders', 'POST', values); $('#modal').close(); await refresh(); toast('Follow-up scheduled.'); }
    if (['preferences', 'profile'].includes(form.id)) { await api('settings', 'PUT', values); await refresh(); toast('Preferences saved.'); }
    if (form.id === 'email-import') { const r = await api('import-email', 'POST', values); await refresh(); toast(r.found ? `${r.imported} new opportunities imported. ${r.found - r.imported} already saved or previously deleted.` : 'No direct LinkedIn job links found. Try the original .eml or capture the job in Chrome.'); }
    if (form.id === 'analyze') {
      const job = state.jobs.find(j => j.id === values.jobId); if (!job.description) throw new Error('Add a job description to this opportunity first.');
      const result = analyzeResume(values.resume, job.description); await api('settings', 'PUT', { resume: values.resume }); state.settings.resume = values.resume;
      $('#analysis-result').innerHTML = `<div class="match-score">${result.score === null ? '—' : `${result.score}%`}</div><p class="help">${result.score === null ? 'No skills from the supported dictionary were found in this description.' : 'Coverage of recognized job-description keywords'}</p><h3>Present in your resume</h3>${result.matched.map(s => `<span class="pill">${esc(s)}</span>`).join('') || '<p class="help">None found.</p>'}<h3>Not found in your resume</h3>${result.missing.map(s => `<span class="pill missing">${esc(s)}</span>`).join('') || '<p class="help">No missing recognized keywords.</p>'}`;
    }
    if (form.id === 'draft-form') { const j = state.jobs.find(j => j.id === values.jobId); const draft = `Subject: ${j.title} at ${j.company}\n\nHi ${values.recipient},\n\nI’m interested in the ${j.title} opportunity at ${j.company}. ${values.experience}\n\nI’d appreciate the chance to learn more about the team and how my experience could contribute. Would you be open to a brief conversation?\n\nThank you for your time,\n${values.name}`; $('#draft-result').innerHTML = `<label class="actions">Your editable draft<textarea id="draft-text" rows="13">${esc(draft)}</textarea></label><div class="actions">${btn('Copy draft', 'copy-draft')}</div>`; }
  } catch (error) { const target = form.closest('dialog')?.querySelector('#form-error'); if (target) target.textContent = error.message; else toast(error.message); }
  finally { if (submit) submit.disabled = false; if (form.id === 'linkedin-search-form') updateSearchResults(); }
});
document.addEventListener('input', e => { if (e.target.id === 'search') { query = e.target.value; $('#jobs-area').innerHTML = jobArea(); } if (e.target.id === 'daily-query') { dailyFilters.query = e.target.value; updateDailyCards(); } if (e.target.id === 'tex-source') { texDirty = true; if (texMaster) texMaster.source = e.target.value; $('#tex-source-status').textContent = 'Unsaved edits — saved before tailoring.'; } });
document.addEventListener('change', async e => { try {
  if (e.target.id === 'ai-provider' || e.target.id === 'ai-search-provider') updateAIForm(document, state.ai, e.target.id === 'ai-provider');
  if (e.target.id === 'tex-file') {
    const file = e.target.files[0]; if (!file) return; if (!/\.tex$/i.test(file.name) || file.size > 150000) throw new Error('Choose a .tex file up to 150 KB.');
    if (!texMaster) throw new Error('Wait for the master source to load.'); texMaster.source = await file.text(); texDirty = true; $('#tex-source').value = texMaster.source; $('#tex-source-status').textContent = 'Imported source. Save main.tex to use it.';
  }
  if (e.target.id === 'tailor-job') { tailorJobId = e.target.value; tailorResult = null; render(); }
  if (['daily-range', 'daily-mode', 'daily-sort', 'daily-posted'].includes(e.target.id)) { dailyFilters[{ 'daily-range': 'range', 'daily-mode': 'mode', 'daily-sort': 'order', 'daily-posted': 'posted' }[e.target.id]] = e.target.value; updateDailyCards(); }
  if (e.target.id === 'cv-file') {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a CV smaller than 2 MB.');
    $('#cv-file-status').textContent = ' Extracting CV text…';
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the CV file.')); reader.readAsDataURL(file); });
    const result = await api('resume', 'POST', { filename: file.name, contentBase64: dataUrl.split(',')[1] });
    state.settings.resume = result.text; state.settings.resumeFilename = result.filename;
    $('#cv-form textarea').value = result.text; $('#cv-file-status').textContent = ` ${result.filename} · ${result.characters} characters`; toast('CV imported. Review the extracted text before ranking.');
  }
  if (e.target.id === 'stage-filter') { filter = e.target.value; $('#jobs-area').innerHTML = jobArea(); }
  if (e.target.id === 'job-sort') { jobOrder = e.target.value; $('#jobs-area').innerHTML = jobArea(); }
  if (e.target.id === 'job-posted') { jobPosted = e.target.value; $('#jobs-area').innerHTML = jobArea(); }
  if (e.target.dataset.stageJob) { await api(`jobs/${e.target.dataset.stageJob}`, 'PATCH', { stage: e.target.value }); await refresh(); toast('Stage updated.'); }
  if (e.target.id === 'email-file') { const file = e.target.files[0]; if (!file) return; if (file.size > 1000000) throw new Error('Choose an email smaller than 1 MB.'); const r = await api('import-email', 'POST', { raw: await file.text() }); await refresh(); toast(`${r.imported} new opportunities imported (${r.found} job links found).`); }
} catch (error) { toast(error.message); if (e.target.id === 'cv-file' && $('#cv-file-status')) $('#cv-file-status').textContent = error.message; } });
window.addEventListener('hashchange', () => { page = route(); view = page === 'board' ? 'board' : 'list'; if (state) render(); });
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').close(); });
async function backgroundRefresh(allowRender = true) {
  if (polling) return; polling = true;
  try {
    const next = await api('state');
    connectionLost = false; lastStatusCheck = new Date();
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const item of [...next.alerts.filter(a => !a.read).map(a => ({ key: `alert-${a.id}`, title: 'A new job matches your search', body: `${a.title} · ${a.company}` })), ...next.reminders.filter(r => !r.done && Date.parse(r.dueAt) <= Date.now()).map(r => ({ key: `reminder-${r.id}`, title: 'Time for a follow-up', body: r.title }))]) {
        if (!localStorage.getItem(item.key)) { new Notification(item.title, { body: item.body, tag: item.key }); localStorage.setItem(item.key, '1'); }
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    const availabilityChanged = JSON.stringify(next.availabilityCheck) !== JSON.stringify(state.availabilityCheck);
    const rankingChanged = JSON.stringify(next.rankings) !== JSON.stringify(state.rankings);
    const searchesChanged = JSON.stringify(next.searches) !== JSON.stringify(state.searches);
    const scansChanged = JSON.stringify(next.scans) !== JSON.stringify(state.scans);
    const jobsChanged = JSON.stringify(next.jobs) !== JSON.stringify(state.jobs) || JSON.stringify(next.opportunities) !== JSON.stringify(state.opportunities);
    if (jobsChanged || scansChanged) offersDirty = true;
    state = next;
    if (jobsChanged && ['pipeline', 'board'].includes(page) && $('#jobs-area') && !$('#modal').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) $('#jobs-area').innerHTML = jobArea();
    if (availabilityChanged && $('#availability-review')) $('#availability-review').innerHTML = availabilityReview(state.jobs, state.availabilityCheck);
    updateScanResult();
    await updateTailoring(next);
    if (searchesChanged) updateSearchResults();
    if (rankingChanged && page === 'codex' && $('#codex-report')) {
      $('#codex-report').innerHTML = codexReport();
      const button = $('#codex-rank-form button'), running = state.rankings.some(r => r.status === 'running');
      button.disabled = running; button.textContent = running ? `${aiName()} is analyzing…` : `Send to ${aiName()} & rank`;
    }
    if (((allowRender && changed) || (offersDirty && ['pipeline', 'board'].includes(page))) && !$('#modal').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && ['daily-report', 'board', 'pipeline', 'reminders', 'contacts', 'automation'].includes(page)) { render(); offersDirty = false; }
    updateWorkflowStatus();
    $('#alert-count').textContent = state.alerts.filter(a => !a.read).length;
  } catch { connectionLost = true; updateWorkflowStatus(); }
  finally { polling = false; }
}
refresh().catch(error => { $('#main').innerHTML = empty('!', 'Could not load your workspace', esc(error.message)); });
setInterval(backgroundRefresh, 30000);
setInterval(async () => {
  if (!polling && pendingIndeed() && !codexBusy()) return backgroundRefresh();
  if (!polling && state?.availabilityCheck?.status === 'running' && !codexBusy()) return backgroundRefresh();
  if (!polling && !codexBusy() && state?.employerLookupsPending) return backgroundRefresh();
  if (polling || (!codexBusy() && !connectionLost)) return;
  polling = true;
  try {
    const next = await api('state');
    connectionLost = false; lastStatusCheck = new Date();
    const scanFinished = state.scans?.some(r => r.status === 'running') && !next.scans.some(r => r.status === 'running');
    if (state.availabilityCheck?.status === 'running' || next.availabilityCheck?.status === 'running') {
      state.availabilityCheck = next.availabilityCheck;
      if ($('#availability-review')) $('#availability-review').innerHTML = availabilityReview(next.jobs, next.availabilityCheck);
    }
    const modelFinished = state.modelDownloads?.some(r => r.status === 'running' && r.tool !== 'searxng') && next.modelDownloads?.some(r => r.status === 'completed' && r.tool !== 'searxng');
    state.employerLookupsPending = next.employerLookupsPending; state.rankings = next.rankings; state.searches = next.searches; state.scans = next.scans; state.tailorings = next.tailorings; state.modelDownloads = next.modelDownloads;
    if (['daily-report', 'board', 'pipeline', 'automation'].includes(page) && !$('#modal').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { state = next; render(); }
    await updateTailoring(next);
    updateScanResult();
    updateSearchResults();
    if (page === 'codex' && $('#codex-report')) {
      $('#codex-report').innerHTML = codexReport();
      const button = $('#codex-rank-form button');
      const running = state.rankings.some(r => r.status === 'running'); button.disabled = running; button.textContent = running ? `${aiName()} is analyzing…` : `Send to ${aiName()} & rank`;
    }
    updateWorkflowStatus();
    if (modelFinished && page === 'models') await loadInstalledModels();
  } catch { connectionLost = true; updateWorkflowStatus(); }
  finally { polling = false; }
}, 3000);
