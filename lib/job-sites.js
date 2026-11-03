export function jobSite(value = 'linkedin') {
  if (!['linkedin', 'indeed'].includes(value)) throw new Error('Choose LinkedIn or Indeed for this search.');
  return value;
}
export function scanSites(value = 'all') {
  return value === 'all' ? ['linkedin', 'indeed'] : [jobSite(value)];
}
export const isIndeedHost = host => /(^|\.)indeed\.com$/i.test(host);
export function indeedJobKey(value) {
  let url; try { url = new URL(value); } catch { return ''; }
  if (!isIndeedHost(url.hostname)) return '';
  const key = url.searchParams.get('jk') || url.searchParams.get('vjk');
  return /^[a-f0-9]{16}$/i.test(key || '') ? key.toLowerCase() : '';
}
export function indeedBlocked(html) {
  return /cf-chl-|px-captcha|id=["']captcha|verify (?:that )?you are human|additional verification required|pardon our interruption|<title[^>]*>\s*just a moment/i.test(html);
}
