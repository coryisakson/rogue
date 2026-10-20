import { decryptBytes, encryptBytes } from '../backup/crypto.js';
import { AGENT_NAMES, type AgentName } from '../agents/index.js';

/**
 * Admin-editable settings (/admin/settings, migration 0039). Every setting is named after the env var it overrides, so
 * resolution is one rule everywhere: app_settings value, else env var, else the code default the loaders already have.
 * With an empty table the merged env equals process.env, so behaviour is unchanged.
 */
export type SettingKind = 'url' | 'model' | 'secret' | 'reasoning' | 'ocr-provider';
export type SettingSource = 'setting' | 'env' | 'default';

/** Live check offered per group on the settings page. */
export type SettingTest = 'models' | 'chat' | 'translate' | 'chat_multilingual' | 'embed' | 'rerank' | 'judge' | 'ocr' | 'search' | 'bgg';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  /** Shown when neither a setting nor env sets a value (what the code does then). */
  defaultNote: string;
  help?: string;
}

export interface SettingGroup {
  id: string;
  title: string;
  help: string;
  test?: SettingTest;
  settings: SettingDef[];
}

const url = (key: string, label: string, defaultNote: string, help?: string): SettingDef => ({ key, label, kind: 'url', defaultNote, ...(help ? { help } : {}) });
const model = (key: string, label: string, defaultNote: string, help?: string): SettingDef => ({ key, label, kind: 'model', defaultNote, ...(help ? { help } : {}) });
const secret = (key: string, label: string, defaultNote: string, help?: string): SettingDef => ({ key, label, kind: 'secret', defaultNote, ...(help ? { help } : {}) });
const reasoning = (key: string, label: string, defaultNote: string): SettingDef => ({ key, label, kind: 'reasoning', defaultNote });

/** Agent name -> setting key suffix, e.g. reviewer -> ROGUE_AGENT_MODEL_REVIEWER. */
export const agentModelKey = (name: AgentName): string => `ROGUE_AGENT_MODEL_${name.toUpperCase().replace(/-/g, '_')}`;

/** A role's own endpoint: model + optional base URL/key. Without its own base URL it uses the Router and the Router key. */
const role = (prefix: string, modelDefault: string): SettingDef[] => [
  model(`ROGUE_AI_${prefix}_MODEL`, 'Model id', modelDefault),
  url(`ROGUE_AI_${prefix}_BASE_URL`, 'Own base URL (optional)', 'the Router', 'Set only to use another OpenAI-compatible endpoint; it then gets only its own key, never the Router key.'),
  secret(`ROGUE_AI_${prefix}_API_KEY`, 'Own API key (optional)', 'none (Router key when no own base URL)'),
];

