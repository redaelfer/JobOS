import { fetchPublicText } from '../lib/public-contacts.js';
import { parseHTML } from 'linkedom';
const base = 'http://127.0.0.1:4317/api/';
const state = await (await fetch(base + 'state')).json();
for (const job of state.jobs.filter(j => j.source === 'LinkedIn extension' && /^(?:\d+\s+notifications|are these results helpful\??)$/i.test(j.title))) {
  try {
    const page = await fetchPublicText(job.url), { document } = parseHTML(page.text);
    const title = (document.querySelector('.top-card-layout__title, h1')?.textContent || '').trim();
    const company = (document.querySelector('.topcard__org-name-link')?.textContent || '').trim();
    if (title && title.length < 200 && company.toLowerCase() === job.company.toLowerCase()) {
      const res = await fetch(base + 'jobs/' + job.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      console.log(JSON.stringify({ corrected: res.ok, title, company }));
    } else console.log(JSON.stringify({ needsReview: true, id: job.id, company: job.company }));
  } catch { console.log(JSON.stringify({ needsReview: true, id: job.id, company: job.company })); }
}
