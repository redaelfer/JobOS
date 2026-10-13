const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const link = (label, url) => /^https?:\/\//i.test(url || '') ? `<a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '';
export function applicationContacts(item, compact = false) {
  if (!item) return '';
  const emails = compact ? item.emails.slice(0, 1) : item.emails, team = compact ? item.recruitmentTeam.slice(0, 1) : item.recruitmentTeam;
  return `<section class="application-contacts ${compact ? 'compact' : ''}"><h3>Who to contact</h3>${emails.map(c => `<div><a class="contact-email" href="mailto:${esc(encodeURIComponent(c.email))}">${esc(c.email)}</a>${compact ? '' : `<p class="help">${esc(c.status)} ${link('Source', c.sourceUrl)}</p>`}</div>`).join('')}${team.map(m => `<div><strong>${esc(m.name)}</strong><p class="help">${esc(m.role)} ${link('Profile', m.profileUrl || m.sourceUrl)}</p>${compact ? '' : `<p class="help">${esc(m.status)} ${link('Evidence', m.sourceUrl)}</p>`}</div>`).join('')}${!emails.length && !team.length ? '<p class="help">No recruiting contact confirmed yet.</p>' : ''}${compact ? '<p class="help">Open details for contact evidence and current-role checks.</p>' : `<div class="actions">${link('Company careers', item.careersUrl)} ${link('Company website', item.website)}</div>`}</section>`;
}
export function searchNowButton(busy = false) { return `<button type="button" class="btn primary" data-action="scan-now" ${busy ? 'disabled' : ''}>${busy ? 'Search in progress…' : '⌕ Search now'}</button>`; }
export function offerLink(job) {
  try {
    const url = new URL(job.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const label = /(^|\.)linkedin\.com$/i.test(url.hostname) ? 'LinkedIn' : 'Open offer';
    return `<a class="text-link offer-link" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label + ' offer for ' + job.title)}">${label} ↗</a>`;
  } catch { return ''; }
}
export function applicationList(jobs, opportunities, stages) {
  return `<div class="panel application-list"><table class="list-table"><thead><tr><th>OPPORTUNITY</th><th>COMPANY</th><th>OFFER</th><th>LOCATION</th><th>CONTACT</th><th>STAGE</th><th>POSTED</th></tr></thead><tbody>${jobs.map(job => `<tr><td><button class="btn" data-action="edit-job" data-id="${esc(job.id)}">${esc(job.title)}</button><button class="text-button" data-action="prepare-job" data-id="${esc(job.id)}">Tailor CV & email</button></td><td>${esc(job.company)}</td><td>${offerLink(job) || '<span class="help">No link saved</span>'}</td><td>${esc(job.location || '—')}</td><td>${applicationContacts(opportunities.find(item => item.jobId === job.id), true)}</td><td><select data-stage-job="${esc(job.id)}" aria-label="Stage for ${esc(job.title)}">${stages.map(stage => `<option ${stage === job.stage ? 'selected' : ''}>${esc(stage)}</option>`).join('')}</select></td><td><span class="help">${esc(job.postedAt || 'Date unknown')}</span></td></tr>`).join('')}</tbody></table></div>`;
}
