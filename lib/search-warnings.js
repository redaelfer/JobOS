export function uniqueSearchWarnings(warnings = []) {
  const seen = new Set();
  return warnings.filter(message => {
    if (typeof message !== 'string' || !message.trim()) return false;
    const key = message.trim().replace(/^Employer research:\s*/i, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
