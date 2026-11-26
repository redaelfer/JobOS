// Public role vocabulary. Queries use only the selected domains, never CV text.
export const foldRole = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‐‑–]/g, '-').toLowerCase();
const ai = /\b(?:artificial intelligence|intelligence artificielle|genai|generative ai|ia generative|llms?|nlp|natural language processing|traitement (?:automatique )?du langage|rag|computer vision|vision par ordinateur)\b|(?<!['’])\b(?:ai|ia)\b/;
const ml = /\b(?:ml|machine[ -]learning|deep[ -]learning|apprentissage automatique|apprentissage profond|mlops|computer vision|vision par ordinateur|nlp|tensorflow|pytorch|scikit[ -]learn)\b/;
const dataScience = /\b(?:data scien(?:ce|tists?)|scientifiques? (?:de |des )?donnees|sciences? des donnees|statistici(?:en|enne)s?|modeles? predictifs?|statistical model(?:s|ling|ing)?|modelisation (?:statistique|predictive)|predictive (?:analytics|model(?:s|ling|ing)?))\b/;
const fullStack = /\bfull[\s-]?stack\b/;
const dataEngineering = /\b(?:data engineer(?:s|ing)?|analytics engineer(?:s|ing)?|ingenieur(?:e)? (?:data|(?:de |des |de la )?donnees)|(?:data|etl|elt) pipelines?|pipelines? de donnees|etl|elt)\b/;
const front = /\b(?:front[ -]?end|react(?:js)?|angular|vue(?:\.js)?|next\.js)\b/;
const back = /\b(?:back[ -]?end|spring(?: boot)?|django|fastapi|flask|express(?:\.js)?|node\.js|laravel|asp\.net)\b/;

const families = [
  { domain: /\b(?:ai|ia|artificial intelligence|intelligence artificielle)\b/, engineeringContext: true, matches: text => ai.test(text) || ml.test(text),
    titles: ['AI Engineer', 'Ingénieur IA', 'NLP Engineer', 'LLM Engineer', 'Ingénieur intelligence artificielle'] },
  { domain: /\b(?:ml|machine[ -]learning|apprentissage automatique)\b/, engineeringContext: true, matches: text => ml.test(text),
    titles: ['Machine Learning Engineer', 'Ingénieur machine learning', 'Computer Vision Engineer', 'MLOps Engineer', 'Ingénieur vision par ordinateur'] },
  { domain: /\b(?:data scien(?:ce|tist)|sciences? des donnees)\b/, matches: text => dataScience.test(text) || (/\bapplied scientist\b/.test(text) && ml.test(text)),
    titles: ['Data Scientist', 'Science des données', 'Applied Scientist', 'Statisticien', 'Data Science'] },
  { domain: fullStack, matches: text => fullStack.test(text) || (front.test(text) && back.test(text)),
    titles: ['Full Stack Developer', 'Développeur full stack', 'Fullstack Engineer', 'Développeur Java React'] },
  { domain: /\b(?:data engineer(?:s|ing)?|ingenierie des donnees|ingenieur(?:e)? (?:data|(?:de |des )?donnees))\b/, matches: text => dataEngineering.test(text),
    titles: ['Data Engineer', 'Ingénieur données', 'Analytics Engineer', 'Développeur ETL', 'Ingénieur data', 'Data engineering'] }
];

export const selectedRoleFamilies = domain => families.filter(family => family.domain.test(foldRole(domain)));
export const roleTitles = domain => [...new Set(selectedRoleFamilies(domain).flatMap(family => family.titles))];

const nonTechnicalTitle = /\b(?:communication|communications|marketing|commercial(?:e)?|sales|account executive|account manager|business development|community manager|content (?:creator|writer|editor)|copywriter|redacteur|redactrice|recruiter|recruteur|recruteuse|ressources humaines|human resources|talent acquisition)\b/;
const technicalTitle = /\b(?:software|data|analytics|ai|ml|nlp|llm|mlops|full[ -]?stack|front[ -]?end|back[ -]?end)\s+(?:engineer|developer|scientist|analyst)\b|\b(?:ingenieur[e]?|developpeur|developpeuse)\s+(?:en\s+)?(?:ia|ai|data|logiciel|full[ -]?stack|machine learning|intelligence artificielle)\b|\bdata scientist\b/;
const engineeringWork = /\b(?:build(?:ing)?|develop(?:ing|ment)?|design(?:ing)?|implement(?:ing|ation)?|train(?:ing)?|fine[ -]?tun(?:e|ing)|deploy(?:ing|ment)?|evaluat(?:e|ing|ion)|optimi[sz](?:e|ing|ation)|concevoir|conception|construire|developper|developpement|entrainer|entrainement|deployer|deploiement|implementer|implementation|evaluer|evaluation|optimiser|optimisation)\b/;
// Restrict evidence to the vacancy when a posting separates employer marketing
// from the actual role. Leave short, unstructured descriptions intact.
export function advertisedWork(description) {
  let text = foldRole(description);
  const start = /(?:^|\n)\s*(?:description du poste|job description|about the role|the role|your role|vos missions|missions principales|responsibilities|what you(?: will|'ll|’ll) do)\s*[:\n]/.exec(text);
  if (start) text = text.slice(start.index + start[0].length);
  const end = /(?:^|\n)\s*(?:about (?:us|the company)|a propos de (?:nous|l['’]entreprise)|description de l['’]entreprise|our company|informations supplementaires|benefits|avantages)\s*[:\n]/.exec(text);
  return end ? text.slice(0, end.index) : text;
}
const nonEngineeringRole = /\b(?:chef(?:fe)?(?:\(fe\))? de projet|project manager|product manager|product owner|formateur|formatrice|trainer|teacher|enseignant|professeur|ecologist|insurance (?:product )?consultant|assistant administratif)\b/;
const technicalTasks = /\b(?:data pipelines?|pipelines? de donnees|etl|elt|data warehouse|data lake|databricks|airflow|spark|pyspark|machine learning|deep learning|modeles? (?:predictifs?|statistiques?)|predictive models?|data science|statistical model(?:s|ling|ing)?|nlp|llms?|rag|ai agents?|agents? ia|intelligence artificielle|artificial intelligence|computer vision|vision par ordinateur|full[ -]?stack|react|angular|vue(?:\.js)?|node\.js|spring|django|fastapi|flask|next\.js|back[ -]?end|front[ -]?end)\b/;
export function matchesRoleFamily(job, family, { requireRoleEvidence = false } = {}) {
  const title = foldRole(job.title), description = foldRole(job.description);
  if (!family.matches(title + ' ' + description)) return false;
  // An employer's technology or use of AI tools is not the employee's field.
  // Technical titles retain marketing/communications product-team qualifiers.
  if (nonTechnicalTitle.test(title) && !technicalTitle.test(title)) return false;
  if (requireRoleEvidence) {
    const work = advertisedWork(job.description);
    // A misleading domain in a title or company blurb is not sufficient.
    if (nonEngineeringRole.test(title)) return false;
    if (!family.matches(work) && !family.matches(title)) return false;
    if (!technicalTasks.test(work)) return false;
    return work.split(/[\n.!?;]/).some(part => technicalTasks.test(part) && /\b(?:build\w*|develop\w*|design\w*|implement\w*|train\w*|deploy\w*|maintain\w*|evaluat\w*|optimi[sz]\w*|concevoir|conception|constru\w*|developp\w*|entrain\w*|deploi\w*|deploy\w*|maintenir|maintenance|eval\w*|optimis\w*)\b/.test(part));
  }
  if (!family.engineeringContext || family.matches(title)) return true;
  // Neutral titles can qualify through actual engineering responsibilities.
  // Keep the action and domain in the same sentence/line to avoid joining a
  // company AI blurb with unrelated content-development responsibilities.
  return description.split(/[\n.!?;]/).some(part => family.matches(part) && engineeringWork.test(part));
}
