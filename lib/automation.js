import { extractTechnologies, jobUrl } from './domain.js';
import { automationPreferences, preferenceFingerprint } from './profile.js';
import { contactPurpose } from './public-contacts.js';
import { selectSearchMatches } from './search-policy.js';
import { uniqueSearchWarnings, searchSummary } from './search-warnings.js';
import { scanSites } from './job-sites.js';
export { automationPreferences } from './profile.js';
export async function performAutomatedScan({ settings, knownJobs, searchSite = 'all', ignoredUrls = [], isIgnored = () => false, companies = [], rankings = [], search, research, rank, hydrate, saveJob, saveCompany, progress = () => {} }) {
  const sites = scanSites(searchSite);
  const preferences = { ...automationPreferences(settings), ...(searchSite === 'indeed' ? { jobSite: 'indeed' } : {}) }, warnings = [];
  const ignored = new Set([...ignoredUrls, ...knownJobs.filter(job => job.stage === 'Closed').map(job => job.url)].filter(Boolean).map(jobUrl));
  const shouldIgnore = job => job.stage === 'Closed' || ignored.has(jobUrl(job.url)) || isIgnored(job);
  knownJobs = knownJobs.filter(job => !shouldIgnore(job));
  if ((settings.resume || '').trim().length < 40) throw new Error('Upload your CV before starting a search.');
  if (hydrate) {
    progress('Checking saved job descriptions');
    try { for (const update of await hydrate(knownJobs)) { if (shouldIgnore(update)) continue; const result = saveJob(update); if (result.job) knownJobs = knownJobs.map(j => j.id === result.job.id ? result.job : j); } }
    catch (error) { warnings.push(`Description refresh: ${error.message}`); }
  }
  const found = { jobs: [], closedJobUrls: [], searchSuggestions: [], summary: '' }, sourceResults = [], seen = new Set(), summaries = [];
  const sourceJobs = new Map();
  let lastFailure;
  for (const site of sites) {
    const label = site === 'indeed' ? 'Indeed' : 'LinkedIn and company careers';
    progress(`Searching ${label} using your saved domains and publication window`);
    for (const job of knownJobs) if (job.url && isIgnored(job)) ignored.add(jobUrl(job.url));
    const discoveryPreferences = { ...preferences, jobSite: site, includeEmployerSites: true, knownUrls: [...knownJobs, ...found.jobs].filter(j => !shouldIgnore(j)).map(j => j.url).filter(Boolean), excludedUrls: [...ignored] };
    try {
      const raw = await search(discoveryPreferences);
      const result = selectSearchMatches(raw, discoveryPreferences);
      const retained = [];
      for (const job of result.jobs) {
        const url = jobUrl(job.url);
        if (!shouldIgnore(job) && !seen.has(url)) { seen.add(url); found.jobs.push(job); retained.push(job); }
      }
      found.closedJobUrls.push(...(result.closedJobUrls || []));
      found.searchSuggestions.push(...(result.searchSuggestions || []));
      warnings.push(...(result.warnings || []));
      sourceJobs.set(site, { retained, label, excluded: raw.jobs.some(shouldIgnore) });
      summaries.push(`${label}: ${result.summary}`);
      sourceResults.push({ jobSite: site, status: 'completed', jobCount: retained.length });
    } catch (error) {
      lastFailure = error;
      const warning = `${label}: ${error.message}`;
      warnings.push(warning); summaries.push(warning);
      sourceResults.push({ jobSite: site, status: 'failed', error: error.message });
    }
  }
  if (sourceResults.every(source => source.status === 'failed')) throw Object.assign(new Error(uniqueSearchWarnings(summaries).join('\n'), { cause: lastFailure }), { sourceResults });
  found.closedJobUrls = [...new Set(found.closedJobUrls)];
  found.searchSuggestions = [...new Set(found.searchSuggestions)];
  const saved = [], newJobIds = [], closedJobs = [...(found.closedJobUrls || [])];
  for (const job of found.jobs) {
    if (shouldIgnore(job)) continue;
    if (/closed/i.test(job.verification || '') || job.availabilityStatus === 'closed') { if (!closedJobs.includes(job.url)) closedJobs.push(job.url); if (knownJobs.some(j => j.url === job.url)) { const result = saveJob(job); if (result.job) saved.push(result.job); } continue; }
    const result = saveJob(job); if (!result.job) continue; saved.push(result.job); if (result.created) newJobIds.push(result.job.id);
  }
  const allJobs = [...saved, ...knownJobs.filter(j => !saved.some(s => s.id === j.id))].filter(job => !shouldIgnore(job));
  const eligible = job => !shouldIgnore(job) && !['Closed', 'Offer'].includes(job.stage) && !/closed/i.test(job.verification || '') && job.availabilityStatus !== 'closed';
  const names = [...new Set(allJobs.filter(eligible).map(j => j.company))];
  const missingCompanies = names.filter(name => !companies.some(c => c.name.toLowerCase() === name.toLowerCase() && c.researchVersion === 2 && Date.now() - Date.parse(c.researchedAt) < ((c.contacts?.some(e => contactPurpose(e.email) === 'recruitment') || c.recruitmentTeam?.length) ? 7 : 1) * 86400000));
  const researched = [];
  for (let offset = 0; offset < missingCompanies.length; offset += 6) {
    const requested = missingCompanies.slice(offset, offset + 6);
    const context = allJobs.filter(job => eligible(job) && requested.includes(job.company));
    const batch = [...new Set(context.map(job => job.company))];
    if (!batch.length) continue;
    progress(`Researching employers and recruiting contacts (${offset + 1}-${Math.min(offset + 6, missingCompanies.length)} of ${missingCompanies.length})`);
    try {
      const results = await research(batch, context.map(j => ({ company: j.company, title: j.title, location: j.location, url: j.url })));
      for (const company of results) { saveCompany({ ...company, researchVersion: 2, researchedAt: new Date().toISOString() }); researched.push(company); }
    } catch (error) {
      warnings.push(`Employer research: ${error.message}`);
      // Public-source blocks are cached for the workflow. Preserve the jobs
      // and proceed to comparisons instead of repeating blocked batches.
      if (['PUBLIC_SEARCH_BLOCKED', 'SEARCH_SOURCE_BLOCKED'].includes(error.code)) break;
    }
  }
  const preferencesHash = preferenceFingerprint(settings);
  const current = job => rankings.some(r => r.status === 'completed' && r.resumeHash === settings.resumeHash && r.preferencesHash === preferencesHash && r.jobUpdatedAt?.[job.id] === job.updatedAt);
  const candidates = allJobs.filter(job => eligible(job) && (job.description || '').length >= 40 && !current(job));
  const batches = [], rankedJobs = [], reports = [];
  const inputBudget = settings.rankInputBudget || 120000;
  let batch = [], characters = settings.resume.length;
  for (const job of candidates) {
    if (settings.resume.length + job.description.length > inputBudget) { warnings.push(`A saved description is too long for the selected model; increase its context or choose another provider.`); continue; }
    if (batch.length >= (settings.rankBatchSize || 10) || characters + job.description.length > inputBudget) { batches.push(batch); batch = []; characters = settings.resume.length; }
    batch.push(job); characters += job.description.length;
  }
  if (batch.length) batches.push(batch);
  for (const [index, jobs] of batches.entries()) {
    const eligibleJobs = jobs.filter(eligible); if (!eligibleJobs.length) continue;
    progress(`Comparing opportunities with your CV (batch ${index + 1} of ${batches.length})`);
    try { reports.push(await rank({ resume: settings.resume, jobs: eligibleJobs, preferences, researchContacts: false })); rankedJobs.push(...eligibleJobs); }
    catch (error) { warnings.push(`CV comparison: ${error.message}`); }
  }
  // A job can be closed while a later source, employer lookup or comparison is in flight.
  const visible = saved.filter(job => !shouldIgnore(job));
  const ranked = rankedJobs.filter(eligible);
  const rankedIds = new Set(ranked.map(j => j.id));
  for (const [index, source] of sourceResults.entries()) {
    if (source.status !== 'completed') continue;
    const { retained, label, excluded } = sourceJobs.get(source.jobSite);
    source.jobCount = retained.filter(job => !shouldIgnore(job)).length;
    if (excluded || source.jobCount < retained.length) summaries[index] = `${label}: ${source.jobCount} source-checked opportunities retained.`;
  }
  const report = reports.length && ranked.length ? { summary: reports.map(r => r.summary).join('\n'), rankings: reports.flatMap(r => r.rankings).filter(r => rankedIds.has(r.jobId)).sort((a, b) => b.score - a.score) } : null;
  return {
    summary: searchSummary(summaries.join('\n'), warnings), sourceResults, searchSuggestions: found.searchSuggestions || [], newJobIds: newJobIds.filter(id => visible.some(j => j.id === id)), savedJobIds: visible.map(j => j.id), closedJobs: closedJobs.filter(url => !shouldIgnore({ url })), companiesResearched: researched.length, warnings: uniqueSearchWarnings(warnings),
    technologies: visible.map(j => ({ jobId: j.id, company: j.company, technologies: extractTechnologies(j.description) })),
    report, rankedJobs: ranked, preferences, preferencesHash,
    pendingDescriptions: allJobs.filter(j => eligible(j) && (j.description || '').length < 40).length,
    pendingRankings: allJobs.filter(j => eligible(j) && (j.description || '').length >= 40 && !rankedJobs.some(c => c.id === j.id) && !current(j)).length
  };
}
