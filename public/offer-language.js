export function offerLanguage(job = {}) {
  const text = ((job?.title || '') + ' ' + (job?.description || '')).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const count = words => (text.match(new RegExp('\\b(?:' + words + ')\\b', 'g')) || []).length;
  return count('nous|vous|le|les|une|des|avec|pour|recherche|ingenieur|ingenieure|developpeur|developpeuse|donnees|poste|missions|competences|profil') > count('we|you|the|with|for|engineer|developer|our|skills|requirements|hiring|team') ? 'French' : 'English';
}