export const SETTING_GROUPS: SettingGroup[] = [
  { id: 'router', title: 'Router (default AI endpoint)', test: 'models', help: 'The OpenAI-compatible endpoint every role uses unless it has its own base URL.', settings: [
    url('ROGUE_AI_BASE_URL', 'Base URL', 'none (AI off)', 'Ends in /v1, e.g. http://3a77b15d.shared.olares.com/v1'),
    secret('ROGUE_AI_API_KEY', 'API key', 'none (Router needs no key inside Olares)'),
  ] },
  { id: 'chat', title: 'Chat / answer', test: 'chat', help: 'Final rules-chat answers, curator, librarian (in-app path) and the default for every other chat role.', settings: [
    ...role('CHAT', 'default-chat'),
    reasoning('ROGUE_AI_ANSWER_REASONING', 'Answer reasoning effort', 'low'),
  ] },
  { id: 'translate', title: 'Rewrite / translate', test: 'translate', help: 'Follow-up rewrite and question translation before retrieval.', settings: [
    ...role('TRANSLATE', 'the chat model'),
    reasoning('ROGUE_AI_REWRITE_REASONING', 'Rewrite reasoning effort', 'none'),
  ] },
  { id: 'multi', title: 'Multilingual override', test: 'chat_multilingual', help: 'Used for non-English asks only when it has its own base URL (e.g. Claude); otherwise the roles above serve them.', settings: role('MULTI', 'the chat model') },
  { id: 'embed', title: 'Embeddings', test: 'embed', help: 'Rulebook chunks and queries (768-dim vectors). Changing the model needs a re-index.', settings: [
    model('ROGUE_AI_EMBED_MODEL', 'Model id', 'default-embedding'),
    url('ROGUE_AI_EMBED_BASE_URL', 'Own base URL (optional)', 'the Router'),
    secret('ROGUE_AI_EMBED_API_KEY', 'Own API key (optional)', 'none (Router key when no own base URL)'),
  ] },
  { id: 'rerank', title: 'Reranker', test: 'rerank', help: 'Empty model = rank with the chat model (current behaviour). Set a rerank model to call POST {base}/rerank; any error falls back to the chat-model ranking.', settings: [
    model('ROGUE_AI_RERANK_MODEL', 'Rerank model id', 'none (chat model ranks)'),
    url('ROGUE_AI_RERANK_BASE_URL', 'Own base URL (optional)', 'the Router'),
    secret('ROGUE_AI_RERANK_API_KEY', 'Own API key (optional)', 'none (Router key when no own base URL)'),
  ] },
  { id: 'judge', title: 'Curator judge', test: 'judge', help: 'Optional independent judge for the Curator. Without a base URL the Curator never rejects claims.', settings: [
    url('ROGUE_JUDGE_BASE_URL', 'Base URL', 'none (judge off)'),
    model('ROGUE_JUDGE_MODEL', 'Model id', 'default-chat'),
    secret('ROGUE_JUDGE_API_KEY', 'API key', 'none'),
  ] },
  { id: 'agents', title: 'Agents (Nanobot sidecar)', help: 'Published to the sidecar on save; an agent restarts with its new model (a job running on it is interrupted and retried by the queue rules).', settings: [
    model('ROGUE_AGENT_MODEL', 'Default agent model', "the sidecar's chat model"),
    ...AGENT_NAMES.map((n) => model(agentModelKey(n), `${n} model`, 'the default agent model')),
  ] },
  { id: 'ocr', title: 'OCR', test: 'ocr', help: 'Page text for scanned rulebook pages.', settings: [
    { key: 'ROGUE_OCR_PROVIDER', label: 'Provider', kind: 'ocr-provider', defaultNote: 'auto (http if a base URL is set, else command, else none)' },
    url('ROGUE_OCR_BASE_URL', 'Base URL', 'none (OCR off)'),
    secret('ROGUE_OCR_API_KEY', 'API key', 'none'),
  ] },
  { id: 'search', title: 'Web search', test: 'search', help: 'SearXNG root used by the Scout and game requests (JSON API /search?format=json).', settings: [
    url('ROGUE_SEARCH_BASE_URL', 'SearXNG base URL', 'none (search off; requests go to manual research)'),
  ] },
  { id: 'integrations', title: 'Integrations', test: 'bgg', help: 'BoardGameGeek API token (collection import) and the operator alert webhook.', settings: [
    secret('ROGUE_BGG_TOKEN', 'BGG API token', 'none (CSV upload only)'),
    secret('ROGUE_DISCORD_WEBHOOK_URL', 'Discord alert webhook URL', 'data/discord.json, else alerts only logged'),
  ] },
];

export const SETTING_DEFS: SettingDef[] = SETTING_GROUPS.flatMap((g) => g.settings);
const BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));
export const settingDef = (key: string): SettingDef | undefined => BY_KEY.get(key);

export interface ResolvedSetting { value: string | null; source: SettingSource }

/** setting > env > default. Empty strings count as unset (same as the env loaders). */
export function resolveSetting(key: string, stored: Record<string, string>, env: Record<string, string | undefined>): ResolvedSetting {
  const s = stored[key]?.trim();
  if (s) return { value: s, source: 'setting' };
  const e = env[key]?.trim();
  if (e) return { value: e, source: 'env' };
  return { value: null, source: 'default' };
}

/** The env the loaders read: process env with every stored (decrypted) setting laid over it. Unknown keys are ignored. */
export function effectiveEnv(env: Record<string, string | undefined>, stored: Record<string, string>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };
  for (const [k, v] of Object.entries(stored)) if (BY_KEY.has(k) && v.trim()) out[k] = v.trim();
  return out;
}

/** Masked secret for display: only the last 4 characters (none for very short values). */
export function maskSecret(v: string | null | undefined): string {
  if (!v) return '';
  return v.length <= 8 ? '••••' : `••••${v.slice(-4)}`;
}

