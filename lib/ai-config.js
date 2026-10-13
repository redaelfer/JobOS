import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { publicUrl } from './public-contacts.js';

export const providerPresets = {
  codex: { label: 'Codex CLI', model: '', baseUrl: '', models: [] },
  ollama: { label: 'Ollama · local', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434', models: ['qwen3:4b', 'qwen3:8b'] },
  gemini: { label: 'Google Gemini API', model: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'] },
  kimi: { label: 'Kimi · Moonshot API', model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.ai/v1', models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k3'] },
  compatible: { label: 'OpenAI-compatible API / LM Studio', model: '', baseUrl: 'http://127.0.0.1:1234/v1', models: [] }
};
export const keyVariables = { gemini: 'GEMINI_API_KEY', kimi: 'MOONSHOT_API_KEY', compatible: 'AI_API_KEY', ollamaSearch: 'OLLAMA_API_KEY', brave: 'BRAVE_API_KEY' };
export function validateModel(value, optional = false) {
  const model = String(value || '').trim();
  if ((!model && optional) || (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model) && !/https?:|\.\./i.test(model))) return model;
  throw new Error('Enter a model name, not a URL or command.');
}
export function validateBaseUrl(value, provider) {
  if (['gemini', 'kimi', 'codex'].includes(provider)) return providerPresets[provider].baseUrl;
  let url; try { url = new URL(value); } catch { throw new Error('Enter a valid model server address.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (provider === 'ollama' && (!local || url.pathname !== '/'))) throw new Error('Ollama must use a local address. Server URLs cannot contain credentials, query strings or fragments.');
  if (!local) publicUrl(url.href);
  if (local && (url.port === '4317' || (!url.port && url.protocol === 'http:'))) throw new Error('Use the model server port, not the JobOS address.');
  return url.href.replace(/\/$/, '');
}
export function aiConfig(saved = {}) {
  const provider = saved.provider || 'codex';
  if (!Object.hasOwn(providerPresets, provider)) throw new Error('Choose a supported AI provider.');
  const profiles = Object.fromEntries(Object.entries(providerPresets).map(([id, preset]) => [id, { model: preset.model, baseUrl: preset.baseUrl, ...(saved.profiles?.[id] || {}) }]));
  const contextTokens = Number(saved.contextTokens ?? 32768);
  if (!Number.isInteger(contextTokens) || contextTokens < 8192 || contextTokens > 131072) throw new Error('Local context must be between 8192 and 131072 tokens.');
  const searchProvider = saved.searchProvider || 'none';
  if (!['none', 'linkedin', 'public', 'gemini', 'ollama', 'brave'].includes(searchProvider)) throw new Error('Choose a supported live search source.');
  return { provider, profiles, contextTokens, searchProvider, searchModel: validateModel(saved.searchModel || 'gemini-3.6-flash') };
}
export function updateAIConfig(saved, input) {
  const current = aiConfig(saved), provider = input.provider || current.provider;
  if (!Object.hasOwn(providerPresets, provider)) throw new Error('Choose a supported AI provider.');
  const profile = current.profiles[provider];
  if (provider === 'ollama' && /cloud/i.test(input.model ?? profile.model)) throw new Error('Choose a downloaded local Ollama model. Cloud models send your input to a hosted service.');
  const next = { ...current, provider, profiles: { ...current.profiles, [provider]: { model: validateModel(input.model ?? profile.model, provider === 'codex'), baseUrl: validateBaseUrl(input.baseUrl ?? profile.baseUrl, provider) } }, contextTokens: input.contextTokens ?? current.contextTokens, searchProvider: input.searchProvider ?? current.searchProvider, searchModel: input.searchModel ?? current.searchModel };
  return aiConfig(next);
}
export function credentialStore(path, env = process.env) {
  let saved = {};
  if (path && existsSync(path)) { try { saved = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Could not read the private AI credentials file.'); } }
  const get = name => Object.hasOwn(keyVariables, name) ? saved[name] || env[keyVariables[name]] || '' : '';
  const status = () => Object.fromEntries(Object.keys(keyVariables).map(name => [name, { configured: !!get(name), source: saved[name] ? 'saved' : env[keyVariables[name]] ? 'environment' : 'none' }]));
  const save = (keys = {}, clearKeys = []) => {
    if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Array.isArray(clearKeys)) throw new Error('Invalid API key settings.');
    const next = { ...saved };
    for (const [name, value] of Object.entries(keys)) {
      if (!Object.hasOwn(keyVariables, name) || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new Error('Invalid API key field.');
      if (value.trim()) next[name] = value.trim();
    }
    for (const name of clearKeys) { if (!Object.hasOwn(keyVariables, name)) throw new Error('Invalid API key field.'); delete next[name]; }
    if (path) { mkdirSync(dirname(path), { recursive: true }); const temp = path + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); renameSync(temp, path); }
    saved = next;
  };
  return { get, status, save };
}
export function publicAI(saved, credentials) {
  const config = aiConfig(saved);
  const revision = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return { ...config, revision, presets: providerPresets, label: providerPresets[config.provider].label, keys: credentials.status() };
}
