import { postingTime } from '../public/job-order.js';
import { jobUrl } from './domain.js';
import { foldRole, selectedRoleFamilies } from './role-families.js';
const day = 86400000;
export const wantsEntryLevel = level => /\b(?:junior|graduate|entry[ -]level|debutant)\b/.test(foldRole(level));
const advancedTitle = /\b(?:senior|sr|staff|principal(?:e)?|lead(?![ -]generation)|mid[ -](?:level|senior)|confirme(?:e)?|direct(?:or|eur|rice)|head of)\b/;
const mixedLevels = /\b(?:junior|jr|entry[ -]level|debutant)\.?\s*(?:to|through|and|or|a|et|ou|[-–/])\s*(?:senior|sr|mid|confirme)|\b(?:senior|sr)\.?\s*(?:and|or|et|ou|\/)\s*(?:junior|jr)\b/;
export function outsideEntryLevel(job, level) {
  if (!wantsEntryLevel(level)) return false;
  const title = foldRole(job.title);
  if (mixedLevels.test(title)) return false;
  if (advancedTitle.test(title)) return true;
  // Read an explicit seniority field. References to senior colleagues in the duties are common in junior roles.
  return /\b(?:seniority level|experience level|niveau d['’ ]experience|niveau de seniorite)\s*[:–-]?\s*(?:mid[ -]senior|mid[ -]level|senior|confirmee?|director|executive)\b/.test(foldRole(job.description));
}
export function searchAgeDays(value = 30) {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Choose a posting window between 1 and 30 days.');
  return days;
}
export function matchesDomains(job, domains) {
  const title = foldRole(job.title), text = title + ' ' + foldRole(job.description);
  if (/\brecruiter\b|talent acquisition|ressources humaines|human resources|sales representative/.test(title)) return false;
  const fields = [
    [/software|logiciel/, /software|logiciel|developpeur|developer|programmer|full.?stack|back.?end|front.?end/],
    [/back.?end/, /back.?end|django|spring.?boot|server.side|rest api/],
    [/front.?end/, /front.?end|react|angular|vue\.js|interface utilisateur/],
    [/data|donnees/, /data engineer|ingenieur.{0,20}(data|donnees)|data pipeline|\betl\b|\belt\b|analytics engineering/],
    [/devops|cloud|\bsre\b/, /devops|\bsre\b|site reliability|cloud engineer|platform engineer|infrastructure engineer|kubernetes|terraform|infrastructure.*cloud/],
    [/\bqa\b|test|quality/, /\bqa\b|quality assurance|test autom|software test|testeur|ingenieur.{0,20}test/]
  ];
  return domains.some(domain => {
    const normalized = foldRole(domain);
    const families = selectedRoleFamilies(domain);
    if (families.length) return families.some(family => family.matches(text));
    const rules = fields.filter(([key]) => key.test(normalized));
    if (rules.length) return rules.some(([, pattern]) => pattern.test(text));
    const terms = normalized.split(/[^a-z0-9]+/).filter(word => word.length > 2 && !['engineering', 'engineer', 'development', 'ingenierie'].includes(word));
    return terms.length > 0 && terms.every(term => text.includes(term));
  });
}
export function recentPosting(job, maxAgeDays = 30, now = Date.now()) {
  const posted = postingTime({ ...job, sourceCheckedAt: job.sourceCheckedAt || job.lastSeenAt || job.detectedAt || job.createdAt || new Date(now).toISOString() });
  return !!posted && posted <= now && posted >= now - searchAgeDays(maxAgeDays) * day;
}
export function selectSearchMatches(result, preferences, now = Date.now()) {
  const days = searchAgeDays(preferences.maxAgeDays);
  const skipped = { old: 0, unknownDate: 0, outsideDomains: 0, outsideLevel: 0, closed: 0, unverifiedSource: 0 };
  const closedJobUrls = [...new Set(result.closedJobUrls || [])];
  const jobs = result.jobs.filter(job => {
    if ((preferences.excludedUrls || []).some(url => jobUrl(url) === jobUrl(job.url))) return false;
    if (!matchesDomains(job, preferences.domains)) { skipped.outsideDomains++; return false; }
    if (/closed/i.test(job.verification || '') || job.availabilityStatus === 'closed') {
      if (!closedJobUrls.includes(job.url)) closedJobUrls.push(job.url);
      // Known closed records still need to be updated by the workflow.
      if (preferences.knownUrls?.includes(job.url)) return true;
      skipped.closed++; return false;
    }
    if (outsideEntryLevel(job, preferences.level)) { skipped.outsideLevel++; return false; }
    const posted = postingTime({ ...job, sourceCheckedAt: job.sourceCheckedAt || new Date(now).toISOString() });
    if (posted > now) { skipped.old++; return false; }
    const recent = recentPosting(job, days, now);
    if (recent) { job.discoveryBucket = 'recent'; return preferences.coveragePass !== 'review'; }
    if (preferences.includeReview !== false) {
      const checked = Date.parse(job.sourceCheckedAt);
      const readable = /found on public posting/.test(job.verification || '') && (job.description || '').length >= 40;
      if (!readable || !Number.isFinite(checked) || checked < now - day) { skipped.unverifiedSource++; return false; }
      job.discoveryBucket = posted ? 'older-review' : 'undated-review';
      job.availabilityStatus ||= 'unconfirmed';
      job.availabilityEvidence ||= 'Readable posting and description checked; confirm that the employer still accepts applications.';
      return true;
    }
    if (!posted) skipped.unknownDate++; else skipped.old++;
    return false;
  });
  const total = Object.values(skipped).reduce((sum, value) => sum + value, 0);
  const reviewCount = jobs.filter(j => /-review$/.test(j.discoveryBucket || '')).length;
  return { ...result, jobs, skipped, closedJobUrls, summary: result.summary + (reviewCount ? ` ${reviewCount} older or undated postings are retained for availability review, not treated as fresh or confirmed open.` : '') + (total ? ` ${total} entries were excluded by source, availability, field, level or date.` : '') };
}
