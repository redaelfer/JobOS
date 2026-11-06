function warningKey(message) {
  return message.trim().replace(/^(?:(?:Employer research|LinkedIn and company careers|Indeed):\s*)+/i, '');
}
export function uniqueSearchWarnings(warnings = []) {
  const seen = new Set();
  return warnings.filter(message => {
    if (typeof message !== 'string' || !message.trim()) return false;
    const key = warningKey(message);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function searchFailureText(error = '') {
  return uniqueSearchWarnings(String(error).split(/\r?\n/)).join('\n');
}
export function searchRunSource(run = {}) {
  if (run.searchProvider) return run.searchProvider;
  if (/Ollama web search/i.test(run.error || '')) return 'ollama';
  if (/Local SearXNG/i.test(run.error || '')) return 'searxng';
  if (/Gemini web search/i.test(run.error || '')) return 'gemini';
  return '';
}
export function searchSourceLabel(source) {
  return ({ searxng: 'Local SearXNG', linkedin: 'Public LinkedIn + web', public: 'Public web', ollama: 'Hosted Ollama web search', gemini: 'Gemini + Google Search', tavily: 'Tavily Search', brave: 'Brave Search', codex: 'Codex built-in search', none: 'No live search' })[source] || 'Not recorded';
}
// Older reports repeated failures in both the summary and warning list.
// Clean their presentation without modifying the saved report.
export function searchSummary(summary = '', warnings = []) {
  const failures = new Set(warnings.filter(message => typeof message === 'string').map(warningKey));
  return String(summary).split(/\r?\n/).filter(line => !failures.has(warningKey(line))).join('\n');
}
