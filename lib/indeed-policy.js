import { foldRole, advertisedWork } from './role-families.js';

export const INDEED_MOROCCO_SCOPE = 'morocco-junior-remote';
export const INDEED_REMOTE_REGION = 'remote (Morocco OR worldwide OR EMEA)';
export const INDEED_MATCH_LIMIT = 100;
export const indeedLimitNotice = 'Indeed stopped at 100 matching offers for this search. Coverage is not exhaustive.';
export function indeedScope(value = 'preferences') {
  if (!['preferences', INDEED_MOROCCO_SCOPE].includes(value)) throw new Error('Choose a valid Indeed opportunity scope.');
  return value;
}
export const scopedIndeed = preferences => preferences.jobSite === 'indeed' && preferences.indeedOpportunityScope === INDEED_MOROCCO_SCOPE;
export const juniorTitle = value => /\b(?:junior|jr|entry[ -]level|new grad(?:uate)?|fresh graduate|graduate|debutant|jeune diplome)\b/.test(foldRole(value));

const morocco = /\b(?:morocco|maroc|rabat|casablanca|sale|kenitra|marrakech|marrakesh|tanger|tangier|tetouan|fes|fez|meknes|agadir|oujda|berrechid|bouskoura|temara|el jadida|safi|nador|benguerir|ben guerir|settat|mohammedia|laayoune|dakhla)\b|المغرب|الرباط|الدار البيضاء|طنجة|مراكش/;
const remote = /\b(?:remote|teletravail|a distance|work from (?:home|anywhere))\b/;
const worldwide = /\b(?:worldwide|work from anywhere|anywhere in the world|remote globally|globally remote)\b/;
const advancedTitle = /\b(?:senior|sr|staff|principal(?:e)?|lead(?![ -]generation)|head|director|directeur|directrice|manager|responsable|architect(?:e)?|expert(?:e)?|experimente(?:e)?|confirme(?:e)?|mid[ -](?:level|senior)|spec adv)\b|\bengineer\s+(?:[3-9]|[1-9]\d|iii|iv|v|vi)\b/;
// Explicit candidate requirements only: a company's age or "work with senior engineers"
// must not turn an otherwise suitable Moroccan role into a senior vacancy.
const requiredExperience = /\b(?:at least|minimum(?: of)?|requires?|must have)\s+(?:[3-9]|[1-9]\d)\+?\s*(?:years?|ans)(?:\s+of)?\s+(?:professional\s+|relevant\s+)?experience\b|\bexperience\s+(?:professionnelle\s+)?(?:de\s+)?(?:[3-9]|[1-9]\d)\s*(?:ans|years)\s+(?:minimum|required|exigee?)\b|\b(?:[3-9]|[1-9]\d)\+?\s+years? (?:of )?(?:professional |relevant )?experience\s+(?:is\s+)?required\b/;
const juniorDescription = /\b(?:open to|suitable for|welcome|seeking|hiring|looking for)\s+(?:a\s+|an\s+)?(?:junior|entry[ -]level|new graduates?|fresh graduates?)\b|\b(?:new|recent|fresh) graduates? (?:are )?(?:welcome|encouraged)\b|\b(?:debutants?|jeunes diplomes?)\s+(?:acceptes?|bienvenus?|recherches?)\b|\b(?:experience level|seniority level)\s*[:–-]\s*(?:entry[ -]level|junior)\b|\b(?:0\s*[-–]\s*[12]|[12])\s+years? (?:of )?(?:relevant |professional )?experience\b/;
const foreignCountry = /\b(?:united states|usa|u\.?s\.?|united kingdom|uk|canada|france|germany|german|spain|italy|netherlands|australia|india|pakistan|philippines|brazil|mexico|poland|portugal|romania|ireland|european union|eu|europe|emea|africa)\b/;
const foreignRequirement = /\b(?:must|need to|required to)\s+(?:be\s+)?(?:based|reside|live|located)\s+in\s+(?:the\s+)?([^.;\n]{1,70})|\b(?:authorized|eligible|authorization|right)\s+to\s+work\s+in\s+(?:the\s+)?([^.;\n]{1,70})|\b(?:only|exclusively)\s+(?:available|open)\s+to\s+([^.;\n]{1,70})/g;

