import { createHash } from 'node:crypto';
import { extractEmails, contactPurpose } from './public-contacts.js';

const key = value => createHash('sha256').update(value.toLowerCase().trim()).digest('hex').slice(0, 24);
const unique = (rows, id) => [...new Map(rows.map(row => [id(row), row])).values()];
export function preservePostingContacts(store, job) {
  const contacts = extractEmails(job.description || '').map(email => ({ email, sourceUrl: job.url }));
  for (const run of store.list('rankings')) {
    const row = run.rankings?.find(r => r.jobId === job.id);
    for (const c of row?.contacts || []) if (c.email && c.sourceUrl) contacts.push(c);
  }
  for (const c of contacts) {
    if (contactPurpose(c.email) === 'unrelated') continue;
    const id = key('posting:' + job.id + ':' + c.email);
    if (!store.get('contacts', id)) store.put('contacts', { id, name: c.email, email: c.email, company: job.company, scope: 'posting', postingId: job.id, sourceUrl: c.sourceUrl || '', role: 'Contact for ' + job.title, linkedin: '', notes: 'Published for this posting; not a company-wide HR address.' });
  }
}

// One durable, deduplicated employer queue. Foreground AI work takes priority
// between employers. Lookup failures never change a completed discovery report.
export function employerInbox(store, backend, busy) {
  let current = null, timer = null, stopped = false;
  const schedule = () => { if (!timer && !stopped) { timer = setTimeout(() => { timer = null; pump(); }, 20); timer.unref?.(); } };
  function enqueue(job, scanId) {
    const id = key(job.company);
    const cached = store.get('companies', id) || store.list('companies').find(c => c.name.toLowerCase() === job.company.toLowerCase());
    if (cached && cached.lookupStatus !== 'unavailable' && (cached.researchedAt || cached.contacts?.length || cached.recruitmentTeam?.length)) return;
    const old = store.get('employerQueue', id);
    if (old?.status === 'pending' || old?.scanId === scanId) return;
    store.put('employerQueue', { id, name: job.company, scanId, status: 'pending', context: { company: job.company, title: job.title, location: job.location, url: job.url } });
    schedule();
  }
  async function lookup(task) {
    const old = store.list('companies').find(c => c.name.toLowerCase() === task.name.toLowerCase()) || { id: task.id, name: task.name };
    let info = {}, status;
    try {
      const ai = backend();
      const ready = await ai.status('research');
      if (!ready.ready) throw new Error('Employer research unavailable');
      const found = await ai.research([task.name], [task.context]);
      info = found.find(c => c.name.toLowerCase() === task.name.toLowerCase()) || {};
      status = 'checked';
    } catch { status = 'unavailable'; }
    if (stopped) return;
    const contacts = unique([...(old.contacts || []), ...(info.contacts || [])], c => c.email.toLowerCase());
    const recruitmentTeam = unique([...(old.recruitmentTeam || []), ...(info.recruitmentTeam || [])], m => m.name.toLowerCase() + ':' + m.role.toLowerCase());
    const company = { ...old, ...Object.fromEntries(Object.entries(info).filter(([,v]) => v)), id: old.id, name: task.name, contacts, recruitmentTeam, researchVersion: 2, researchedAt: new Date().toISOString(), lookupStatus: status };
    store.put('companies', company);
    const people = store.list('contacts').filter(c => c.scope !== 'posting' && c.company.toLowerCase() === task.name.toLowerCase());
    for (const m of recruitmentTeam) if (!people.some(c => c.name.toLowerCase() === m.name.toLowerCase())) store.put('contacts', { id: key(task.id + ':' + m.name), name: m.name, role: m.role, company: task.name, email: '', linkedin: m.profileUrl || '', sourceUrl: m.sourceUrl, notes: m.status || '' });
    for (const c of contacts) if (!people.some(p => p.email?.toLowerCase() === c.email.toLowerCase())) store.put('contacts', { id: key(task.id + ':' + c.email), name: c.email, role: 'Published business contact; role unverified', company: task.name, email: c.email, linkedin: '', sourceUrl: c.sourceUrl, notes: c.status || '' });
    store.put('employerQueue', { ...task, status });
    const run = store.get('scans', task.scanId);
    if (run && status === 'checked') store.put('scans', { ...run, companiesResearched: (run.companiesResearched || 0) + 1 });
  }
  function pump() {
    if (stopped || current) return;
    const task = store.list('employerQueue').reverse().find(row => row.status === 'pending');
    if (!task) return;
    if (busy()) return;
    current = lookup(task).finally(() => { current = null; schedule(); });
    current.catch(() => {});
  }
  return { enqueue, schedule, wait: () => current, stop() { stopped = true; clearTimeout(timer); } };
}
