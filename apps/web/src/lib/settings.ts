import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SETTING_DEFS, agentSettingsFile, decryptSecret, effectiveEnv, encryptSecret, isSecretSetting, maskSecret, resolveSetting, settingAuditDetail,
  validateSetting, type SettingDef, type SettingSource,
} from '@rogue/core';
import { ensureMigrated, getPool } from './services';
import { backupKey } from './backup-runner';

/**
 * The ONE place the app reads models, endpoints and keys from (/admin/settings, migration 0039).
 * Order: app_settings value, else env var, else the code default in the loaders. Values are cached in memory for 15 s and
 * reloaded right after a save. Reads are synchronous: a stale cache serves the old value once while a reload runs in the
 * background, and until the first load finishes (or without a database) the env alone applies, i.e. today's behaviour.
 */
const TTL_MS = 15_000;

interface StoredMeta { updatedBy: number | null; updatedAt: string }
let stored: Record<string, string> = {}; // decrypted values
let meta: Record<string, StoredMeta> = {};
let loadedAt = 0;
let loading: Promise<void> | null = null;
let version = 0;
let merged: { version: number; env: Record<string, string | undefined> } | null = null;

/** process.env with the stored settings laid over it. Pass this to every loader (loadServices, ocrProviderFromEnv, ...). */
export function settingsEnv(): Record<string, string | undefined> {
  if (Date.now() - loadedAt > TTL_MS) void refreshSettings();
  if (!merged || merged.version !== version) merged = { version, env: effectiveEnv(process.env, stored) };
  return merged.env;
}

/** One setting's effective value (setting > env), or undefined. */
export const setting = (key: string): string | undefined => settingsEnv()[key]?.trim() || undefined;

/** Changes whenever the stored settings change; callers memoise derived config on it. */
export const settingsVersion = (): number => version;

export function refreshSettings(): Promise<void> {
  loading ??= load().finally(() => { loading = null; });
  return loading;
}

async function load(): Promise<void> {
  const pool = getPool();
  try {
    if (!pool) return;
    await ensureMigrated();
    const rows = (await pool.query('SELECT key, value, is_secret, updated_by, updated_at FROM app_settings')).rows as { key: string; value: string; is_secret: boolean; updated_by: string | null; updated_at: Date }[];
    const next: Record<string, string> = {};
    const nextMeta: Record<string, StoredMeta> = {};
    for (const r of rows) {
      try {
        next[r.key] = r.is_secret ? decryptSecret(r.value, backupKey()) : r.value;
        nextMeta[r.key] = { updatedBy: r.updated_by === null ? null : Number(r.updated_by), updatedAt: new Date(r.updated_at).toISOString() };
      } catch (e) {
        // A secret saved under another backup key cannot be read: skip it (env/default applies) rather than break every AI call.
        console.warn(`[settings] cannot decrypt ${r.key}: ${(e as Error).message}; using env/default`);
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(stored)) { stored = next; version++; }
    meta = nextMeta;
    publishAgentSettings();
  } catch (e) {
    console.warn(`[settings] load failed, using env: ${(e as Error).message}`);
  } finally {
    loadedAt = Date.now();
  }
}

/** Reload now (after a save), waiting for any load already running so the new value is seen. */
async function reloadNow(): Promise<void> {
  if (loading) await loading.catch(() => {});
  await refreshSettings();
}

const audit = (adminId: number, detail: Record<string, unknown>) =>
  getPool()!.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`user:${adminId}`, 'setting_change', detail]);

/** Validate, store (secrets encrypted) and audit one value. Returns an error message for the form, or null. */
export async function saveSetting(key: string, raw: string, adminId: number): Promise<string | null> {
  const pool = getPool(); if (!pool) return 'no database';
  const check = validateSetting(key, raw);
  if (!check.ok) return check.error;
  await ensureMigrated();
  await reloadNow();
  const old = stored[key] ?? null;
  if (old === check.value) return null;
  const secret = isSecretSetting(key);
  const value = secret ? encryptSecret(check.value, backupKey()) : check.value;
  await pool.query(
    `INSERT INTO app_settings(key, value, is_secret, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, is_secret=EXCLUDED.is_secret, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [key, value, secret, adminId]);
  await audit(adminId, settingAuditDetail(key, old, check.value));
  await reloadNow();
  return null;
}

/** Remove the stored value so env/default applies again. */
export async function resetSetting(key: string, adminId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  const r = await pool.query('DELETE FROM app_settings WHERE key=$1 RETURNING key', [key]);
  if (r.rowCount) await audit(adminId, settingAuditDetail(key, stored[key] ?? '', null));
  await reloadNow();
}

export interface SettingView {
  def: SettingDef;
  /** Display value: full for normal settings, masked (last 4) for secrets, null when unset. */
  shown: string | null;
  source: SettingSource;
  updatedAt?: string;
  updatedBy?: number | null;
}

/** What the settings page shows for one key. Secret values never leave this module unmasked. */
export async function settingsView(): Promise<SettingView[]> {
  await reloadNow();
  return SETTING_DEFS.map((def) => {
    const r = resolveSetting(def.key, stored, process.env);
    const m = r.source === 'setting' ? meta[def.key] : undefined;
    return { def, shown: def.kind === 'secret' ? (r.value ? maskSecret(r.value) : null) : r.value, source: r.source, ...(m ? { updatedAt: m.updatedAt, updatedBy: m.updatedBy } : {}) };
  });
}

let published: string | null = null;

/**
 * Hand the agent overrides to the Nanobot sidecar (ROGUE_AGENT_SHARE_DIR/agent-settings.json). The sidecar watches the file and
 * restarts an agent whose config changed. Only stored values are written, so an empty table publishes no overrides.
 */
function publishAgentSettings(): void {
  const dir = process.env['ROGUE_AGENT_SHARE_DIR'] ?? ''; if (!dir) return;
  const body = JSON.stringify(agentSettingsFile(stored), null, 2) + '\n';
  if (body === published) return;
  const file = join(dir, 'agent-settings.json');
  try {
    if (!(existsSync(file) && readFileSync(file, 'utf8') === body)) {
      // Same mode as agent-key: the sidecar runs as another user and mounts the share read-only.
      writeFileSync(`${file}.tmp`, body, { mode: 0o644 });
      renameSync(`${file}.tmp`, file);
    }
    published = body;
  } catch (e) { console.warn(`[settings] cannot publish agent settings: ${(e as Error).message}`); }
}
