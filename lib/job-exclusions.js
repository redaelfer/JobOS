import { foldRole } from './role-families.js';

const terms = value => foldRole(value).split(/[,;\n]/).map(term => term.trim()).filter(Boolean);
const internshipTerm = /^(?:p\.?f\.?e\.?|stage(?:s)?|stagiaire(?:s)?|intern(?:ship)?s?)$/;
export const excludesInternships = exclude => terms(exclude).some(term => internshipTerm.test(term));

export function isInternshipOffer(job) {
  // "Early-stage company" describes the employer, not an internship contract.
  const title = foldRole(job.title).replace(/\b(?:early|late|multi)[ -]stage\b/g, '');
  if (/\b(?:intern(?:ship)?s?|stagiaires?|stages?|p[. ]?f[. ]?e)\b|\bprojet (?:de )?fin (?:d['’ ]?|des? )etudes?\b/.test(title)) return true;
  const description = foldRole(job.description);
  // Classify the actual opening, rather than rejecting a graduate job that
  // accepts experience from previous internships, PFE projects or school work.
  return [
    /\b(?:employment type|job type|contract type|seniority level|experience level|niveau d['’]experience|type (?:de contrat|d['’]emploi)|contrat)\s*[:–-]?\s*(?:paid\s+|unpaid\s+|full[ -]time\s*[,/]?\s*)?(?:internship|intern|stage|pfe)\b/,
    /\b(?:this|the) (?:role|position|opportunity) is (?:an? |a paid |an unpaid )?(?:internship|intern role)\b/,
    /\b(?:seeking|hiring|looking for)\s+(?:an?\s+)?(?:[a-z-]+\s+){0,5}(?:intern|interns|internship candidate)\b/,
    /\b(?:nous\s+)?(?:recherchons|recrutons|recherche|recrute)\s+(?:un[es]?\s+|des\s+)?(?:[a-z-]+\s+){0,5}stagiaires?\b/,
    /\b(?:offre|proposition) de stage\b|(?:^|[\n.!?])\s*(?:stage|projet) (?:pfe|(?:de )?fin (?:d['’ ]?|des? )etudes?|(?:de )?pre[ -]embauche)\b/,
    /\b(?:ce|le) poste (?:est|correspond a) (?:un )?stage\b|\bconvention de stage (?:est )?(?:obligatoire|requise)\b/,
    /\b(?:employment type|job type|contract type)\s*[:–-]\s*intern\b|\binternship (?:duration|opportunity|position)\s*:/
  ].some(pattern => pattern.test(description));
}

export function excludedBySearchPreferences(job, exclude) {
  const selected = terms(exclude);
  if (selected.some(term => internshipTerm.test(term)) && isInternshipOffer(job)) return true;
  const title = foldRole(job.title);
  return selected.filter(term => !internshipTerm.test(term)).some(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^a-z0-9])' + escaped + '(?=$|[^a-z0-9])').test(title);
  });
}
