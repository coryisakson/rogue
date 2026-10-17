/**
 * MCP OAuth authorization server, database side (ADR 0004). The message checks are pure helpers in
 * packages/core/src/auth/mcp-oauth.ts; this file stores clients, codes and tokens (hashes only) and answers the routes.
 * Off unless ROGUE_MCP_OAUTH=1 (RGE-A19). Never log a token, code, verifier or Authorization header.
 */
import { randomUUID } from 'node:crypto';
import {
  hashToken, newSecret, OAUTH_TTL, parseScopes, RateLimiter, scopeString, verifyPkce, type ClientRegistration, type McpScope,
} from '@rogue/core';
import { publicOrigin } from './mcp';
import { ensureMigrated, getPool } from './services';

export const oauthEnabled = (): boolean => process.env['ROGUE_MCP_OAUTH'] === '1';

/** Issuer and resource must not change between requests: ROGUE_PUBLIC_URL pins them, else the proxy headers decide. */
export function oauthOrigin(req: Request): string {
  const fixed = process.env['ROGUE_PUBLIC_URL'];
  return fixed ? fixed.replace(/\/$/, '') : publicOrigin(req);
}
export const mcpResource = (req: Request): string => `${oauthOrigin(req)}/mcp`;

/** 404 with no body, as when the routes do not exist (flag off). */
export const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

const g = globalThis as Record<string, unknown>;
const limiter = (key: string, n: number, ms: number) => (g[key] ??= new RateLimiter(n, ms)) as RateLimiter;
/** Budgets from ADR 0004 (in memory, per process). */
export const oauthLimits = {
  register: limiter('__rogueOauthRegister', 10, 3_600_000),
  token: limiter('__rogueOauthToken', 30, 60_000),
  authorize: limiter('__rogueOauthAuthorize', 30, 60_000),
  revoke: limiter('__rogueOauthRevoke', 30, 60_000),
  mcpUser: limiter('__rogueOauthMcpUser', 60, 60_000),
};

/** OAuth JSON reply; token responses must not be cached (RFC 6749 5.1). */
export const oauthJson = (body: unknown, status = 200, extra: Record<string, string> = OPEN_CORS) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...extra } });
export const oauthError = (error: string, description: string, status = 400) => oauthJson({ error, error_description: description }, status, OPEN_CORS);

/**
 * Browser-based MCP clients (Inspector) call discovery, register, token and revoke cross-origin. These answer with
 * JSON only and use no cookies, so any origin may read them. The consent page and /oauth/apps never get CORS.
 */
export const OPEN_CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
  'access-control-max-age': '86400',
};
export const preflight = () => (oauthEnabled() ? new Response(null, { status: 204, headers: OPEN_CORS }) : notFound());

/** Public metadata document (RFC 9728 / RFC 8414): cacheable for an hour. */
export const metadataResponse = (doc: unknown) =>
  new Response(JSON.stringify(doc, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600', ...OPEN_CORS } });

/** Form or JSON body as a flat string map (token and revoke take form encoding; some clients send JSON). */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const text = (await request.text()).slice(0, 16_384);
  if (type.includes('application/json')) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]));
    } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// ---------- Clients ----------

export interface OAuthClient { clientId: string; clientName: string; redirectUris: string[] }

export async function registerClient(c: ClientRegistration): Promise<OAuthClient> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const clientId = newSecret('client');
  await pool.query('INSERT INTO oauth_clients(client_id, client_name, redirect_uris) VALUES ($1,$2,$3)', [clientId, c.clientName, c.redirectUris]);
  return { clientId, ...c };
}

export async function getClient(clientId: string | null | undefined): Promise<OAuthClient | null> {
  const pool = getPool(); if (!pool || !clientId || clientId.length > 100) return null;
  await ensureMigrated();
  const r = (await pool.query('SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id=$1', [clientId])).rows[0];
  return r ? { clientId: r.client_id, clientName: r.client_name, redirectUris: r.redirect_uris } : null;
}

// ---------- Codes ----------

export interface NewCode { clientId: string; userId: number; redirectUri: string; codeChallenge: string; scopes: McpScope[]; resource: string }

export async function createCode(c: NewCode): Promise<string> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  const code = newSecret('code');
  await pool.query(
    `INSERT INTO oauth_codes(code_hash, grant_id, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' seconds')::interval)`,
    [hashToken(code), randomUUID(), c.clientId, c.userId, c.redirectUri, c.codeChallenge, scopeString(c.scopes), c.resource, String(OAUTH_TTL.code)]);
  await pool.query("DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'");
  return code;
}

