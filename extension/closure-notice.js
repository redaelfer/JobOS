const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
const fold = value => cleanText(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase();
const closureNotices = [
  /^(?:(?:this (?:job|posting|position|vacancy|employer|company)|we)(?: is| are)? )?(?:no longer|not) accepting (?:new )?applications\b/,
  /^this (?:job|position|posting) (?:is no longer available|has (?:expired|been (?:closed|filled)))\b/,
  /^(?:the )?(?:applications? (?:(?:are|is) )?(?:closed|no longer (?:being )?accepted)|application period has (?:closed|ended))\b/,
  /^(?:(?:cette (?:offre(?: d'emploi)?|annonce)|ce poste|l'employeur) )?n'accepte plus (?:de |les )(?:nouvelles? )?candidatures\b/,
  /^(?:les )?candidatures (?:ne sont plus acceptees|(?:sont )?(?:closes|fermees))\b/,
  /^plus aucune candidature n'est acceptee\b/,
  /^(?:cette (?:offre(?: d'emploi)?|annonce)|ce poste) (?:a expire|est expiree?|n'est plus (?:disponible|d'actualite)|a ete pourvu)\b/
];
// “Not accepting applications from agencies” still permits direct applicants.
// Only keep notices about the whole posting.
export function isClosureNotice(evidence) {
  const text = fold(evidence);
  return closureNotices.some(pattern => {
    const match = text.match(pattern);
    if (!match) return false;
    const rest = text.slice(match[0].length).trim();
    return /^(?:(?:for this (?:role|job|position|vacancy)|on (?:indeed|linkedin)|pour (?:ce poste|cette offre)|sur (?:indeed|linkedin))\s*)?[.!…]?$/.test(rest);
  });
}
