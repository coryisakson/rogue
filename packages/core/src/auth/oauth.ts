import { createHash, randomBytes } from 'node:crypto';

export type ProviderId = 'github' | 'google' | 'discord';
export interface ProviderDef { id: ProviderId; label: string; authUrl: string; tokenUrl: string; profileUrl: string; scope: string }
export interface ProviderCreds { id: string; secret: string }
export interface Profile { uid: string; name: string; avatar: string | null }

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  github: { id: 'github', label: 'GitHub', authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', profileUrl: 'https://api.github.com/user', scope: 'read:user' },
  google: { id: 'google', label: 'Google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile' },
  discord: { id: 'discord', label: 'Discord', authUrl: 'https://discord.com/oauth2/authorize', tokenUrl: 'https://discord.com/api/oauth2/token', profileUrl: 'https://discord.com/api/users/@me', scope: 'identify' },
};
export const isProviderId = (s: string): s is ProviderId => Object.hasOwn(PROVIDERS, s);

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Only same-site relative paths are allowed after login (blocks open redirects like //evil.com or https://evil.com). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next)) return '/';
  return next.slice(0, 300);
}

export function buildAuthUrl(p: ProviderDef, clientId: string, redirectUri: string, state: string): string {
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', state);
  return u.toString();
}

export function normalizeProfile(id: ProviderId, j: Record<string, unknown>): Profile | null {
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  if (id === 'github' && j['id'] != null) return { uid: String(j['id']), name: s(j['name']) ?? s(j['login']) ?? 'GitHub user', avatar: s(j['avatar_url']) };
  if (id === 'google' && s(j['sub'])) return { uid: String(j['sub']), name: s(j['name']) ?? 'Google user', avatar: s(j['picture']) };
  if (id === 'discord' && s(j['id'])) {
    const uid = String(j['id']); const av = s(j['avatar']);
    return { uid, name: s(j['global_name']) ?? s(j['username']) ?? 'Discord user', avatar: av ? `https://cdn.discordapp.com/avatars/${uid}/${av}.png?size=64` : null };
  }
  return null;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Authorization-code exchange + profile lookup. fetch is injected so tests need no network. */
export async function exchangeCode(p: ProviderDef, creds: ProviderCreds, code: string, redirectUri: string, f: FetchFn = fetch): Promise<Profile> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: creds.id, client_secret: creds.secret });
  const tr = await f(p.tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!tr.ok) throw new Error(`token endpoint returned ${tr.status}`);
  const token = (await tr.json()) as Record<string, unknown>;
  const at = typeof token['access_token'] === 'string' ? token['access_token'] : '';
  if (!at) throw new Error('no access_token in response');
  const pr = await f(p.profileUrl, { headers: { authorization: `Bearer ${at}`, accept: 'application/json', 'user-agent': 'rogue-tabletop' } });
  if (!pr.ok) throw new Error(`profile endpoint returned ${pr.status}`);
  const prof = normalizeProfile(p.id, (await pr.json()) as Record<string, unknown>);
  if (!prof) throw new Error('profile had no usable id');
  return prof;
}

/** CSRF guard for state-changing POSTs: Origin (or Referer) host must equal the Host we are served on. */
export function sameOrigin(origin: string | null, referer: string | null, host: string | null): boolean {
  const src = origin ?? referer; if (!src || !host) return false;
  try { return new URL(src).host === host; } catch { return false; }
}
