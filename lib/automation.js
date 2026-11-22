import { extractTechnologies, jobUrl } from './domain.js';
import { automationPreferences } from './profile.js';
import { selectSearchMatches } from './search-policy.js';
import { uniqueSearchWarnings, searchSummary } from './search-warnings.js';
import { scanSites } from './job-sites.js';
export { automationPreferences } from './profile.js';

// Only public search preferences reach the discovery provider. Persist batches before
// waiting for another source; never wait for CV ranking or employer enrichment here.
export async function performAutomatedScan({ settings, knownJobs, searchSite = 'all', ignoredUrls = [], isIgnored = () => false, search, saveJob, progress = () => {}, checkpoint = () => {} }) {
  const preferences = automationPreferences(settings);
  const known = new Set(knownJobs.filter(j => j.url).map(j => jobUrl(j.url)));
  const excluded = new Set([...ignoredUrls, ...knownJobs.filter(j => j.expiredAt || j.stage === 'Closed').map(j => j.url)].filter(Boolean).map(jobUrl));
  const saved = new Map(), newIds = new Set(), closed = new Set(), suggestions = new Set(), warnings = [], sourceResults = [], summaries = [];
  const skip = job => job.stage === 'Closed' || job.expiredAt || excluded.has(jobUrl(job.url)) || isIgnored(job);
  const visible = () => [...saved.values()].filter(job => !skip(job));
  const snapshot = () => ({ sourceResults: [...sourceResults], newJobIds: visible().filter(j => newIds.has(j.id)).map(j => j.id), savedJobIds: visible().map(j => j.id) });
  for (const site of scanSites(searchSite)) {
    const label = site === 'indeed' ? 'Indeed' : 'LinkedIn and company careers';
    progress('Searching ' + label + ' using your saved domains and publication window');
    const prefs = { ...preferences, jobSite: site, includeEmployerSites: true, knownUrls: [...known].filter(url => !excluded.has(url)), excludedUrls: [...excluded] };
    const seen = new Set();
    const accept = rows => {
      const before = saved.size;
      const result = selectSearchMatches({ jobs: rows, summary: '' }, prefs);
      for (const url of result.closedJobUrls || []) closed.add(url);
      for (const job of result.jobs) {
        const url = jobUrl(job.url);
        if (seen.has(url) || skip(job)) continue;
        seen.add(url);
        if (/closed/i.test(job.verification || '') || job.availabilityStatus === 'closed') { if (known.has(url)) saveJob(job); continue; }
        if (saved.has(url)) continue;
        const result = saveJob(job);
        if (!result.job || result.skipped) continue;
        saved.set(url, result.job); known.add(url);
        if (result.created) newIds.add(result.job.id);
      }
      if (saved.size !== before) checkpoint(snapshot());
    };
    try {
      const result = await search(prefs, accept);
      accept(result.jobs);
      for (const url of result.closedJobUrls || []) closed.add(url);
      for (const item of result.searchSuggestions || []) suggestions.add(item);
      warnings.push(...(result.warnings || []));
      summaries.push(label + ': ' + result.summary);
      const incomplete = (result.warnings || []).some(w => /unavailable|unreadable|blocked|incomplete|timed? out|rate.limit|HTTP (?:403|429)|budget reached/i.test(w));
      sourceResults.push({ jobSite: site, status: incomplete ? 'partial' : 'completed', jobCount: [...seen].filter(url => saved.has(url) && !skip(saved.get(url))).length });
    } catch (error) {
      const warning = label + ': ' + error.message;
      warnings.push(warning); summaries.push(warning);
      sourceResults.push({ jobSite: site, status: 'failed', error: error.message });
    }
    checkpoint(snapshot());
  }
  if (sourceResults.every(s => s.status === 'failed')) throw Object.assign(new Error(uniqueSearchWarnings(summaries).join('\n')), snapshot());
  return { ...snapshot(), summary: searchSummary(summaries.join('\n'), warnings), warnings: uniqueSearchWarnings(warnings), searchSuggestions: [...suggestions], closedJobs: [...closed].filter(url => !skip({ url })), technologies: visible().map(j => ({ jobId: j.id, company: j.company, technologies: extractTechnologies(j.description) })), preferences };
}