export interface TokenSet { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
type Grant = { grantId: string; clientId: string; userId: number; scope: string; resource: string };

async function issue(g: Grant): Promise<TokenSet> {
  const pool = getPool()!;
  const access = newSecret('access'); const refresh = newSecret('refresh');
  const insert = `INSERT INTO oauth_tokens(token_hash, kind, grant_id, client_id, user_id, scope, resource, expires_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' seconds')::interval)`;
  await pool.query(insert, [hashToken(access), 'access', g.grantId, g.clientId, g.userId, g.scope, g.resource, String(OAUTH_TTL.access)]);
  await pool.query(insert, [hashToken(refresh), 'refresh', g.grantId, g.clientId, g.userId, g.scope, g.resource, String(OAUTH_TTL.refresh)]);
  return { access_token: access, token_type: 'Bearer', expires_in: OAUTH_TTL.access, refresh_token: refresh, scope: g.scope };
}

/** Audit trail for OAuth events. Ids only (no tokens, no names); a failed audit write must never break the OAuth flow. */
async function audit(action: string, detail: Record<string, unknown>): Promise<void> {
  try { await getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['oauth', action, detail]); } catch { /* best effort */ }
}

/** Revokes every live token of a grant and records why (revoked / reuse detected / user action). */
export const revokeGrant = async (grantId: string, reason = 'client_revoke'): Promise<void> => {
  const r = await getPool()?.query('UPDATE oauth_tokens SET revoked_at=now() WHERE grant_id=$1 AND revoked_at IS NULL', [grantId]);
  if (r?.rowCount) await audit('oauth_grant_revoked', { grantId, reason, tokens: r.rowCount });
};

export type TokenResult = { ok: true; tokens: TokenSet } | { ok: false; error: string; description: string };
const refuse = (error: string, description: string): TokenResult => ({ ok: false, error, description });

/** grant_type=authorization_code. The code is spent atomically; a second use revokes the grant (RFC 6749 4.1.2). */
export async function exchangeCode(p: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string | null }): Promise<TokenResult> {
  const pool = getPool(); if (!pool) return refuse('server_error', 'database not configured');
  await ensureMigrated();
  const hash = hashToken(p.code);
  const spent = (await pool.query(
    'UPDATE oauth_codes SET used_at=now() WHERE code_hash=$1 AND used_at IS NULL RETURNING grant_id, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at > now() AS live',
    [hash])).rows[0];
  if (!spent) {
    const reused = (await pool.query('SELECT grant_id FROM oauth_codes WHERE code_hash=$1', [hash])).rows[0];
    if (reused) await revokeGrant(reused.grant_id, 'code_reuse');
    return refuse('invalid_grant', 'authorization code is invalid, expired or already used');
  }
  if (!spent.live) return refuse('invalid_grant', 'authorization code expired');
  if (spent.client_id !== p.clientId) return refuse('invalid_grant', 'code was issued to another client');
  if (spent.redirect_uri !== p.redirectUri) return refuse('invalid_grant', 'redirect_uri does not match the authorization request');
  if (p.resource !== null && p.resource !== spent.resource) return refuse('invalid_target', 'resource does not match the authorization request');
  if (!verifyPkce(p.verifier, spent.code_challenge)) return refuse('invalid_grant', 'PKCE code_verifier does not match');
  const tokens = await issue({ grantId: spent.grant_id, clientId: spent.client_id, userId: Number(spent.user_id), scope: spent.scope, resource: spent.resource });
  await audit('oauth_grant_issued', { grantId: spent.grant_id, clientId: spent.client_id, userId: Number(spent.user_id), scope: spent.scope });
  return { ok: true, tokens };
}

