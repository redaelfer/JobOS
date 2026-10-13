import { postingTime } from '../public/job-order.js';
import { jobUrl } from './domain.js';
const day = 86400000;
export function searchAgeDays(value = 30) {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Choose a posting window between 1 and 30 days.');
  return days;
}
const folded = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function matchesDomains(job, domains) {
  const title = folded(job.title), text = title + ' ' + folded(job.description);
  if (/\brecruiter\b|talent acquisition|ressources humaines|human resources|sales representative/.test(title)) return false;
  const fields = [
    [/software|logiciel/, /software|logiciel|developpeur|developer|programmer|full.?stack|back.?end|front.?end/],
    [/full.?stack/, /full.?stack|front.?end.*back.?end|back.?end.*front.?end/],
    [/back.?end/, /back.?end|django|spring.?boot|server.side|rest api/],
    [/front.?end/, /front.?end|react|angular|vue\.js|interface utilisateur/],
    [/\bai\b|\bml\b|artificial intelligence|machine learning/, /\bai\b|\bml\b|machine learning|intelligence artificielle|computer vision|llm|deep learning/],
    [/data|donnees/, /data engineer|ingenieur.{0,20}(data|donnees)|data pipeline|\betl\b|\belt\b|analytics engineering/],
    [/devops|cloud|\bsre\b/, /devops|\bsre\b|site reliability|cloud engineer|platform engineer|infrastructure engineer|kubernetes|terraform|infrastructure.*cloud/],
    [/\bqa\b|test|quality/, /\bqa\b|quality assurance|test autom|software test|testeur|ingenieur.{0,20}test/]
  ];
  return domains.some(domain => {
    const normalized = folded(domain);
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
  const skipped = { old: 0, unknownDate: 0, outsideDomains: 0, closed: 0, unverifiedSource: 0 };
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
  return { ...result, jobs, skipped, closedJobUrls, summary: result.summary + (reviewCount ? ` ${reviewCount} older or undated postings are retained for availability review, not treated as fresh or confirmed open.` : '') + (total ? ` ${total} unsupported, closed, outside-domain or outside-window entries were excluded.` : '') };
}
