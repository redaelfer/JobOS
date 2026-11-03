import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { starterLatex, tailoringPrompt } from '../lib/tailoring.js';
import { tailoringAnalysisPrompt, validateTailoringAnalysis, tailoringAnalysisSchemaFor } from '../lib/tailoring-analysis.js';
import { parseModelJSON } from '../lib/ai-client.js';
import { analyzeTailoringWithCodex } from '../lib/codex.js';
import { createAIBackend } from '../lib/ai.js';
import { updateAIConfig, credentialStore } from '../lib/ai-config.js';
import { tailoringResult } from '../public/tailoring-view.js';

const input = { source: starterLatex('Synthetic Person\nBuilt Python and SQL pipelines.'), resume: 'Supporting CV mentions Kubernetes.', job: { title: 'Data Engineer', company: 'Example', description: 'Python and SQL are required. Kubernetes is preferred. Morocco applicants are eligible.' }, language: 'French' };
const point = overrides => ({ requirement: 'Python and SQL', priority: 'required', jobEvidence: 'Python and SQL are required.', cvEvidence: 'Built Python and SQL pipelines.', match: 'supported', cvAction: 'Mettre en avant le pipeline Python et SQL existant.', emailAction: 'Relier le projet Python/SQL aux missions de l’offre.', ...overrides });
const result = points => ({ summary: 'Prioriser les preuves du projet data.', points, questions: [] });

test('offer analysis keeps verified job/CV quotes and separates unsupported or supporting-only claims', () => {
  const analysis = validateTailoringAnalysis(result([
    point(),
    point({ requirement: 'Kubernetes', jobEvidence: 'Kubernetes is preferred.', cvEvidence: 'Supporting CV mentions Kubernetes.', priority: 'preferred' }),
    point({ requirement: 'Country eligibility', jobEvidence: 'Morocco applicants are eligible.', cvEvidence: 'Invented work permit qualification', cvAction: 'Claim a confirmed work permit.', emailAction: 'I have a confirmed permit.' }),
    point({ requirement: 'Invented cloud requirement', jobEvidence: 'AWS is mandatory.' })
  ]), input);
  assert.equal(analysis.points.length, 3); assert.equal(analysis.warnings.length, 1);
  assert.equal(analysis.points[0].match, 'supported'); assert.equal(analysis.points[0].cvSource, 'master');
  assert.equal(analysis.points[1].match, 'uncertain'); assert.equal(analysis.points[1].cvSource, 'saved-cv');
  assert.equal(analysis.points[2].match, 'missing'); assert.equal(analysis.points[2].cvEvidence, '');
  assert.ok(!JSON.stringify(analysis).includes('Claim a confirmed')); assert.ok(!JSON.stringify(analysis).includes('I have a confirmed'));
  assert.throws(() => validateTailoringAnalysis(result([point({ jobEvidence: 'Invented quotation' })]), input), error => error.code === 'ANALYSIS_EVIDENCE');
});

test('offer analysis rejects oversized/malformed output and carries its grounded brief into tailoring data', () => {
  assert.throws(() => validateTailoringAnalysis(result(Array(7).fill(point())), input));
  assert.throws(() => validateTailoringAnalysis(result([point({ match: 'guaranteed' })]), input));
  const analysis = validateTailoringAnalysis(result([point()]), input);
  const prompt = tailoringPrompt({ ...input, analysis, compact: true });
  const data = JSON.parse(prompt.split('DATA:\n')[1]);
  assert.deepEqual(data.applicationBrief, analysis); assert.equal(data.masterLatex, input.source);
  assert.match(prompt, /never turn a missing requirement into a claimed qualification/);
  assert.match(tailoringAnalysisPrompt(input), /Do not write a CV or email yet/);
});

test('analysis renders CV and email priorities before artifacts, escapes sources and exposes gaps honestly', () => {
  const analysis = validateTailoringAnalysis(result([point({ requirement: '<img src=x onerror=alert(1)> Python' }), point({ requirement: 'Kubernetes', jobEvidence: 'Kubernetes is preferred.', cvEvidence: '', match: 'missing' })]), input);
  const dom = new JSDOM(tailoringResult({ mode: 'analysis', status: 'completed', language: 'French', analysis, stale: true }));
  const text = dom.window.document.body.textContent;
  assert.match(text, /À mettre en avant dans le CV/); assert.match(text, /Angles pour le mail/); assert.match(text, /Non démontré dans le CV/); assert.match(text, /Le CV ou l’offre a changé/);
  assert.equal(dom.window.document.querySelector('img'), null); assert.equal(dom.window.document.querySelector('#tailored-review-form'), null);
  assert.equal(dom.window.document.querySelector('[data-action="download-tailoring"]'), null); dom.window.close();
});

test('Codex offer analysis disables web/shell tools and keeps candidate input off command arguments', async () => {
  const output = await analyzeTailoringWithCodex(input, async (args, options) => {
    assert.ok(args.includes('web_search="disabled"')); assert.ok(args.includes('shell_tool')); assert.ok(args.includes('multi_agent'));
    assert.ok(!args.some(value => value.includes('Synthetic Person'))); assert.match(options.stdin, /masterCvText/);
    const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8')); assert.equal(schema.properties.points.maxItems, 6);
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(result([point()]))); return { code: 0 };
  });
  assert.equal(validateTailoringAnalysis(output, input).points.length, 1);
});

test('local offer analysis calls only the selected model with bounded structured evidence output', async () => {
  const backend = createAIBackend(updateAIConfig({}, { provider: 'ollama' }), credentialStore(null, {}), { fetcher: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat'); const body = JSON.parse(options.body);
    assert.equal(body.format.properties.points.maxItems, 6); assert.equal(body.think, false);
    assert.ok(body.messages[0].content.includes(input.resume));
    return new Response(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(result([point()])) } }));
  } });
  assert.equal(validateTailoringAnalysis(await backend.analyzeTailoring(input), input).points.length, 1);
});

test('model evidence choices are literal source passages, and paraphrased quotations are rejected', () => {
  const schema = tailoringAnalysisSchemaFor(input), properties = schema.properties.points.items.properties;
  assert.ok(properties.jobEvidence.enum.includes('Python and SQL are required.'));
  assert.ok(properties.cvEvidence.enum.includes('Built Python and SQL pipelines.'));
  assert.deepEqual(parseModelJSON(JSON.stringify(result([point()])), schema), result([point()]));
  assert.throws(() => parseModelJSON(JSON.stringify(result([point({ jobEvidence: 'Excellent Python skills are essential.' })])), schema));
  assert.throws(() => parseModelJSON(JSON.stringify(result([point({ cvEvidence: 'Expert in SQL since 2017.' })])), schema));
});
