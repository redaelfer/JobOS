// Self-contained: serialized by chrome.scripting.executeScript.
export function extractLinkedInJob() {
  const value = el => (el?.innerText || el?.textContent || '').replace(/\u00a0/g, ' ').trim();
  const visible = el => el && !el.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const text = (selectors, root = document) => { for (const selector of selectors) { for (const el of root.querySelectorAll(selector)) { if (visible(el) && value(el)) return value(el); } } return ''; };
  function findJob(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) { for (const item of value) { const result = findJob(item); if (result) return result; } return null; }
    if (value['@type'] === 'JobPosting' || (Array.isArray(value['@type']) && value['@type'].includes('JobPosting'))) return value;
    return value['@graph'] ? findJob(value['@graph']) : null;
  }
  let data = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) { try { data = findJob(JSON.parse(script.textContent)); if (data) break; } catch {} }
  const url = new URL(location.href);
  const id = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1] || url.searchParams.get('currentJobId');
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !id || !/^\d+$/.test(id)) throw new Error('Open a specific LinkedIn job first, then capture it again.');
  const container = document.createElement('div'); container.innerHTML = String(data?.description || '');
  const jobLocation = Array.isArray(data?.jobLocation) ? data.jobLocation[0] : data?.jobLocation;
  const address = jobLocation?.address;
  // New LinkedIn layouts use changing CSS classes. Prefer semantic headings and
  // the selected job detail region, keeping recommendation cards out of capture.
  const sectionHeading = /^(jobs? based|jobs? for you|recommended|your profile|people you|about the job|job description|similar jobs|meet the|search|are these|was this|feedback|show all|(?:\d+\s+)?notifications|linkedin$|emploi|à propos|personnes|votre profil|offres d)/i;
  const contentRoot = document.querySelector('main, [role="main"]') || document;
  const candidates = [...contentRoot.querySelectorAll('h1, h2, [role="heading"]')].filter(el => visible(el) && !el.closest('li, [role="listitem"], nav, header') && value(el).length > 2 && value(el).length < 200 && !sectionHeading.test(value(el)) && !/[?？]\s*$/.test(value(el)));
  const proximity = el => {
    let region = el.parentElement;
    for (let depth = 0; region && depth < 5; depth++, region = region.parentElement) {
      if (region === contentRoot) break;
      if (region.querySelector('a[href*="/company/"]') && [...region.querySelectorAll('button,a')].some(e => /^(apply|postuler)\b/i.test(value(e)))) return 10 - depth;
    }
    return 0;
  };
  const heading = candidates.sort((a, b) => proximity(b) - proximity(a))[0];
  let details = document.querySelector('.jobs-search__job-details--container, .jobs-details, [data-view-name="job-detail"], [data-view-name="job-details"], [data-testid="job-details"]');
  if (!details && heading) {
    let region = heading.parentElement;
    for (let depth = 0; region && depth < 6; depth++, region = region.parentElement) {
      if (region.querySelector('a[href*="/company/"]') || [...region.querySelectorAll('button,a')].some(el => /^(apply|postuler)\b/i.test(value(el)))) { details = region; break; }
    }
    details ||= heading.closest('main, [role="main"]') || document;
  }
  details ||= document;
  const selected = document.querySelector(`[data-job-id="${id}"], [data-occludable-job-id="${id}"], li[aria-selected="true"], .jobs-search-results__list-item--active`);
  const title = text(['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', '.jobs-unified-top-card__job-title', '[data-testid="job-title"]'], details) || data?.title || value(heading) || text(['a[href*="/jobs/view/"]', 'h3'], selected || details);
  const company = text(['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link', '[data-testid="company-name"]'], details) || data?.hiringOrganization?.name || text(['a[href*="/company/"]'], details) || text(['.artdeco-entity-lockup__subtitle', '[data-testid="company-name"]'], selected || details);
  let locationText = text(['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet', '[data-testid="job-location"]'], details) || [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(', ');
  if (!locationText && heading) {
    const candidates = [...details.querySelectorAll('p, span, div')].filter(el => visible(el) && !(el.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.contains(heading));
    const metadata = candidates.map(value).find(s => s.length > 5 && s.length < 500 && /[·•]/.test(s) && /ago|applicant|repost|jour|candidat|semaine|heure|month|day/i.test(s));
    if (metadata) locationText = metadata.split(/[·•]/)[0].trim();
  }
  let description = text(['.jobs-description__content', '.jobs-description-content__text', '.show-more-less-html__markup', '[data-testid="job-description"]', '[data-view-name="job-description"]']) || container.textContent?.trim() || '';
  if (!description) {
    const about = [...document.querySelectorAll('h2,h3,[role="heading"]')].find(el => visible(el) && /^(about the job|à propos de l’offre|à propos de l.offre|descriptif du poste|description du poste)\s*$/i.test(value(el)));
    if (about) {
      let region = about.parentElement;
      for (let depth = 0; region && depth < 5; depth++, region = region.parentElement) {
        const content = value(region).replace(value(about), '').trim();
        if (content.length >= 40 && !region.querySelector('main, aside, nav') && !region.contains(heading)) { description = content; break; }
      }
    }
  }
  return {
    title: String(title || '').trim(), company: String(company || '').trim(),
    location: locationText,
    description,
    url: `https://www.linkedin.com/jobs/view/${id}/`, source: 'LinkedIn extension'
  };
}
