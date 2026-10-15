import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS, randomToken, sha256hex, type ProviderCreds, type ProviderId } from '@rogue/core';
import { ensureMigrated, getPool, services } from './services';
import { claimDiscordRatings } from './discord-link';

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

/** Find the user that owns this provider identity, or create user + identity on first sign-in. */
async function userIdForIdentity(provider: ProviderId, p: { uid: string; name: string; avatar: string | null }): Promise<number> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  const found = (await pool.query('SELECT user_id FROM identities WHERE provider=$1 AND provider_uid=$2', [provider, p.uid])).rows[0];
  if (found) {
    await pool.query('UPDATE users SET last_login=now() WHERE id=$1', [found.user_id]);
    return Number(found.user_id);
  }
  const u = (await pool.query('INSERT INTO users(provider, provider_uid, display_name, avatar_url) VALUES ($1,$2,$3,$4) RETURNING id', [provider, p.uid, p.name.slice(0, 80), p.avatar])).rows[0];
  await pool.query('INSERT INTO identities(provider, provider_uid, user_id) VALUES ($1,$2,$3)', [provider, p.uid, u.id]);
  return Number(u.id);
}


export async function upsertUserAndStartSession(provider: ProviderId, p: { uid: string; name: string; avatar: string | null }): Promise<string> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const userId = await userIdForIdentity(provider, p);
  if (provider === 'discord') await claimDiscordRatings(userId, p.uid);
  const token = randomToken();
  await pool.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)", [sha256hex(token), userId, String(SESSION_DAYS)]);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return token;
}

/**
 * Attach a provider identity to the signed-in user. If that identity already has its own account
 * (made before linking existed), merge it: move its identities and ratings here (keeping this user's
 * rating when both rated the same fact), then delete the old account. One transaction.
 */
export async function linkIdentity(currentUserId: number, provider: ProviderId, p: { uid: string; name: string; avatar: string | null }): Promise<'linked' | 'merged' | 'already'> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const owner = (await c.query('SELECT user_id FROM identities WHERE provider=$1 AND provider_uid=$2 FOR UPDATE', [provider, p.uid])).rows[0];
    let result: 'linked' | 'merged' | 'already' = 'linked';
    if (!owner) {
      await c.query('INSERT INTO identities(provider, provider_uid, user_id) VALUES ($1,$2,$3)', [provider, p.uid, currentUserId]);
    } else if (Number(owner.user_id) === currentUserId) {
      result = 'already';
    } else {
      const old = Number(owner.user_id);
      await c.query('UPDATE identities SET user_id=$1 WHERE user_id=$2', [currentUserId, old]);
      await c.query('INSERT INTO claim_ratings(claim_id, user_id, stars, created_at) SELECT claim_id, $1, stars, created_at FROM claim_ratings WHERE user_id=$2 ON CONFLICT (claim_id, user_id) DO NOTHING', [currentUserId, old]);
      await c.query('INSERT INTO chat_answer_ratings(answer_id, user_id, helpful, created_at) SELECT answer_id, $1, helpful, created_at FROM chat_answer_ratings WHERE user_id=$2 ON CONFLICT (answer_id, user_id) DO NOTHING', [currentUserId, old]);
      await c.query('DELETE FROM users WHERE id=$1', [old]); // cascades its sessions and leftover ratings
      // Move linked Discord votes before the old account is deleted (the FK would cascade them away).
      await c.query('UPDATE discord_answer_ratings SET user_id=$1 WHERE user_id=$2', [currentUserId, old]);
      result = 'merged';
    }
    await c.query('COMMIT');
    if (provider === 'discord') await claimDiscordRatings(currentUserId, p.uid);
    return result;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export async function identitiesOf(userId: number): Promise<string[]> {
  const pool = getPool(); if (!pool) return [];
  return (await pool.query('SELECT provider FROM identities WHERE user_id=$1 ORDER BY created_at', [userId])).rows.map((r) => r.provider);
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
