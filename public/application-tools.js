const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const link = (label, url) => /^https?:\/\//i.test(url || '') ? `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '';
export function applicationContacts(item, compact = false) {
  if (!item) return '';
  const emails = compact ? item.emails.slice(0, 1) : item.emails, team = compact ? item.recruitmentTeam.slice(0, 1) : item.recruitmentTeam;
  return `<section class="application-contacts ${compact ? 'compact' : ''}"><h3>Who to contact</h3>${emails.map(c => `<div><a class="contact-email" href="mailto:${esc(encodeURIComponent(c.email))}">${esc(c.email)}</a>${compact ? '' : `<p class="help">${esc(c.status)} ${link('Source', c.sourceUrl)}</p>`}</div>`).join('')}${team.map(m => `<div><strong>${esc(m.name)}</strong><p class="help">${esc(m.role)} ${link('Profile', m.profileUrl || m.sourceUrl)}</p>${compact ? '' : `<p class="help">${esc(m.status)} ${link('Evidence', m.sourceUrl)}</p>`}</div>`).join('')}${!emails.length && !team.length ? '<p class="help">No recruiting contact confirmed yet.</p>' : ''}${compact ? '<p class="help">Open details for contact evidence and current-role checks.</p>' : `<div class="actions">${link('Company careers', item.careersUrl)} ${link('Company website', item.website)}</div>`}</section>`;
}
export function searchNowButton(busy = false) { return `<button type="button" class="btn primary" data-action="scan-now" title="Search LinkedIn, company career pages and Indeed" ${busy ? 'disabled' : ''}>${busy ? 'Search in progress…' : '⌕ Search now'}</button>`; }
export function offerLink(job) {
  try {
    const url = new URL(job.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const label = /(^|\.)linkedin\.com$/i.test(url.hostname) ? 'LinkedIn' : /(^|\.)indeed\.com$/i.test(url.hostname) ? 'Indeed' : 'Open offer';
    return `<a class="text-link offer-link" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label + ' offer for ' + job.title)}">${label} ↗</a>`;
  } catch { return ''; }
}
export function closeOpportunityButton(job, expectedUrl) {
  if (job.stage === 'Closed') return '';
  return `<button type="button" class="text-button close-opportunity" data-action="close-job" data-id="${esc(job.id)}" ${expectedUrl ? `data-expected-url="${esc(expectedUrl)}"` : ''} aria-label="Close opportunity: ${esc(job.title)}" title="Skip this posting in future searches. Other openings at this company can still appear.">Close</button>`;
}
export function availabilityReview(jobs, report) {
  const running = report?.status === 'running';
  const button = `<button type="button" class="btn" data-action="check-availability" ${running ? 'disabled' : ''}>${running ? 'Checking offers…' : report?.status === 'paused' ? 'Continue browser check' : 'Check saved offers in browser'}</button>`;
  const intro = `<div class="availability-heading"><div><h2>Application availability</h2><p class="help">Open each saved posting outside the Closed stage in your browser and check its application notice.</p></div>${button}</div><p class="help" id="browser-review-help" role="status" hidden>Open JobOS in the Chrome profile you use for LinkedIn. In <strong>chrome://extensions</strong>, reload the JobOS extension (version 0.3 or newer), then refresh JobOS. For a first install, enable Developer mode and use <strong>Load unpacked</strong> to select the project’s <strong>extension</strong> folder.</p>`;
  if (!report) return intro;
  const byId = new Map(jobs.map(job => [job.id, job]));
  const currentJob = item => {
    const job = byId.get(item.jobId);
    return job && job.stage !== 'Closed' && job.url === item.url ? job : null;
  };
  const rows = [];
  for (const match of report.matches) {
    const job = currentJob(match);
    if (!job) continue;
    rows.push(`<li><div><strong>${esc(job.title)}</strong> · ${esc(job.company)} · ${esc(job.stage)}<p class="closure-notice">“${esc(match.evidence)}”</p></div><div class="actions">${offerLink(job)}${closeOpportunityButton(job, match.url)}</div></li>`);
  }
  const unverified = (report.unverified || []).map(currentJob).filter(Boolean);
  const when = new Date(report.completedAt || report.startedAt).toLocaleString();
  const progress = `${report.checked} of ${report.total} links checked · ${report.noNotice} without a closure notice · ${report.unknown} could not be verified · ${report.withoutLink} without a link${report.skipped ? ` · ${report.skipped} changed or removed` : ''}`;
  return intro + `<p class="help" role="status">${report.mode === 'browser' ? 'Browser check' : 'Public-page check'} · ${running ? 'In progress' : report.status === 'paused' ? 'Paused' : report.status === 'failed' ? 'Interrupted check' : 'Last checked'} · ${esc(when)}<br>${progress}</p>`
    + (report.error ? `<p>${esc(report.error)}</p>` : '')
    + (rows.length ? `<h3>No longer accepting applications (${rows.length})</h3><ul class="availability-list" id="unavailable-offers">${rows.join('')}</ul>` : `<p>${running ? 'No closure notices to review yet.' : 'No closure notices left to review.'}</p>`)
    + (report.status === 'completed' && rows.length ? `<div class="actions"><button type="button" class="btn" data-action="close-unavailable" data-review="${esc(report.reviewId || report.startedAt)}">Close all unavailable offers (${rows.length})</button></div>` : '')
    + (unverified.length ? `<details><summary>Open unverified offers (${unverified.length})</summary><ul class="availability-list">${unverified.map(job => `<li><span>${esc(job.title)} · ${esc(job.company)}</span>${offerLink(job)}</li>`).join('')}</ul></details>` : '');
}
export function applicationList(jobs, opportunities, stages) {
  return `<div class="panel application-list"><table class="list-table"><thead><tr><th>OPPORTUNITY</th><th>COMPANY</th><th>OFFER</th><th>LOCATION</th><th>CONTACT</th><th>STAGE</th><th>POSTED</th></tr></thead><tbody>${jobs.map(job => `<tr><td><button class="btn" data-action="edit-job" data-id="${esc(job.id)}">${esc(job.title)}</button><button class="text-button" data-action="prepare-job" data-id="${esc(job.id)}">Tailor CV & email</button></td><td>${esc(job.company)}</td><td>${offerLink(job) || '<span class="help">No link saved</span>'}</td><td>${esc(job.location || '—')}</td><td>${applicationContacts(opportunities.find(item => item.jobId === job.id), true)}</td><td><select data-stage-job="${esc(job.id)}" aria-label="Stage for ${esc(job.title)}">${stages.map(stage => `<option ${stage === job.stage ? 'selected' : ''}>${esc(stage)}</option>`).join('')}</select>${closeOpportunityButton(job)}</td><td><span class="help">${esc(job.postedAt || 'Date unknown')}</span></td></tr>`).join('')}</tbody></table></div>`;
}
