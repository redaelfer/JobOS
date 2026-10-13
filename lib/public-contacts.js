import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:0*0:|db8:|2:|10:|20:)/i.test(address) && !/^2002:/i.test(address);
}
export function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname.replace(/[\[\]]/g, '')) || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) throw new Error('Only public HTTPS company pages are supported.');
  return url;
}
export async function fetchPublicText(value, redirects = 0) {
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Non-public network address blocked.');
  const address = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'JobOS/0.2 public-contact-check', Accept: 'text/html,text/plain' }, lookup: (_host, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family) }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return resolve({ redirect: res.headers.location }); }
      if (res.statusCode !== 200 || !/^text\/(html|plain)/i.test(res.headers['content-type'] || '')) { res.resume(); return reject(new Error('The source page could not be read.')); }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 1000000) req.destroy(new Error('Source page too large.')); else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
    });
    const timer = setTimeout(() => req.destroy(new Error('Source page timed out.')), 10000);
    req.on('error', reject); req.on('close', () => clearTimeout(timer));
  });
  if (result.redirect) { if (redirects >= 3) throw new Error('Too many redirects.'); return fetchPublicText(new URL(result.redirect, url).href, redirects + 1); }
  return { text: result.text, url: url.href };
}
export function extractEmails(text) {
  const decoded = String(text || '').replace(/&#64;|&#x40;|&commat;/gi, '@').replace(/&#46;|&#x2e;/gi, '.');
  return [...new Set((decoded.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi) || []).map(e => e.toLowerCase()))].filter(e => !/\.(png|jpg|jpeg|webp|svg|gif)$/i.test(e));
}
export function contactPurpose(email) {
  const local = String(email || '').toLowerCase().split('@')[0];
  if (/career|recrut|recruit|talent|hiring|emploi|\bjobs?\b|stage|^hr[._-]?|^rh[._-]?/.test(local)) return 'recruitment';
  if (/merch|shop|order|billing|privacy|legal|press|marketing|communication|sales|support|security|no[._-]?reply/.test(local)) return 'unrelated';
  return 'general';
}
export async function verifyContactCandidates(candidates, job, fetchText = fetchPublicText) {
  const verified = [], seen = new Set();
  const inPosting = extractEmails(job.description);
  for (const email of inPosting) { seen.add(email); verified.push({ email, sourceUrl: job.url || '', status: 'Found in saved job description; role and deliverability unverified' }); }
  for (const candidate of candidates.slice(0, 3)) {
    const email = String(candidate.email || '').trim().toLowerCase(); if (seen.has(email) || !extractEmails(email).includes(email)) continue;
    try {
      publicUrl(candidate.sourceUrl);
      const result = await fetchText(candidate.sourceUrl);
      if (extractEmails(result.text).includes(email)) { seen.add(email); verified.push({ email, sourceUrl: result.url, status: 'Found on source page; role and deliverability unverified' }); }
    } catch { /* An unverifiable email is not reported as found. */ }
  }
  return verified;
}
