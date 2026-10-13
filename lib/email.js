import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { jobUrl } from './domain.js';
const strip = text => text.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
export async function extractEmailJobs(raw) {
  const source = String(raw);
  const mail = await simpleParser(/^(From|To|Subject|Content-Type|MIME-Version|Received|Return-Path|Delivered-To|Date|Message-ID):/im.test(source) ? source : `Content-Type: text/plain; charset=utf-8\r\n\r\n${source}`, { skipImageLinks: true, skipHtmlToText: true });
  const jobs = new Map();
  const add = (link, title) => {
    try {
      const url = new URL(link.replace(/&amp;/g, '&'));
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return;
      const canonical = jobUrl(url.href);
      if (!/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/.test(canonical)) return;
      const label = strip(title || '').slice(0, 200);
      if (!jobs.has(canonical)) jobs.set(canonical, { title: label && !/^(view|see|apply|https?:)/i.test(label) ? label : 'LinkedIn opportunity — review details', company: 'Not provided in alert', description: '', url: canonical, source: 'LinkedIn email', location: '' });
    } catch { /* Ignore non-job links. */ }
  };
  for (const m of String(mail.html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(m[1], m[2]);
  for (const m of String(mail.text || '').matchAll(/https?:\/\/[^\s<>"\]]+/g)) add(m[0].replace(/[).,;]+$/, ''), '');
  return [...jobs.values()];
}
export function mailboxConfigured(env = process.env) { return Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD); }
export async function pollMailbox(ingest, env = process.env, Client = ImapFlow) {
  if (!mailboxConfigured(env)) throw new Error('Mailbox is not configured. Follow the setup instructions in Settings.');
  const client = new Client({ host: env.IMAP_HOST, port: Number(env.IMAP_PORT || 993), secure: true, auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD }, logger: false, connectionTimeout: 15000, socketTimeout: 30000 });
  let imported = 0;
  try {
    await client.connect();
    await client.mailboxOpen(env.IMAP_FOLDER || 'INBOX', { readOnly: true });
    const ids = await client.search({ since: new Date(Date.now() - 7 * 86400000), from: 'linkedin.com' }, { uid: true });
    if (ids.length) {
      for await (const msg of client.fetch(ids.slice(-100), { source: { maxLength: 1000000 }, size: true }, { uid: true })) {
        if (msg.size > 1000000) continue;
        const jobs = await extractEmailJobs(msg.source);
        for (const job of jobs) if (ingest(job).created) imported++;
      }
    }
    return imported;
  } finally { await client.logout().catch(() => client.close()); }
}