export function indeedScopeDecision(job, { indeedLocalSearch = false } = {}) {
  const title = foldRole(job.title), location = foldRole(job.location), description = foldRole(job.description);
  const work = advertisedWork(description);
  const advancedOpening = /\b(?:chef(?:fe)?(?:\(fe\))? de projet|project manager|intermediate|cto|chief)\b/.test(title)
    || /\b(?:we are |nous )?(?:looking for|seeking|hiring|recherchons|recrutons)\s+(?:a |an |des |un |une )?(?:senior|experienced|confirme|experimente)\b/.test(work);
  const experienceRange = /(?:^|[\n:;.!?])\s*(?:[-•]\s*)?(?:requirements?\s*:?\s*)?(?:minimum\s+|at least\s+)?([3-9]|[1-9]\d)(?:\s*(?:-|a|to)\s*\d+)?\+?\s*(?:years?|ans)(?:['’]s?)?\s+(?:of |d['’])?(?:relevant |professional |work |working |commercial |hands-on |solid )*experience\b|\b(?:vous (?:avez|justifiez)|avec|minimum de|au moins)\s+(?:une experience de\s+)?([3-9]|[1-9]\d)(?:\s*(?:-|a)\s*\d+)?\s*ans\s+d['’]experience\b/;
  if (advancedTitle.test(title) || advancedOpening || requiredExperience.test(description) || experienceRange.test(work)) return { allowed: false, reason: 'level' };
  if (morocco.test(location)) return { allowed: true, evidence: 'Source location is in Morocco; confirm the employer’s other eligibility requirements.' };
  const isRemote = remote.test(location + ' ' + title) || /\b(?:fully remote|100% remote|remote position|remote role|work remotely|poste en teletravail)\b/.test(description);
  if (isRemote) {
    if (!juniorTitle(title) && !juniorDescription.test(description)) return { allowed: false, reason: 'level' };
    // A wide time zone (EMEA) does not establish country eligibility. Keep it for
    // review; explicit foreign-only residency/work authorization is excluded.
    for (const match of description.matchAll(foreignRequirement)) {
      const restriction = match[1] || match[2] || match[3];
      if (foreignCountry.test(restriction) && !morocco.test(restriction) && !/\b(?:emea|africa)\b/.test(restriction)) return { allowed: false, reason: 'location' };
    }
    if (/\b(?:us|usa|united states|uk|united kingdom|canada|europe|eu|india|australia)(?:[ -]only|\s+(?:residents?|citizens?|candidates?)\s+only)\b/.test(location + ' ' + description)) return { allowed: false, reason: 'location' };
    const global = worldwide.test(location) || /\b(?:remote worldwide|worldwide remote|work from anywhere(?: in the world)?|remote globally|globally remote|hire (?:candidates )?worldwide)\b/.test(description);
    const region = /\b(?:emea|africa|worldwide|global)\b/.test(location);
    const neutralLocation = /^(?:fully |100% )?(?:remote|teletravail|a distance)?$/.test(location.trim());
    if (location && !neutralLocation && !region && !global) return { allowed: false, reason: 'location' };
    return { allowed: true, evidence: global ? 'Source advertises worldwide remote work and junior-level evidence. Confirm that hiring from Morocco is supported.' : 'Junior remote role; hiring eligibility from Morocco is unconfirmed. Check with the employer before applying.' };
  }
  if (!location && indeedLocalSearch) return { allowed: true, evidence: 'Found in the Morocco search, but the posting location could not be read. Confirm Morocco eligibility before applying.' };
  return { allowed: false, reason: 'location' };
}