/** Model ids like Olares/gemma4:e4b, claude-sonnet-5-5, org/model@rev. No spaces or control characters. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

export type SettingCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validates and normalises one submitted value. An empty value is rejected here; clearing is the separate "reset" action. */
export function validateSetting(key: string, raw: string): SettingCheck {
  const def = BY_KEY.get(key);
  if (!def) return { ok: false, error: 'unknown setting' };
  const v = raw.trim();
  if (!v) return { ok: false, error: 'empty value (use Reset to default instead)' };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, error: 'control characters are not allowed' };
  switch (def.kind) {
    case 'url': {
      let u: URL;
      try { u = new URL(v); } catch { return { ok: false, error: 'not a valid URL' }; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'URL must start with http:// or https://' };
      if (u.username || u.password) return { ok: false, error: 'put credentials in the API key field, not the URL' };
      return { ok: true, value: v.replace(/\/+$/, '') };
    }
    case 'model':
      return MODEL_RE.test(v) ? { ok: true, value: v } : { ok: false, error: 'model id may use letters, digits and . _ : / @ + - (max 200)' };
    case 'reasoning':
      return v === 'none' || v === 'low' || v === 'default' ? { ok: true, value: v } : { ok: false, error: 'reasoning must be none, low or default' };
    case 'ocr-provider':
      return ['none', 'command', 'http', 'mineru'].includes(v) ? { ok: true, value: v } : { ok: false, error: 'provider must be none, command, http or mineru' };
    case 'secret':
      if (v.length > 4096) return { ok: false, error: 'value too long' };
      // The Discord webhook is a secret URL: still check it is one, so a typo does not silently drop alerts.
      if (key === 'ROGUE_DISCORD_WEBHOOK_URL' && !/^https:\/\/\S+$/.test(v)) return { ok: false, error: 'webhook must be an https:// URL' };
      return { ok: true, value: v };
  }
}

export const isSecretSetting = (key: string): boolean => BY_KEY.get(key)?.kind === 'secret';

const ENC_PREFIX = 'enc:v1:';

/** AES-256-GCM with the backup key (same layout as backups), stored as 'enc:v1:<base64>'. */
export function encryptSecret(plain: string, key: string): string {
  return ENC_PREFIX + Buffer.from(encryptBytes(new TextEncoder().encode(plain), key)).toString('base64');
}

/** Throws on a wrong key or a damaged value. */
export function decryptSecret(stored: string, key: string): string {
  if (!stored.startsWith(ENC_PREFIX)) throw new Error('secret setting is not encrypted');
  return new TextDecoder().decode(decryptBytes(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'), key));
}

/** Audit detail for one change: old -> new for normal settings, never any part of a secret. */
export function settingAuditDetail(key: string, oldValue: string | null, newValue: string | null): Record<string, unknown> {
  if (isSecretSetting(key)) return { key, secret: true, change: newValue === null ? 'cleared' : oldValue === null ? 'set' : 'replaced' };
  return { key, old: oldValue, new: newValue };
}

/**
 * What the Nanobot sidecar reads from ROGUE_AGENT_SHARE_DIR/agent-settings.json. Only values that come from app_settings are
 * included, so an empty table publishes no overrides and the sidecar keeps its env defaults. The Router key is included
 * because the agents call the Router with it; no other secret is.
 */
export interface AgentSettingsFile {
  version: 1;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  agents: Partial<Record<AgentName, string>>;
}

export function agentSettingsFile(stored: Record<string, string>): AgentSettingsFile {
  const get = (k: string) => stored[k]?.trim() || undefined;
  const out: AgentSettingsFile = { version: 1, agents: {} };
  const baseUrl = get('ROGUE_AI_BASE_URL'); if (baseUrl) out.baseUrl = baseUrl;
  const apiKey = get('ROGUE_AI_API_KEY'); if (apiKey) out.apiKey = apiKey;
  // Agents follow the chat model today (sidecar env ROGUE_AI_CHAT_MODEL), so a chat model set here moves them too unless an agent default is set.
  const def = get('ROGUE_AGENT_MODEL') ?? get('ROGUE_AI_CHAT_MODEL'); if (def) out.defaultModel = def;
  for (const n of AGENT_NAMES) { const m = get(agentModelKey(n)); if (m) out.agents[n] = m; }
  return out;
}
