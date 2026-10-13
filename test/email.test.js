import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEmailJobs, mailboxConfigured, pollMailbox } from '../lib/email.js';
test('HTML alerts decode titles, deduplicate links, and reject lookalike hosts', async () => {
  const jobs = await extractEmailJobs('From: jobs-noreply@linkedin.com\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href="https://www.linkedin.com/jobs/view/123?trk=mail">React &amp; TypeScript Engineer</a><a href="https://www.linkedin.com/jobs/view/123">View job</a><a href="https://linkedin.com.evil.test/jobs/view/9">Evil</a><a href="javascript:alert(1)">Unsafe</a>');
  assert.equal(jobs.length, 1); assert.equal(jobs[0].title, 'React & TypeScript Engineer'); assert.equal(jobs[0].url, 'https://www.linkedin.com/jobs/view/123/');
});
test('plain-text alert links and raw pasted links are recognized', async () => {
  const email = await extractEmailJobs('Subject: Job alert\r\n\r\nSee https://www.linkedin.com/jobs/view/321/?trackingId=x');
  assert.equal(email.length, 1);
  const pasted = await extractEmailJobs('https://www.linkedin.com/jobs/view/321/');
  assert.equal(pasted.length, 1);
});
test('quoted-printable MIME content is decoded', async () => {
  const jobs = await extractEmailJobs('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<a href=3D"https://www.linkedin.com/jobs/view/444/">Developer</a>');
  assert.equal(jobs[0].title, 'Developer');
});
test('multiple jobs do not borrow keywords from other roles in the email', async () => {
  const jobs = await extractEmailJobs('Content-Type: text/html\r\n\r\n<a href="https://www.linkedin.com/jobs/view/1/">Python developer</a><a href="https://www.linkedin.com/jobs/view/2/">Designer</a>');
  assert.equal(jobs[1].description.includes('Python'), false);
});
test('empty emails and unavailable IMAP settings fail gracefully', async () => {
  assert.deepEqual(await extractEmailJobs('No opportunities today'), []);
  assert.equal(mailboxConfigured({}), false);
  await assert.rejects(pollMailbox(() => {}, {}), /not configured/);
});
test('mailbox polling uses TLS, read-only access, UID fetches, limits and cleanup', async () => {
  const calls = [];
  class FakeImap {
    constructor(options) { assert.equal(options.secure, true); assert.equal(options.logger, false); }
    async connect() { calls.push('connect'); }
    async mailboxOpen(folder, options) { assert.equal(folder, 'Alerts'); assert.equal(options.readOnly, true); }
    async search(filter, options) { assert.equal(filter.from, 'linkedin.com'); assert.equal(options.uid, true); return Array.from({ length: 120 }, (_, i) => i + 1); }
    async *fetch(ids, fields, options) { assert.equal(ids.length, 100); assert.equal(ids[0], 21); assert.equal(options.uid, true); assert.equal(fields.source.maxLength, 1000000); yield { size: 100, source: 'Subject: Job\r\n\r\nhttps://www.linkedin.com/jobs/view/123/' }; yield { size: 2000000, source: 'too large' }; }
    async logout() { calls.push('logout'); }
  }
  const count = await pollMailbox(job => { assert.equal(job.url, 'https://www.linkedin.com/jobs/view/123/'); return { created: true }; }, { IMAP_HOST: 'imap.example.com', IMAP_USER: 'test', IMAP_PASSWORD: 'test', IMAP_FOLDER: 'Alerts' }, FakeImap);
  assert.equal(count, 1); assert.deepEqual(calls, ['connect', 'logout']);
});
test('mailbox polling closes the client after a failed connection', async () => {
  let closed = false;
  class FailingImap { async connect() { throw new Error('Connection failed'); } async logout() { throw new Error('Not connected'); } close() { closed = true; } }
  await assert.rejects(pollMailbox(() => {}, { IMAP_HOST: 'test', IMAP_USER: 'test', IMAP_PASSWORD: 'test' }, FailingImap), /Connection failed/);
  assert.equal(closed, true);
});
