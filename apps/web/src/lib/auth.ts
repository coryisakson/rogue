import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS, randomToken, sha256hex, type ProviderCreds, type ProviderId } from '@rogue/core';
import { ensureMigrated, getPool, services } from './services';

export interface SessionUser { id: number; name: string; avatar: string | null; provider: ProviderId }
export const SESSION_COOKIE = 'rogue_session';
const SESSION_DAYS = 30;

/** OAuth app credentials: env ROGUE_OAUTH_<PROVIDER>_ID/_SECRET win, else /app/data/oauth.json {"github":{"id":"..","secret":".."}}. Never logged. */
export function configuredProviders(): Partial<Record<ProviderId, ProviderCreds>> {
  const out: Partial<Record<ProviderId, ProviderCreds>> = {};
  let file: Record<string, Partial<ProviderCreds>> = {};
  try { file = JSON.parse(readFileSync(join(services.dataDir, 'oauth.json'), 'utf8')); } catch { /* optional */ }
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
    const up = id.toUpperCase();
    const cid = process.env[`ROGUE_OAUTH_${up}_ID`] ?? file[id]?.id;
    const sec = process.env[`ROGUE_OAUTH_${up}_SECRET`] ?? file[id]?.secret;
    if (cid && sec) out[id] = { id: cid, secret: sec };
  }
  return out;
}

/** Public base URL used for the OAuth redirect URI (must match what is registered at the provider). */
export function baseUrl(req: Request): string {
  const fixed = process.env['ROGUE_PUBLIC_URL']; if (fixed) return fixed.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
  const local = /^(localhost|127\.)/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

export function cookieValue(req: Request, name: string): string | null {
  const m = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
export const setCookie = (name: string, value: string, maxAgeSec: number): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

export async function upsertUserAndStartSession(provider: ProviderId, p: { uid: string; name: string; avatar: string | null }): Promise<string> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const u = (await pool.query(
    `INSERT INTO users(provider, provider_uid, display_name, avatar_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider, provider_uid) DO UPDATE SET display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url, last_login=now() RETURNING id`,
    [provider, p.uid, p.name.slice(0, 80), p.avatar])).rows[0];
  const token = randomToken();
  await pool.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)", [sha256hex(token), u.id, String(SESSION_DAYS)]);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return token;
}

export async function userFromRequest(req: Request): Promise<SessionUser | null> {
  const token = cookieValue(req, SESSION_COOKIE); if (!token) return null;
  const pool = getPool(); if (!pool) return null;
  try {
    await ensureMigrated();
    const r = (await pool.query(
      'SELECT u.id, u.display_name, u.avatar_url, u.provider FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()', [sha256hex(token)])).rows[0];
    return r ? { id: Number(r.id), name: r.display_name, avatar: r.avatar_url, provider: r.provider } : null;
  } catch { return null; }
}

export async function endSession(req: Request): Promise<void> {
  const token = cookieValue(req, SESSION_COOKIE); const pool = getPool();
  if (token && pool) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [sha256hex(token)]);
}
