import { extractTechnologies, jobUrl } from './domain.js';
import { automationPreferences, preferenceFingerprint } from './profile.js';
import { contactPurpose } from './public-contacts.js';
import { selectSearchMatches } from './search-policy.js';
export { automationPreferences } from './profile.js';
export async function performAutomatedScan({ settings, knownJobs, ignoredUrls = [], isIgnored = () => false, companies = [], rankings = [], search, research, rank, hydrate, saveJob, saveCompany, progress = () => {} }) {
  const preferences = automationPreferences(settings), warnings = [];
  const ignored = new Set(ignoredUrls.map(jobUrl)), shouldIgnore = job => ignored.has(jobUrl(job.url)) || isIgnored(job);
  knownJobs = knownJobs.filter(job => !shouldIgnore(job));
  if ((settings.resume || '').trim().length < 40) throw new Error('Upload your CV before starting a search.');
  if (hydrate) {
    progress('Checking saved job descriptions');
    try { for (const update of await hydrate(knownJobs)) { const result = saveJob(update); if (result.job) knownJobs = knownJobs.map(j => j.id === result.job.id ? result.job : j); } }
    catch (error) { warnings.push(`Description refresh: ${error.message}`); }
  }
  progress(preferences.includeReview ? 'Searching recent offers and additional postings to review' : 'Searching recent offers in your domains');
  const discoveryPreferences = { ...preferences, includeEmployerSites: true, knownUrls: knownJobs.map(j => j.url).filter(Boolean), excludedUrls: [...ignored] };
  const found = selectSearchMatches(await search(discoveryPreferences), discoveryPreferences);
  warnings.push(...(found.warnings || []));
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
    const batch = missingCompanies.slice(offset, offset + 6);
    progress(`Researching employers and recruiting contacts (${offset + 1}-${Math.min(offset + 6, missingCompanies.length)} of ${missingCompanies.length})`);
    try {
      const results = await research(batch, allJobs.filter(j => batch.includes(j.company)).map(j => ({ company: j.company, title: j.title, location: j.location, url: j.url })));
      for (const company of results) { saveCompany({ ...company, researchVersion: 2, researchedAt: new Date().toISOString() }); researched.push(company); }
    } catch (error) { warnings.push(`Employer research: ${error.message}`); }
  }
  const preferencesHash = preferenceFingerprint(settings);
  const current = job => rankings.some(r => r.status === 'completed' && r.resumeHash === settings.resumeHash && r.preferencesHash === preferencesHash && r.jobUpdatedAt?.[job.id] === job.updatedAt);
  const candidates = allJobs.filter(job => eligible(job) && (job.description || '').length >= 40 && !current(job));
  const batches = [], rankedJobs = [], reports = [];
  let batch = [], characters = settings.resume.length;
  for (const job of candidates) {
    if (settings.resume.length + job.description.length > 120000) { warnings.push(`A saved description is too long for comparison; review it in Applications.`); continue; }
    if (batch.length >= 10 || characters + job.description.length > 120000) { batches.push(batch); batch = []; characters = settings.resume.length; }
    batch.push(job); characters += job.description.length;
  }
  if (batch.length) batches.push(batch);
  for (const [index, jobs] of batches.entries()) {
    const eligibleJobs = jobs.filter(eligible); if (!eligibleJobs.length) continue;
    progress(`Comparing opportunities with your CV (batch ${index + 1} of ${batches.length})`);
    try { reports.push(await rank({ resume: settings.resume, jobs: eligibleJobs, preferences, researchContacts: false })); rankedJobs.push(...eligibleJobs); }
    catch (error) { warnings.push(`CV comparison: ${error.message}`); }
  }
  const report = reports.length ? { summary: reports.map(r => r.summary).join('\n'), rankings: reports.flatMap(r => r.rankings).sort((a, b) => b.score - a.score) } : null;
  return {
    summary: found.summary, newJobIds, savedJobIds: saved.map(j => j.id), closedJobs, companiesResearched: researched.length, warnings,
    technologies: saved.map(j => ({ jobId: j.id, company: j.company, technologies: extractTechnologies(j.description) })),
    report, rankedJobs, preferences, preferencesHash,
    pendingDescriptions: allJobs.filter(j => eligible(j) && (j.description || '').length < 40).length,
    pendingRankings: allJobs.filter(j => eligible(j) && (j.description || '').length >= 40 && !rankedJobs.some(c => c.id === j.id) && !current(j)).length
  };
}