/** grant_type=refresh_token. Rotates: the old refresh token dies; presenting a dead one revokes the whole grant. */
export async function refreshTokens(p: { refreshToken: string; clientId: string; scope: string | null; resource: string | null }): Promise<TokenResult> {
  const pool = getPool(); if (!pool) return refuse('server_error', 'database not configured');
  await ensureMigrated();
  const hash = hashToken(p.refreshToken);
  const row = (await pool.query(
    "UPDATE oauth_tokens SET revoked_at=now(), last_used_at=now() WHERE token_hash=$1 AND kind='refresh' AND revoked_at IS NULL AND expires_at > now() RETURNING grant_id, client_id, user_id, scope, resource",
    [hash])).rows[0];
  if (!row) {
    const dead = (await pool.query("SELECT grant_id FROM oauth_tokens WHERE token_hash=$1 AND kind='refresh'", [hash])).rows[0];
    if (dead) await revokeGrant(dead.grant_id, 'refresh_reuse'); // reuse detection
    return refuse('invalid_grant', 'refresh token is invalid, expired or revoked');
  }
  if (row.client_id !== p.clientId) { await revokeGrant(row.grant_id, 'client_mismatch'); return refuse('invalid_grant', 'refresh token was issued to another client'); }
  if (p.resource !== null && p.resource !== row.resource) return refuse('invalid_target', 'resource does not match the grant');
  let scope: string = row.scope;
  if (p.scope) {
    // A refresh may narrow the scope, never widen it (RFC 6749 6).
    const asked = parseScopes(p.scope);
    const granted = String(row.scope).split(' ');
    if (!asked.ok || asked.scopes.some((s) => !granted.includes(s))) return refuse('invalid_scope', 'a refresh cannot add scopes');
    scope = scopeString(asked.scopes);
  }
  return { ok: true, tokens: await issue({ grantId: row.grant_id, clientId: row.client_id, userId: Number(row.user_id), scope, resource: row.resource }) };
}

/** RFC 7009: the client revokes one of its tokens; we revoke the whole grant. Unknown tokens are not an error. */
export async function revokeToken(token: string, clientId: string | null): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  const row = (await pool.query('SELECT grant_id, client_id FROM oauth_tokens WHERE token_hash=$1', [hashToken(token)])).rows[0];
  if (row && (!clientId || row.client_id === clientId)) await revokeGrant(row.grant_id);
}

// ---------- Resource side ----------

export interface TokenUser { userId: number; name: string; provider: string; language: string | null; scopes: McpScope[]; clientId: string }

/** Valid, unexpired, unrevoked access token issued for this resource, or null. */
export async function verifyAccessToken(token: string, resource: string): Promise<TokenUser | null> {
  const pool = getPool(); if (!pool || !token || token.length > 200) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `UPDATE oauth_tokens t SET last_used_at=now() FROM users u
     WHERE t.token_hash=$1 AND t.kind='access' AND t.revoked_at IS NULL AND t.expires_at > now() AND t.resource=$2 AND u.id=t.user_id
     RETURNING t.user_id, t.scope, t.client_id, u.display_name, u.provider, u.language`, [hashToken(token), resource])).rows[0];
  if (!r) return null;
  const sc = parseScopes(r.scope);
  return { userId: Number(r.user_id), name: r.display_name, provider: r.provider, language: r.language, scopes: sc.ok ? sc.scopes : [], clientId: r.client_id };
}

// ---------- Connected apps ----------

export interface ConnectedApp { grantId: string; clientName: string; scopes: string[]; since: Date; lastUsed: Date | null }

/** The user's live grants: at least one token not revoked and not expired. */
export async function listConnectedApps(userId: number): Promise<ConnectedApp[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const rows = (await pool.query(
    `SELECT t.grant_id, c.client_name, max(t.scope) AS scope, min(t.created_at) AS since, max(t.last_used_at) AS last_used
     FROM oauth_tokens t JOIN oauth_clients c ON c.client_id=t.client_id
     WHERE t.user_id=$1 AND t.grant_id IN (SELECT grant_id FROM oauth_tokens WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now())
     GROUP BY t.grant_id, c.client_name ORDER BY since DESC`, [userId])).rows;
  return rows.map((r) => ({ grantId: r.grant_id, clientName: r.client_name, scopes: String(r.scope).split(' '), since: r.since, lastUsed: r.last_used }));
}

/** Revoke one of the user's own grants. Returns false when it is not theirs. */
export async function revokeUserGrant(userId: number, grantId: string): Promise<boolean> {
  const pool = getPool(); if (!pool) return false;
  const r = await pool.query('UPDATE oauth_tokens SET revoked_at=now() WHERE grant_id=$1 AND user_id=$2 AND revoked_at IS NULL', [grantId, userId]);
  if (r.rowCount) await audit('oauth_grant_revoked', { grantId, userId, reason: 'user_revoke', tokens: r.rowCount });
  return (r.rowCount ?? 0) > 0;
}
