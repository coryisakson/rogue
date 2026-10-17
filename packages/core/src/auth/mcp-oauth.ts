/**
 * OAuth 2.1 authorization server for the MCP endpoint, pure parts (ADR 0004). No I/O: the routes and the database live in
 * apps/web/src/lib/oauth.ts. Rogue is both the authorization server (issuer = public origin) and the resource server
 * (resource = <origin>/mcp). Users sign in with the existing Rogue login; this file only checks OAuth messages.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { randomToken, sha256hex } from './oauth.js';

export type McpScope = 'profile:read' | 'facts:rate' | 'games:request';
/** Every scope we issue, with the plain-English line the consent screen shows (i18n key `oauth.scope.<scope>`). */
export const MCP_SCOPES: readonly McpScope[] = ['profile:read', 'facts:rate', 'games:request'];

/** Lifetimes in seconds. */
export const OAUTH_TTL = { code: 5 * 60, access: 60 * 60, refresh: 30 * 24 * 60 * 60, pending: 10 * 60 } as const;

/** Prefixes make leaked tokens easy to recognise (secret scanners, logs). */
export const TOKEN_PREFIX = { access: 'rga_', refresh: 'rgr_', code: 'rgc_', client: 'rgcl_' } as const;
export const newSecret = (kind: keyof typeof TOKEN_PREFIX): string => TOKEN_PREFIX[kind] + randomToken(32);
/** Codes and tokens are stored only as this hash (like sessions). */
export const hashToken = (token: string): string => sha256hex(token);

// ---------- PKCE (RFC 7636, S256 only) ----------

/** code_verifier: 43-128 characters from the unreserved set. */
export const validVerifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
/** code_challenge for S256 is base64url(sha256(verifier)): exactly 43 characters. */
export const validChallenge = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(c);
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier, 'ascii').digest('base64url');

/** Constant-time check of a verifier against the stored challenge. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!validVerifier(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier)); const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Scopes ----------

export type ScopeParse = { ok: true; scopes: McpScope[] } | { ok: false; error: string };

/** Space-separated scope string -> known scopes. Empty = every scope (the consent screen lists them). Unknown = refused. */
export function parseScopes(raw: unknown): ScopeParse {
  const words = typeof raw === 'string' ? raw.split(' ').filter(Boolean) : [];
  if (!words.length) return { ok: true, scopes: [...MCP_SCOPES] };
  const unknown = words.filter((w) => !(MCP_SCOPES as readonly string[]).includes(w));
  if (unknown.length) return { ok: false, error: `Unknown scope: ${unknown.slice(0, 3).join(' ').slice(0, 80)}` };
  // Keep our canonical order and drop duplicates.
  return { ok: true, scopes: MCP_SCOPES.filter((s) => words.includes(s)) };
}
export const scopeString = (scopes: readonly string[]): string => scopes.join(' ');
export const hasScopes = (granted: readonly string[], needed: readonly string[]): boolean => needed.every((s) => granted.includes(s));

// ---------- Resource (RFC 8707) ----------

/** Canonical resource URI: lowercase scheme and host, no trailing slash, no query or fragment. Null if not absolute http(s). */
export function canonicalResource(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hash || u.search || u.username || u.password) return null;
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

// ---------- Redirect URIs ----------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const BAD_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:', 'mailto:', 'tel:']);

/**
 * Is this redirect URI acceptable at registration? https anywhere; http only on loopback (native apps, RFC 8252);
 * private-use schemes of native apps (cursor://..., com.example.app:/cb). Returns a problem or null.
 */
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 500) return 'redirect_uri must be a URL of at most 500 characters';
  let u: URL;
  try { u = new URL(raw); } catch { return 'redirect_uri is not an absolute URL'; }
  if (u.hash || raw.includes('#')) return 'redirect_uri must not contain a fragment';
  if (u.username || u.password) return 'redirect_uri must not contain a user name or password';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname) ? null : 'http redirect URIs are only allowed on localhost';
  if (BAD_SCHEMES.has(u.protocol)) return `redirect_uri scheme ${u.protocol} is not allowed`;
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) ? null : 'redirect_uri scheme is not valid';
}

/**
 * Exact match against the registered list. One allowed difference: the port of an http loopback URI, because native apps
 * pick a free port at run time (RFC 8252 7.3, OAuth 2.1).
 */
export function redirectMatches(registered: readonly string[], given: unknown): boolean {
  if (typeof given !== 'string' || !given) return false;
  if (registered.includes(given)) return true;
  let g: URL;
  try { g = new URL(given); } catch { return false; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch { return false; }
  });
}

/** Adds parameters to a redirect URI, keeping its own query (RFC 6749 3.1.2). */
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** CSP form-action source that lets the consent form's redirect reach the client (Chrome checks redirects too). */
export function cspSourceFor(uri: string): string {
  const u = new URL(uri);
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : u.protocol;
}

/** The host (or scheme, for native apps) the consent screen names as "sends you back to". */
export function redirectLabel(uri: string): string {
  const u = new URL(uri);
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : `${u.protocol}//${u.host}`;
}

// ---------- Client registration (RFC 7591) ----------

export interface ClientRegistration { clientName: string; redirectUris: string[] }
export type RegistrationParse = { ok: true; value: ClientRegistration } | { ok: false; error: string; description: string };

