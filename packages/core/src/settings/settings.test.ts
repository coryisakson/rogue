import { describe, expect, it } from 'vitest';
import {
  SETTING_DEFS, agentModelKey, agentSettingsFile, decryptSecret, effectiveEnv, encryptSecret, isSecretSetting, maskSecret, resolveSetting,
  settingAuditDetail, validateSetting,
} from './index.js';
import { loadServices } from '../config.js';
import { ocrProviderFromEnv, NoopOcrProvider, HttpOcrProvider } from '../ocr/provider.js';
import { newBackupKey } from '../backup/crypto.js';
import { parseModelList, parseRerankResponse } from '../ai/openai-compatible.js';

const ENV = {
  ROGUE_AI_BASE_URL: 'http://router/v1', ROGUE_AI_API_KEY: 'router-key', ROGUE_AI_CHAT_MODEL: 'Olares/gemma4:e4b',
  ROGUE_AI_EMBED_MODEL: 'Olares/embeddinggemma-300m', ROGUE_AI_MULTI_BASE_URL: 'https://api.example/v1', ROGUE_AI_MULTI_API_KEY: 'multi-key',
};

describe('settings resolution', () => {
  it('setting beats env beats default; blank counts as unset', () => {
    expect(resolveSetting('ROGUE_AI_CHAT_MODEL', { ROGUE_AI_CHAT_MODEL: 'x' }, ENV)).toEqual({ value: 'x', source: 'setting' });
    expect(resolveSetting('ROGUE_AI_CHAT_MODEL', { ROGUE_AI_CHAT_MODEL: '  ' }, ENV)).toEqual({ value: 'Olares/gemma4:e4b', source: 'env' });
    expect(resolveSetting('ROGUE_AI_RERANK_MODEL', {}, ENV)).toEqual({ value: null, source: 'default' });
    expect(resolveSetting('ROGUE_AI_RERANK_MODEL', {}, { ROGUE_AI_RERANK_MODEL: '' })).toEqual({ value: null, source: 'default' });
  });

  it('an empty settings table leaves the loaded config identical to env-only', () => {
    expect(loadServices(effectiveEnv(ENV, {}))).toEqual(loadServices(ENV));
    expect(loadServices(effectiveEnv({}, {}))).toEqual(loadServices({}));
    expect(ocrProviderFromEnv(effectiveEnv({}, {}))).toBeInstanceOf(NoopOcrProvider);
  });

  it('stored values override env in the loaders; unknown keys are ignored', () => {
    const env = effectiveEnv(ENV, { ROGUE_AI_CHAT_MODEL: 'claude-x', ROGUE_OCR_BASE_URL: 'http://ocr', DATABASE_URL: 'postgres://evil' });
    expect(env['DATABASE_URL']).toBeUndefined();
    const s = loadServices(env);
    expect(s.aiChatModel).toBe('claude-x');
    expect(s.aiRoles.translate.model).toBe('claude-x');
    expect(ocrProviderFromEnv(env)).toBeInstanceOf(HttpOcrProvider);
  });

  it('defaults are unchanged and new endpoints keep the Router key rule', () => {
    const s = loadServices(ENV);
    expect(s.aiAnswerReasoning).toBe('low');
    expect(s.aiRewriteReasoning).toBe('none');
    expect(s.aiRerank).toBeNull();
    expect(s.aiEmbed).toEqual({ baseUrl: 'http://router/v1', apiKey: 'router-key', model: 'Olares/embeddinggemma-300m', overridden: false });
    const own = loadServices({ ...ENV, ROGUE_AI_RERANK_MODEL: 'jina-reranker', ROGUE_AI_RERANK_BASE_URL: 'https://third.party/v1' });
    expect(own.aiRerank).toEqual({ baseUrl: 'https://third.party/v1', apiKey: null, model: 'jina-reranker', overridden: true });
    expect(loadServices({ ROGUE_AI_REWRITE_REASONING: 'default' }).aiRewriteReasoning).toBe('default');
  });
});

