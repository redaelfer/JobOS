const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
export function postingTime(job) {
  const raw = String(job.postedAt || '').trim();
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(raw)) return timestamp(raw);
  const text = raw.toLowerCase().replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776));
  const anchor = timestamp(job.sourceCheckedAt || job.lastSeenAt || job.detectedAt || job.createdAt);
  if (!anchor) return 0;
  if (/^(?:today|aujourd'hui|اليوم)$/.test(text)) return anchor;
  if (/^(?:yesterday|hier|أمس)$/.test(text)) return anchor - 86400000;
  const age = text.match(/(?:\b(\d+|an?|une?)\s*(minutes?|mins?|hours?|heures?|days?|jours?|weeks?|semaines?|months?|mois|years?|ans?|années?)\b|(\d+)\s*(دقائق|دقيقة|ساعات|ساعة|أيام|يوم|أسابيع|أسبوع|أشهر|شهر|سنوات|سنة))/);
  if (!age) return timestamp(raw);
  const number = age[1] || age[3], quantity = /^\d+$/.test(number) ? Number(number) : 1, unit = age[2] || age[4];
  const factor = /minute|min|دق/.test(unit) ? 60000 : /hour|heure|ساعة|ساعات/.test(unit) ? 3600000 : /day|jour|يوم|أيام/.test(unit) ? 86400000 : /week|semaine|أسبوع|أسابيع/.test(unit) ? 7 * 86400000 : /month|mois|شهر|أشهر/.test(unit) ? 30 * 86400000 : 365 * 86400000;
  return anchor - quantity * factor;
}
export function orderJobs(jobs, order = 'newest') {
  const detected = job => timestamp(job.detectedAt || job.createdAt);
  return [...jobs].sort((a, b) => {
    if (order === 'fit') return Number(b.rankingStatus === 'current') - Number(a.rankingStatus === 'current') || (b.score ?? -1) - (a.score ?? -1) || detected(b) - detected(a);
    if (order === 'detected') return detected(b) - detected(a);
    const left = postingTime(a), right = postingTime(b);
    return Number(!!right) - Number(!!left) || right - left || detected(b) - detected(a);
  });
}
export function matchesPublication(job, selected = 'all', { now = Date.now(), maxAgeDays = 30 } = {}) {
  if (selected === 'all') return true;
  const published = postingTime(job);
  if (selected === 'unknown') return !published;
  if (!published || published > now) return false;
  if (selected === 'older') return published < now - maxAgeDays * 86400000;
  const days = selected === 'recent' ? maxAgeDays : Number(selected);
  return (selected === 'recent' ? Number.isInteger(days) && days >= 1 && days <= 30 : [1, 7, 14, 30].includes(days)) && published >= now - days * 86400000;
}