/** Validates a registration body. Public clients only: no secrets, code + refresh grants, PKCE. */
export function parseRegistration(body: unknown): RegistrationParse {
  const bad = (description: string, error = 'invalid_client_metadata'): RegistrationParse => ({ ok: false, error, description });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const uris = b['redirect_uris'];
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) return bad('redirect_uris must list 1 to 10 URIs', 'invalid_redirect_uri');
  for (const u of uris) { const p = redirectUriProblem(u); if (p) return bad(p, 'invalid_redirect_uri'); }
  const method = b['token_endpoint_auth_method'];
  if (method !== undefined && method !== 'none') return bad('only public clients are supported (token_endpoint_auth_method "none")');
  const grants = b['grant_types'];
  if (grants !== undefined && (!Array.isArray(grants) || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')))
    return bad('grant_types may only contain authorization_code and refresh_token');
  const types = b['response_types'];
  if (types !== undefined && (!Array.isArray(types) || types.some((t) => t !== 'code'))) return bad('response_types may only contain code');
  // The name is chosen by the client and unverified; strip control characters and keep it short.
  const rawName = typeof b['client_name'] === 'string' ? b['client_name'] : '';
  const clientName = rawName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unnamed app';
  return { ok: true, value: { clientName, redirectUris: [...new Set(uris as string[])] } };
}

// ---------- Metadata documents ----------

/** RFC 9728 Protected Resource Metadata for <origin>/mcp. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'T-AI-bletop Rogue MCP',
    resource_documentation: `${origin}/docs/mcp`,
  };
}
export const resourceMetadataUrl = (origin: string): string => `${origin}/.well-known/oauth-protected-resource/mcp`;

/** RFC 8414 Authorization Server Metadata. Issuer has no path, so it lives at /.well-known/oauth-authorization-server. */
export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/docs/mcp`,
  };
}

// ---------- Bearer tokens at the resource ----------

/** The token from `Authorization: Bearer <token>`; null when absent, '' when the header is there but malformed. */
export function parseBearer(header: string | null): string | null {
  if (header === null) return null;
  const m = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  return m ? m[1]! : '';
}

/** RFC 6750 WWW-Authenticate value. Values are our own constants, but quotes are escaped anyway. */
export function wwwAuthenticate(params: { resourceMetadata: string; scope?: string; error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description?: string }): string {
  const q = (v: string) => `"${v.replace(/["\\]/g, '')}"`;
  const parts = [`resource_metadata=${q(params.resourceMetadata)}`];
  if (params.scope) parts.push(`scope=${q(params.scope)}`);
  if (params.error) parts.push(`error=${q(params.error)}`);
  if (params.description) parts.push(`error_description=${q(params.description)}`);
  return `Bearer ${parts.join(', ')}`;
}

/** Consent-form CSRF token, derived from the session token so it needs no storage and dies with the session. */
export const consentCsrf = (sessionToken: string): string => sha256hex(`rogue-oauth-consent:${sessionToken}`);

// ---------- Authorization request ----------

export interface AuthorizeRequest {
  clientId: string; redirectUri: string; state: string | undefined; codeChallenge: string; scopes: McpScope[]; resource: string;
}
/** `redirect: false` errors must be shown as a page: the redirect URI is not trusted yet (no open redirect). */
export type AuthorizeParse = { ok: true; value: AuthorizeRequest } | { ok: false; redirect: boolean; error: string; description: string };

/**
 * Checks an authorization request. `registered` is the client's redirect list (null = unknown client). Order matters:
 * client and redirect URI first (errors not redirected), then everything else (errors sent back to the client).
 */
export function parseAuthorizeRequest(p: Record<string, string | undefined>, registered: readonly string[] | null, resource: string): AuthorizeParse {
  const page = (description: string): AuthorizeParse => ({ ok: false, redirect: false, error: 'invalid_request', description });
  const back = (error: string, description: string): AuthorizeParse => ({ ok: false, redirect: true, error, description });
  if (!p['client_id']) return page('client_id is missing');
  if (!registered) return page('This app is not registered with Rogue (unknown client_id).');
  if (!p['redirect_uri'] || !redirectMatches(registered, p['redirect_uri'])) return page('redirect_uri does not match what this app registered.');
  const state = p['state'];
  if (state !== undefined && state.length > 500) return back('invalid_request', 'state is too long');
  if (p['response_type'] !== 'code') return back('unsupported_response_type', 'only response_type=code is supported');
  if (p['code_challenge_method'] !== 'S256') return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  if (!validChallenge(p['code_challenge'])) return back('invalid_request', 'code_challenge is missing or malformed');
  const sc = parseScopes(p['scope']);
  if (!sc.ok) return back('invalid_scope', sc.error);
  // Spec: clients MUST send resource; be lenient when it is absent, strict when it names someone else.
  if (p['resource'] !== undefined && canonicalResource(p['resource']) !== resource) return back('invalid_target', 'resource must be this server\'s /mcp URL');
  return { ok: true, value: { clientId: p['client_id'], redirectUri: p['redirect_uri'], state, codeChallenge: p['code_challenge'], scopes: sc.scopes, resource } };
}

/** The query keys an authorization request may carry; everything else is dropped before it is parked in a cookie. */
export const AUTHORIZE_KEYS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const;
export function pickAuthorizeParams(get: (k: string) => string | null): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of AUTHORIZE_KEYS) { const v = get(k); if (v !== null) out[k] = v.slice(0, 600); }
  return out;
}
