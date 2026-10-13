export const stages = ['Saved', 'Applied', 'Screening', 'Interview', 'Offer', 'Closed'];
export function clean(value, max = 10000) { return String(value ?? '').trim().slice(0, max); }
export function jobUrl(value) {
  if (!value) return '';
  let url; try { url = new URL(value); } catch { throw new Error('Enter a valid job URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an http or https job URL.');
  if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    const id = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1] || url.searchParams.get('currentJobId');
    if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
  }
  url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(utm_|trackingId|refId|trk)/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
export function validateJob(input) {
  const title = clean(input.title, 200), company = clean(input.company, 200);
  if (!title || !company) throw new Error('Job title and company are required.');
  const stage = input.stage || 'Saved'; if (!stages.includes(stage)) throw new Error('Invalid application stage.');
  return { title, company, stage, location: clean(input.location, 200), salary: clean(input.salary, 200), url: jobUrl(input.url), description: clean(input.description, 50000), notes: clean(input.notes), source: clean(input.source || 'Manual', 100) };
}
export function matchJob(job, prefs) {
  const text = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
  const split = s => clean(s).toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const wanted = split(prefs.keywords), locations = split(prefs.locations), excluded = split(prefs.exclude);
  const reasons = wanted.filter(x => text.includes(x));
  return { matched: (!wanted.length || reasons.length > 0) && (!locations.length || locations.some(x => text.includes(x))) && !excluded.some(x => text.includes(x)), reasons };
}
const skills = ['javascript', 'typescript', 'python', 'java', 'react', 'vue', 'angular', 'node.js', 'sql', 'postgresql', 'mongodb', 'docker', 'kubernetes', 'aws', 'azure', 'git', 'linux', 'figma', 'excel', 'agile', 'scrum', 'communication', 'leadership', 'machine learning', 'data analysis', 'c++', 'c#', 'go', 'rust', 'terraform', 'redis', 'html', 'css', 'rest', 'graphql', 'spark', 'kafka', 'pandas', 'scikit-learn', 'xgboost', 'tensorflow', 'keras', 'opencv', 'pytorch', 'langchain', 'mlflow', 'fastapi', 'spring boot', 'etl', 'elt', 'dbt', 'gcp', 'power bi', 'snowflake', 'databricks'];
export function analyzeResume(resume, description) {
  const has = (s, k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(s);
  const required = skills.filter(k => has(description, k));
  const matched = required.filter(k => has(resume, k)), missing = required.filter(k => !has(resume, k));
  return { matched, missing, score: required.length ? Math.round(matched.length / required.length * 100) : null };
}
export const extractTechnologies = description => analyzeResume('', description || '').missing.filter(skill => !['communication', 'leadership', 'agile', 'scrum'].includes(skill));
