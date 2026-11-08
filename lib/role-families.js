// Public role vocabulary. Queries use only the selected domains, never CV text.
export const foldRole = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‐‑–]/g, '-').toLowerCase();
const ai = /\b(?:artificial intelligence|intelligence artificielle|genai|generative ai|ia generative|llms?|nlp|natural language processing|traitement (?:automatique )?du langage|rag|computer vision|vision par ordinateur)\b|(?<!['’])\b(?:ai|ia)\b/;
const ml = /\b(?:ml|machine[ -]learning|deep[ -]learning|apprentissage automatique|apprentissage profond|mlops|computer vision|vision par ordinateur|nlp|tensorflow|pytorch|scikit[ -]learn)\b/;
const dataScience = /\b(?:data scien(?:ce|tists?)|scientifiques? (?:de |des )?donnees|sciences? des donnees|statistici(?:en|enne)s?|modeles? predictifs?|statistical model(?:s|ling|ing)?|modelisation (?:statistique|predictive)|predictive (?:analytics|model(?:s|ling|ing)?))\b/;
const fullStack = /\bfull[\s-]?stack\b/;
const front = /\b(?:front[ -]?end|react(?:js)?|angular|vue(?:\.js)?|next\.js)\b/;
const back = /\b(?:back[ -]?end|spring(?: boot)?|django|fastapi|flask|express(?:\.js)?|node\.js|laravel|asp\.net)\b/;

const families = [
  { domain: /\b(?:ai|ia|artificial intelligence|intelligence artificielle)\b/, matches: text => ai.test(text) || ml.test(text),
    titles: ['AI Engineer', 'Ingénieur IA', 'NLP Engineer', 'LLM Engineer', 'Ingénieur intelligence artificielle'] },
  { domain: /\b(?:ml|machine[ -]learning|apprentissage automatique)\b/, matches: text => ml.test(text),
    titles: ['Machine Learning Engineer', 'Ingénieur machine learning', 'Computer Vision Engineer', 'MLOps Engineer', 'Ingénieur vision par ordinateur'] },
  { domain: /\b(?:data scien(?:ce|tist)|sciences? des donnees)\b/, matches: text => dataScience.test(text) || (/\bapplied scientist\b/.test(text) && ml.test(text)),
    titles: ['Data Scientist', 'Science des données', 'Applied Scientist', 'Statisticien', 'Data Science'] },
  { domain: fullStack, matches: text => fullStack.test(text) || (front.test(text) && back.test(text)),
    titles: ['Full Stack Developer', 'Développeur full stack', 'Fullstack Engineer', 'Développeur Java React'] }
];

export const selectedRoleFamilies = domain => families.filter(family => family.domain.test(foldRole(domain)));
export const roleTitles = domain => [...new Set(selectedRoleFamilies(domain).flatMap(family => family.titles))];
