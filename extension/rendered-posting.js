// Serialized into the owned posting tab by chrome.scripting.executeScript.
export function readRenderedPosting(job) {
  const fold = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  function identity(value) {
    const url = new URL(value);
    if (/(^|\.)linkedin\.com$/.test(url.hostname)) {
      const id = url.searchParams.get('currentJobId') || url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1];
      return id && /^\d+$/.test(id) ? 'linkedin:' + id : '';
    }
    if (/(^|\.)indeed\.com$/.test(url.hostname)) {
      const id = url.searchParams.get('jk') || url.searchParams.get('vjk');
      return id ? 'indeed:' + id : '';
    }
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|trackingId|refId|trk)/i.test(key)) url.searchParams.delete(key);
    return url.origin + url.pathname.replace(/\/$/, '') + url.search;
  }
  const expected = identity(job.url);
  const blocked = { identified: false, lines: [] };
  if (!expected || identity(location.href) !== expected) return blocked;
  if (/access denied|just a moment|security check|verify you are human|sign in to linkedin|connexion à linkedin/i.test(document.title)) return blocked;
  const main = document.querySelector('main,[role="main"]') || document.body;
  if (!main || [...main.querySelectorAll('iframe[src*="captcha"], input[type="password"]')].some(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible')) return blocked;
  const excluded = 'aside,nav,footer,[hidden],[aria-hidden="true"],[inert],li[data-job-id],li[data-occludable-job-id],[class*="similar-job"],[class*="related-job"],[class*="recommendation"],[class*="jobs-search-results-list"],[data-testid*="recommend"],[data-testid*="related"],[itemprop="description"],#jobDescriptionText,.jobs-description__content,.description__text,[data-view-name="job-description"]';
  const visible = el => !el.closest(excluded) && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';
  const title = fold(job.title);
  const headings = [...main.querySelectorAll('h1,h2,[role="heading"],[data-testid="job-title"]')].filter(visible);
  const heading = headings.find(el => fold(el.innerText).includes(title))
    || [...main.querySelectorAll('a,p,span,strong,[data-testid="job-title"]')].find(el => visible(el) && fold(el.innerText) === title);
  // Use the selected posting's card, including its status footer. The same
  // screen can contain a results column and notices belonging to other jobs.
  const detail = heading?.closest('article,.jobs-details,.jobs-search__job-details--container,[data-testid="job-details"],[data-view-name="job-details"]');
  const root = detail || main;
  const nextSection = heading && headings.find(el => (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    && /^(?:similar jobs|related jobs|more jobs|people you can reach out to|about the job|à propos de l.offre|offres similaires|emplois similaires)/i.test(el.innerText.trim()));
  const lines = [];
  for (const el of root.querySelectorAll('h1,h2,h3,span,p,div,strong,figcaption,button,[role="alert"],[role="status"]')) {
    if (el.childElementCount > 3 || !visible(el)) continue;
    if (heading && (el.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (nextSection && (nextSection.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (text.length > 0 && text.length <= 180 && !lines.includes(text)) lines.push(text);
  }
  // A removed posting may leave only a closure heading on its original URL.
  if (!heading) return { identified: false, lines: headings.filter(el => el.matches('h1')).map(el => el.innerText.trim()) };
  return { identified: true, lines };
}
