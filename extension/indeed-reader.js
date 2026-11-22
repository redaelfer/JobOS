// Injected in the top frame only; return vacancy fields, never cookies/profile data.
export function readIndeedPage(task = { type: 'detail', url: location.href }) {
  const visible = el => !!el && !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const text = el => visible(el) ? (el.innerText || el.textContent || '').trim() : '';
  const pick = selectors => [...document.querySelectorAll(selectors)].find(visible);
  const key = value => { try { const u = new URL(value, location.href), k = u.searchParams.get('jk') || u.searchParams.get('vjk'); return u.protocol === 'https:' && /^(?:www|[a-z]{2})\.indeed\.com$/.test(u.hostname) && !u.username && !u.password && !u.port && /^[a-f0-9]{16}$/i.test(k || '') ? k.toLowerCase() : ''; } catch { return ''; } };
  if (!/^https:\/\/(?:www|[a-z]{2})\.indeed\.com\//.test(location.href)) return { ready: false, attention: 'wrong_page', url: location.href };
  const blocked = /just a moment|access denied|additional verification|pardon our interruption|sign in/i.test(document.title) || !!pick('#challenge-running, #challenge-stage, #px-captcha, iframe[src*="challenges.cloudflare.com"], form[action*="captcha"]');
  if (blocked) return { blocked: true, attention: /sign in/i.test(document.title) ? 'sign_in' : 'verification', url: location.href };
  if (task.type === 'listing') {
    const cards = [...document.querySelectorAll('.job_seen_beacon, .cardOutline, [data-testid="job-card"]')].filter(visible);
    const links = cards.flatMap(card => [...card.querySelectorAll('a[data-jk], a[href*="jk="], a[href*="vjk="]')].filter(visible).map(a => {
      const k = a.dataset.jk || key(a.href);
      return /^[a-f0-9]{16}$/i.test(k || '') ? `${location.origin}/viewjob?jk=${k}` : '';
    })).filter(Boolean);
    const next = pick('a[data-testid="pagination-page-next"], a[aria-label="Next Page"], a[aria-label="Next"], a[aria-label="Page suivante"], a[rel="next"]');
    const empty = pick('[data-testid="no-results"], .jobsearch-NoResult-messageContainer');
    return { url: location.href, links: [...new Set(links)], nextUrl: next?.href || '', ready: links.length > 0 || !!empty };
  }
  if (!key(task.url) || key(location.href) !== key(task.url)) return { url: location.href, ready: false, attention: 'wrong_page' };
  const title = text(pick('.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"], [data-testid="vj-job-title"]')).replace(/\s*[-–]\s*job post$/i, '');
  const company = text(pick('[data-testid="inlineHeader-companyName"], [data-company-name="true"], .jobsearch-InlineCompanyRating-companyHeader, [data-testid="vj-company-name"], [data-testid="company-info-metadata"] a[href*="/cmp/"]'));
  // Indeed's newer standalone page uses React Native markup. Read only its
  // description region, never surrounding navigation, recommendations or forms.
  const description = text(pick('#jobDescriptionText, [data-testid="jobDescriptionText"], [data-testid="viewjob-job-content"] .simple-job-description-html'));
  const metadata = text(pick('[data-testid="company-info-metadata"]')).split('\n').map(s => s.trim()).filter(Boolean);
  const jobLocation = text(pick('[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"], .jobsearch-JobInfoHeader-subtitle > div:last-child')) || (metadata.length === 2 && metadata[0] === company ? metadata[1] : '');
  let postedAt = text(pick('[data-testid="job-age"], .jobsearch-JobMetadataFooter')).match(/(?:Posted|Publi[ée])?\s*(?:today|just posted|aujourd.hui|\d+\+?\s*(?:days?|jours?)\s*(?:ago)?)/i)?.[0] || '';
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent), items = Array.isArray(data) ? data : data['@graph'] || [data];
      const post = items.find(j => j['@type'] === 'JobPosting' && j.title?.trim() === title && (!j.url || key(j.url) === key(task.url)));
      if (post?.datePosted && typeof post.datePosted === 'string') postedAt = post.datePosted;
    } catch { /* Unsupported structured data is not evidence. */ }
  }
  const notices = [...document.querySelectorAll('[role="alert"], .jobsearch-JobInfoHeader, [data-testid="jobsearch-JobInfoHeader"], [data-testid="desktop-job-header"], .jobsearch-JobComponent-description')].filter(visible).flatMap(el => text(el).split('\n')).map(s => s.trim()).filter(s => s.length > 5 && s.length < 250);
  const missing = [...(!title ? ['title'] : []), ...(!company ? ['company'] : []), ...(description.length < 40 ? ['description'] : [])];
  return { ready: !missing.length, missing, url: location.href, notices, job: { title, company, location: jobLocation, description: description.slice(0, 50000), postedAt, url: `${location.origin}/viewjob?jk=${key(task.url)}` } };
}
