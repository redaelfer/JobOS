import { parseHTML } from 'linkedom';
import { clean } from './domain.js';
import { isIndeedHost, indeedJobKey, indeedBlocked } from './job-sites.js';

function findPosting(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 15) return null;
  if (value['@type'] === 'JobPosting' || value['@type']?.includes?.('JobPosting')) return value;
  for (const child of Array.isArray(value) ? value : [value['@graph']]) { const found = findPosting(child, depth + 1); if (found) return found; }
  return null;
}
export function sourceJob(url, html, listingTitle = '') {
  const indeed = isIndeedHost(new URL(url).hostname);
  if (indeed && (!indeedJobKey(url) || indeedBlocked(html))) return null;
  const { document } = parseHTML(/<html\b/i.test(html) ? html : `<html><body>${html}</body></html>`);
  const values = [...document.querySelectorAll('script[type="application/ld+json"]')].map(element => { try { return JSON.parse(element.textContent); } catch { return null; } });
  const posting = findPosting(values), listing = listingTitle.split(' · ');
  const rawTitle = posting?.title || document.querySelector('.top-card-layout__title, .topcard__title, h1')?.textContent?.trim() || (listing.length > 1 ? listing[0] : '');
  const title = indeed ? rawTitle.replace(/\s*[-–]\s*job post\s*$/i, '').trim() : rawTitle;
  const company = posting?.hiringOrganization?.name || document.querySelector('.topcard__org-name-link, .topcard__flavor a, [data-testid="job-company"], [data-testid="inlineHeader-companyName"], [data-testid="jobsearch-JobInfoHeader-companyName"]')?.textContent?.trim() || (listing.length > 1 ? listing.slice(1).join(' · ') : '');
  if (!title || !company) return null;
  document.querySelectorAll('script,style').forEach(element => element.remove());
  const plain = (document.body?.textContent || document.documentElement?.textContent || '').replace(/\s+/g, ' ').trim(), start = Math.max(0, plain.indexOf(title));
  return { title: clean(title, 200), company: clean(company, 200), url, location: '', description: '', evidence: clean(plain.slice(start, start + 600), 2000), postedAt: '', source: indeed ? 'Codex Indeed search' : /(^|\.)linkedin\.com$/i.test(new URL(url).hostname) ? 'Codex LinkedIn search' : 'Codex employer search', verification: 'Public search result — review the posting' };
}
