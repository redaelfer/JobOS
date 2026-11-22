import { extractTechnologies } from './domain.js';
import { extractEmails, contactPurpose } from './public-contacts.js';
import { resumeFingerprint, preferenceFingerprint, minimumFit } from './profile.js';
import { postingTime } from '../public/job-order.js';
import { outsideEntryLevel } from './search-policy.js';

export function localDay(value) {
  if (!Number.isFinite(Date.parse(value))) return '';
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
export function buildOpportunities({ jobs, rankings = [], companies = [], contacts = [], pendingEmployers = [], settings, now = new Date().toISOString() }) {
  const resumeHash = resumeFingerprint(settings), preferencesHash = preferenceFingerprint(settings), threshold = minimumFit(settings);
  const completed = rankings.filter(r => r.status === 'completed').sort((a, b) => Date.parse(b.completedAt || b.createdAt) - Date.parse(a.completedAt || a.createdAt));
  const checking = new Set(pendingEmployers.map(name => name.toLowerCase()));
  const items = jobs.map(job => {
    const run = completed.find(r => r.rankings?.some(item => item.jobId === job.id));
    const ranking = run?.rankings.find(r => r.jobId === job.id);
    const fresh = !!ranking && run.resumeHash === resumeHash && run.preferencesHash === preferencesHash && run.jobUpdatedAt?.[job.id] === job.updatedAt;
    const company = companies.find(c => c.name.toLowerCase() === job.company.toLowerCase());
    const emails = [], seen = new Set();
    const addEmail = item => { if (item.email && contactPurpose(item.email) !== 'unrelated' && !seen.has(item.email.toLowerCase())) { seen.add(item.email.toLowerCase()); emails.push({ ...item, purpose: item.purpose || contactPurpose(item.email) }); } };
    extractEmails(job.description).forEach(email => addEmail({ email, sourceUrl: job.url, status: 'Published for this posting in the saved job description; role and deliverability unverified' }));
    (company?.contacts || []).filter(c => contactPurpose(c.email) !== 'unrelated').forEach(c => addEmail({ ...c, status: c.purpose ? c.status : `${c.status}; ${contactPurpose(c.email) === 'recruitment' ? 'confirm recipient role' : 'general business contact; HR role not confirmed'}` }));
    (ranking?.contacts || []).forEach(addEmail);
    const personalContacts = contacts.filter(c => (c.scope !== 'posting' || c.postingId === job.id) && c.company.toLowerCase() === job.company.toLowerCase());
    // Only include user-entered CRM emails as such; they have not been source-verified.
    personalContacts.forEach(c => { if (c.email && !(c.role === 'Published business contact; role unverified' && contactPurpose(c.email) === 'unrelated')) addEmail({ email: c.email, sourceUrl: c.sourceUrl || '', status: c.scope === 'posting' ? 'Published for this posting; not a company-wide HR address' : 'Saved in People; role and deliverability unverified' }); });
    const team = [...(company?.recruitmentTeam || [])];
    personalContacts.filter(c => c.linkedin && !team.some(m => m.name.toLowerCase() === c.name.toLowerCase())).forEach(c => team.push({ name: c.name, role: c.role, profileUrl: c.linkedin, sourceUrl: '', status: 'Saved in People; current affiliation unverified' }));
    emails.sort((a, b) => Number(b.purpose === 'recruitment') - Number(a.purpose === 'recruitment'));
    const closed = !!job.expiredAt || job.stage === 'Closed' || /closed/i.test(job.verification || '') || job.availabilityStatus === 'closed';
    const publication = postingTime(job), cutoff = Date.parse(now) - (Number(settings.searchMaxAgeDays) || 30) * 86400000;
    const publicationCategory = publication && publication <= Date.parse(now) ? (publication >= cutoff ? 'recent' : 'older-review') : 'undated-review';
    return { jobId: job.id, title: job.title, company: job.company, location: job.location, stage: job.stage, url: job.url, source: job.source,
      detectedAt: job.detectedAt || job.createdAt, detectedDay: localDay(job.detectedAt || job.createdAt), lastSeenAt: job.lastSeenAt || '', sourceCheckedAt: job.sourceCheckedAt || '', postedAt: job.postedAt || '', publicationCategory, discoveryBucket: job.discoveryBucket || '', availabilityStatus: job.availabilityStatus || 'unconfirmed', availabilityEvidence: job.availabilityEvidence || '', needsAvailabilityReview: !closed && publicationCategory !== 'recent', verification: job.verification || 'Saved opportunity — confirm availability',
      score: ranking?.score ?? null, rankingStatus: !ranking ? (job.description?.length >= 40 ? 'pending' : 'description-needed') : fresh ? 'current' : 'outdated',
      fit: ranking?.fit || '', strengths: ranking?.strengths || [], gaps: ranking?.gaps || [], nextStep: ranking?.nextStep || '', scoredAt: run?.completedAt || '',
      recommended: fresh && ranking.score >= threshold && !closed && job.stage === 'Saved' && !outsideEntryLevel(job, settings.searchLevel), closed,
      technologies: extractTechnologies(job.description), matchedSkills: [], missingSkills: [],
      industry: company?.industry || '', website: company?.website || '', careersUrl: company?.careersUrl || '', researchedAt: company?.researchedAt || '', emails, recruitmentTeam: team,
      contactStatus: emails.some(c => c.purpose === 'recruitment') ? 'email-found' : company?.lookupStatus === 'unavailable' ? 'source-unavailable' : team.length ? 'profile-found' : checking.has(job.company.toLowerCase()) ? 'research-pending' : company ? 'no-public-contact' : 'not-researched' };
  }).sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(b.rankingStatus === 'current') - Number(a.rankingStatus === 'current') || (b.score ?? -1) - (a.score ?? -1) || Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
  const today = localDay(now);
  return { today, timeZone: 'Africa/Casablanca', minimumFit: threshold, maxAgeDays: Number(settings.searchMaxAgeDays) || 30, items, counts: { olderReview: items.filter(i => i.stage === 'Saved' && !i.closed && i.publicationCategory === 'older-review').length, undatedReview: items.filter(i => i.stage === 'Saved' && !i.closed && i.publicationCategory === 'undated-review').length, today: items.filter(i => i.stage !== 'Closed' && i.detectedDay === today).length, recommended: items.filter(i => i.recommended).length, pending: items.filter(i => ['pending', 'description-needed', 'outdated'].includes(i.rankingStatus) && !i.closed).length } };
}
