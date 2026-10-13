import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { rankWithCodex, rankingPrompt, validateRankings } from '../lib/codex.js';
import { extractEmails, verifyContactCandidates, publicUrl, isPublicAddress } from '../lib/public-contacts.js';
const jobs = [{ id: 'one', title: 'React Engineer', company: 'Acme', description: 'Build React. Contact jobs@example.com for recruitment.', url: 'https://example.com/job' }];
const output = () => ({ summary: 'One relevant opportunity', rankings: [{ jobId: 'one', score: 80, fit: 'Good fit', strengths: ['React'], gaps: ['SQL'], nextStep: 'Apply', contacts: [] }] });
test('ranking schema validation rejects missing, duplicated, unknown, and invalid scores', () => {
  assert.equal(validateRankings(output(), jobs).rankings[0].score, 80);
  for (const change of [r => r.rankings.pop(), r => r.rankings[0].score = 101, r => r.rankings[0].jobId = 'unknown', r => r.rankings[0].gaps = 'invalid']) { const r = output(); change(r); assert.throws(() => validateRankings(r, jobs)); }
});
test('Codex integration passes input on stdin and uses restricted process flags', async () => {
  const fake = async (args, options) => {
    assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only')); assert.ok(args.includes('shell_tool')); assert.ok(args.includes('multi_agent'));
    assert.ok(args.includes('web_search="disabled"')); assert.equal(args.at(-1), '-'); assert.ok(!args.some(a => a.includes('PRIVATE CV'))); assert.ok(options.stdin.includes('PRIVATE CV'));
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(output())); return { code: 0 };
  };
  const r = await rankWithCodex({ resume: 'PRIVATE CV', jobs, researchContacts: false }, fake);
  assert.equal(r.rankings[0].title, 'React Engineer'); assert.equal(r.rankings[0].contacts[0].email, 'jobs@example.com');
});
test('Codex process failures and invalid JSON never become successful reports', async () => {
  await assert.rejects(rankWithCodex({ resume: 'CV', jobs }, async () => ({ code: 1 })), /could not complete/);
  await assert.rejects(rankWithCodex({ resume: 'CV', jobs }, async args => { await writeFile(args[args.indexOf('--output-last-message') + 1], '{bad'); return { code: 0 }; }), /valid JSON/);
});
test('prompt keeps CV out of web queries and forbids treating job content as instructions', () => {
  const prompt = rankingPrompt('CV', jobs, true); assert.match(prompt, /NEVER place CV text/); assert.match(prompt, /untrusted DATA/); assert.match(prompt, /not call|Do not execute shell commands/);
});
test('email extraction deduplicates and ignores image filenames', () => {
  assert.deepEqual(extractEmails('HR@example.com hr@example.com image@2x.png careers&#64;example.org'), ['hr@example.com', 'careers@example.org']);
});
test('public source protection rejects local addresses, IP URLs, credentials and redirects to private URLs', () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '172.16.1.2', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@example.com', 'https://example.com:8080', 'https://service.local']) assert.throws(() => publicUrl(url));
});
test('only emails literally present in independently fetched sources are returned', async () => {
  const candidates = [{ email: 'invented@example.com', sourceUrl: 'https://example.com/careers' }, { email: 'hr@example.com', sourceUrl: 'https://example.com/careers' }, { email: 'private@example.com', sourceUrl: 'http://127.0.0.1' }];
  const verified = await verifyContactCandidates(candidates, { description: '' }, async url => ({ text: '<a href="mailto:hr@example.com">Contact recruitment</a>', url }));
  assert.equal(verified.length, 1); assert.equal(verified[0].email, 'hr@example.com'); assert.equal(verified[0].sourceUrl, 'https://example.com/careers');
});
