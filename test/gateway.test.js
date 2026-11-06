import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { gatewayUrl, assertJobOSIdle, standaloneEntry, gatewayWorkspace, projectRoot } from '../lib/gateway.js';
import { aiConfig, updateAIConfig, credentialStore, publicAI, usesLocalLimits } from '../lib/ai-config.js';
import { createModelClient } from '../lib/ai-client.js';
import { aiModelsPage, updateAIForm } from '../public/ai-settings-view.js';

const localModel = 'local-ollama-jobos-coderlatest';
const secrets = { apiKey: 'SYNTHETIC_GATEWAY_SECRET', model: localModel, codexCatalog: 'C:/private/catalog.json' };
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };

test('optional gateway commands find a sibling app without requiring its files during JobOS imports', async () => {
  assert.equal(gatewayWorkspace(''), resolve(projectRoot, '../freellmapi'));
  const dir = await mkdtemp(join(tmpdir(), 'jobos-optional-gateway-'));
  try {
    assert.throws(() => standaloneEntry('start', dir), /separate FreeLLMAPI app was not found/);
    assert.throws(() => standaloneEntry('../secret', dir), /supported/);
  } finally { assert.ok(dir.startsWith(join(tmpdir(), 'jobos-optional-gateway-'))); await rm(dir, { recursive: true, force: true }); }
});

test('standalone launch permits a stopped JobOS server but rejects each active model workflow without exposing state', async () => {
  await assertJobOSIdle(async () => { throw new Error('PRIVATE_NETWORK_DETAIL'); });
  await assertJobOSIdle(async () => Response.json({ scans: [{ status: 'completed' }] }));
  for (const kind of ['scans', 'searches', 'rankings', 'tailorings', 'modelDownloads']) await assert.rejects(assertJobOSIdle(async url => { assert.equal(url, 'http://127.0.0.1:4317/api/state'); return Response.json({ [kind]: [{ status: 'running', private: 'SECRET' }] }); }), error => /active JobOS/.test(error.message) && !/SECRET/.test(error.message));
});

test('gateway profile is opt-in, loopback-only, preserves provider/search choices and bounds the prepared local context', () => {
  const current = aiConfig({ provider: 'ollama', searchProvider: 'searxng' });
  const next = updateAIConfig(current, { provider: 'freellmapi' });
  assert.equal(current.provider, 'ollama'); assert.equal(next.profiles.ollama.model, current.profiles.ollama.model);
  assert.equal(next.searchProvider, 'searxng'); assert.equal(next.profiles.freellmapi.model, localModel); assert.equal(usesLocalLimits(next), true);
  for (const baseUrl of ['https://remote.example/v1', 'http://127.0.0.1:3001/v1?key=x', 'http://user:secret@localhost:3001/v1', 'http://127.0.0.1:4317/v1', 'ftp://127.0.0.1:3001/v1']) assert.throws(() => updateAIConfig(current, { provider: 'freellmapi', baseUrl }));
  for (const model of ['https://bad.example/model', '../secret', 'model;cmd', 'model\ncommand']) assert.throws(() => updateAIConfig(current, { provider: 'freellmapi', model }));
  assert.equal(updateAIConfig(next, { model: 'provider/model@account#123' }).profiles.freellmapi.model, 'provider/model@account#123');
  assert.throws(() => updateAIConfig(next, { contextTokens: 65536 }), /32768/);
  assert.equal(usesLocalLimits(updateAIConfig(next, { model: 'explicit-cloud-model' })), false);
});

test('JobOS gateway uses only the selected model and private key, disables storage and checks complete structured output', async () => {
  const keys = credentialStore(null, {}); keys.save({ freellmapi: secrets.apiKey, gemini: 'OTHER_PRIVATE_KEY' });
  const config = updateAIConfig({}, { provider: 'freellmapi', searchProvider: 'searxng' }); let calls = 0;
  const client = createModelClient(config, keys, async (url, request) => {
    calls++; assert.equal(request.headers.Authorization, 'Bearer ' + secrets.apiKey); assert.equal(request.redirect, 'error');
    if (url.endsWith('/models')) return Response.json({ data: [{ id: localModel, available: true }, { id: 'unavailable', available: false }] });
    assert.equal(url, gatewayUrl + '/v1/chat/completions'); const body = JSON.parse(request.body);
    assert.equal(body.model, localModel); assert.equal(body.store, false); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.models, undefined);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  });
  assert.deepEqual(await client.generate('Synthetic test only', schema), { ok: true }); assert.deepEqual(await client.models(), [localModel]); assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(publicAI(config, keys)), /SYNTHETIC_GATEWAY_SECRET|OTHER_PRIVATE_KEY/);
  await assert.rejects(client.generate('x'.repeat(70000), schema), /too large/); assert.equal(calls, 2);
  const noKey = createModelClient(config, credentialStore(null, {}), () => assert.fail('No request without a key'));
  await assert.rejects(noKey.generate('test', schema), /API key/); await assert.rejects(noKey.models(), /API key/);
  const unfinished = createModelClient(config, keys, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }));
  await assert.rejects(unfinished.generate('test', schema), /did not finish/);
});

test('gateway settings show a private key, independent search and an honest upstream data note', () => {
  const keys = credentialStore(null, {}); keys.save({ freellmapi: secrets.apiKey });
  const ai = publicAI(updateAIConfig({}, { provider: 'freellmapi', searchProvider: 'searxng' }), keys);
  const dom = new JSDOM(aiModelsPage({ ai, modelDownloads: [] }));
  try {
    updateAIForm(dom.window.document, ai);
    const doc = dom.window.document;
    assert.equal(doc.querySelector('[name="key-freellmapi"]').type, 'password'); assert.equal(doc.querySelector('[name="key-freellmapi"]').value, '');
    assert.equal(doc.querySelector('[data-ai-key="freellmapi"]').hidden, false); assert.equal(doc.querySelector('[name="searchProvider"]').disabled, false);
    assert.match(doc.querySelector('#ai-data-note').textContent, /cloud models.*upstream/); assert.ok(doc.querySelector('a[href="/freellmapi-guide.md"]'));
    assert.doesNotMatch(doc.documentElement.outerHTML, /SYNTHETIC_GATEWAY_SECRET/);
  } finally { dom.window.close(); }
});