describe('settings validation and display', () => {
  it('validates URLs, model ids and enums', () => {
    expect(validateSetting('ROGUE_AI_BASE_URL', ' http://router/v1/ ')).toEqual({ ok: true, value: 'http://router/v1' });
    expect(validateSetting('ROGUE_AI_BASE_URL', 'ftp://x').ok).toBe(false);
    expect(validateSetting('ROGUE_AI_BASE_URL', 'http://u:p@x').ok).toBe(false);
    expect(validateSetting('ROGUE_AI_BASE_URL', 'not a url').ok).toBe(false);
    expect(validateSetting('ROGUE_AI_CHAT_MODEL', 'Olares/gemma4:e4b')).toEqual({ ok: true, value: 'Olares/gemma4:e4b' });
    expect(validateSetting('ROGUE_AI_CHAT_MODEL', 'bad model').ok).toBe(false);
    expect(validateSetting(agentModelKey('terms-agent'), 'claude-sonnet-5-5').ok).toBe(true);
    expect(validateSetting('ROGUE_AI_ANSWER_REASONING', 'high').ok).toBe(false);
    expect(validateSetting('ROGUE_OCR_PROVIDER', 'mineru').ok).toBe(true);
    expect(validateSetting('ROGUE_DISCORD_WEBHOOK_URL', 'http://x').ok).toBe(false);
    expect(validateSetting('ROGUE_BGG_TOKEN', 'abc\ndef').ok).toBe(false);
    expect(validateSetting('ROGUE_AI_CHAT_MODEL', '').ok).toBe(false);
    expect(validateSetting('DATABASE_URL', 'x').ok).toBe(false);
  });

  it('masks secrets to the last 4 characters', () => {
    expect(maskSecret('sk-abcdefghijkl1234')).toBe('••••1234');
    expect(maskSecret('short')).toBe('••••');
    expect(maskSecret(null)).toBe('');
  });

  it('every key is unique and every *_API_KEY / token is secret', () => {
    const keys = SETTING_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) if (/API_KEY|TOKEN|WEBHOOK/.test(k)) expect(isSecretSetting(k)).toBe(true);
    expect(agentModelKey('faq-curator')).toBe('ROGUE_AGENT_MODEL_FAQ_CURATOR');
  });

  it('encrypts secrets round trip; a wrong key fails', () => {
    const key = newBackupKey();
    const enc = encryptSecret('sk-secret-value', key);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain('sk-secret');
    expect(decryptSecret(enc, key)).toBe('sk-secret-value');
    expect(() => decryptSecret(enc, newBackupKey())).toThrow();
    expect(() => decryptSecret('plain', key)).toThrow();
  });

  it('audit detail never carries secret values', () => {
    expect(settingAuditDetail('ROGUE_AI_CHAT_MODEL', 'a', 'b')).toEqual({ key: 'ROGUE_AI_CHAT_MODEL', old: 'a', new: 'b' });
    const d = settingAuditDetail('ROGUE_AI_API_KEY', 'old-secret', 'new-secret');
    expect(JSON.stringify(d)).not.toMatch(/secret-|old-|new-/);
    expect(d['change']).toBe('replaced');
    expect(settingAuditDetail('ROGUE_AI_API_KEY', null, 'x')['change']).toBe('set');
    expect(settingAuditDetail('ROGUE_AI_API_KEY', 'x', null)['change']).toBe('cleared');
  });

  it('agent settings file has only stored overrides; agents follow a stored chat model', () => {
    expect(agentSettingsFile({})).toEqual({ version: 1, agents: {} });
    expect(agentSettingsFile({ ROGUE_AI_CHAT_MODEL: 'c', ROGUE_AGENT_MODEL_SCOUT: 's', ROGUE_AI_API_KEY: 'k', ROGUE_BGG_TOKEN: 'b' }))
      .toEqual({ version: 1, defaultModel: 'c', apiKey: 'k', agents: { scout: 's' } });
    expect(agentSettingsFile({ ROGUE_AI_CHAT_MODEL: 'c', ROGUE_AGENT_MODEL: 'a' }).defaultModel).toBe('a');
  });
});

describe('router responses', () => {
  it('parses rerank results by score and drops bad indexes', () => {
    expect(parseRerankResponse({ results: [{ index: 1, relevance_score: 0.2 }, { index: 0, relevance_score: 0.9 }, { index: 7, relevance_score: 1 }] }, 2)).toEqual([0, 1]);
    expect(parseRerankResponse({ data: [{ index: 1 }, { index: 0 }] }, 2)).toEqual([1, 0]);
    expect(() => parseRerankResponse({}, 2)).toThrow();
  });

  it('parses the model list', () => {
    expect(parseModelList({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, {}] })).toEqual(['a', 'b']);
    expect(parseModelList(null)).toEqual([]);
  });
});
