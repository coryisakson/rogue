import { describe, expect, it } from 'vitest';
import {
  authServerMetadata, canonicalResource, consentCsrf, cspSourceFor, hashToken, hasScopes, MCP_SCOPES, newSecret, parseAuthorizeRequest,
  parseBearer, parseRegistration, parseScopes, pickAuthorizeParams, pkceChallenge, protectedResourceMetadata, redirectLabel,
  redirectMatches, redirectUriProblem, validChallenge, verifyPkce, withParams, wwwAuthenticate,
} from './mcp-oauth.js';

// RFC 7636 Appendix B test vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const ORIGIN = 'https://rogue.test';
const RESOURCE = `${ORIGIN}/mcp`;

describe('PKCE S256', () => {
  it('matches the RFC 7636 test vector', () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(validChallenge(CHALLENGE)).toBe(true);
  });
  it('rejects a wrong, short or non-string verifier', () => {
    expect(verifyPkce(VERIFIER.replace('d', 'e'), CHALLENGE)).toBe(false);
    expect(verifyPkce('short', pkceChallenge('short'))).toBe(false);
    expect(verifyPkce(undefined, CHALLENGE)).toBe(false);
    expect(verifyPkce('a'.repeat(129), pkceChallenge('a'.repeat(129)))).toBe(false);
    expect(validChallenge('plain-challenge')).toBe(false);
  });
});

describe('tokens', () => {
  it('are prefixed, random and stored only as a sha-256 hash', () => {
    const a = newSecret('access'); const b = newSecret('access');
    expect(a.startsWith('rga_')).toBe(true);
    expect(newSecret('refresh').startsWith('rgr_')).toBe(true);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
  it('parses only Authorization: Bearer headers', () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer('Bearer rga_abc-_.~')).toBe('rga_abc-_.~');
    expect(parseBearer('bearer   xyz==')).toBe('xyz==');
    expect(parseBearer('Basic dXNlcg==')).toBe('');
    expect(parseBearer('Bearer a b')).toBe('');
  });
  it('builds RFC 6750 challenges', () => {
    expect(wwwAuthenticate({ resourceMetadata: 'https://r/x', scope: 'facts:rate' })).toBe('Bearer resource_metadata="https://r/x", scope="facts:rate"');
    expect(wwwAuthenticate({ resourceMetadata: 'https://r/x', error: 'invalid_token', description: 'bad "q"' })).toBe('Bearer resource_metadata="https://r/x", error="invalid_token", error_description="bad q"');
  });
  it('derives a stable consent CSRF token per session', () => {
    expect(consentCsrf('s1')).toBe(consentCsrf('s1'));
    expect(consentCsrf('s1')).not.toBe(consentCsrf('s2'));
  });
});

describe('scopes', () => {
  it('defaults to every scope, keeps order, refuses unknown ones', () => {
    expect(parseScopes(undefined)).toEqual({ ok: true, scopes: [...MCP_SCOPES] });
    expect(parseScopes('games:request facts:rate facts:rate')).toEqual({ ok: true, scopes: ['facts:rate', 'games:request'] });
    expect(parseScopes('facts:rate admin').ok).toBe(false);
    expect(parseScopes('offline_access').ok).toBe(false);
    expect(hasScopes(['facts:rate', 'profile:read'], ['facts:rate'])).toBe(true);
    expect(hasScopes(['profile:read'], ['facts:rate'])).toBe(false);
  });
});

describe('resource and metadata', () => {
  it('canonicalises the resource URI', () => {
    expect(canonicalResource('HTTPS://Rogue.TEST/mcp/')).toBe(RESOURCE);
    expect(canonicalResource('https://rogue.test/mcp#x')).toBeNull();
    expect(canonicalResource('rogue.test/mcp')).toBeNull();
    expect(canonicalResource('ftp://rogue.test/mcp')).toBeNull();
  });
  it('publishes RFC 9728 and RFC 8414 documents', () => {
    const prm = protectedResourceMetadata(ORIGIN);
    expect(prm.resource).toBe(RESOURCE);
    expect(prm.authorization_servers).toEqual([ORIGIN]);
    expect(prm.scopes_supported).not.toContain('offline_access');
    const as = authServerMetadata(ORIGIN);
    expect(as.issuer).toBe(ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe('redirect URIs', () => {
  it('allows https, loopback http and native schemes only', () => {
    expect(redirectUriProblem('https://claude.ai/api/mcp/auth_callback')).toBeNull();
    expect(redirectUriProblem('http://127.0.0.1:33418/callback')).toBeNull();
    expect(redirectUriProblem('http://localhost:6274/oauth/callback')).toBeNull();
    expect(redirectUriProblem('cursor://anysphere.cursor-retrieval/oauth/user-rogue/callback')).toBeNull();
    expect(redirectUriProblem('http://evil.example/cb')).not.toBeNull();
    expect(redirectUriProblem('javascript:alert(1)')).not.toBeNull();
    expect(redirectUriProblem('data:text/html,hi')).not.toBeNull();
    expect(redirectUriProblem('https://a.example/cb#frag')).not.toBeNull();
    expect(redirectUriProblem('https://user:pw@a.example/cb')).not.toBeNull();
    expect(redirectUriProblem('/relative')).not.toBeNull();
  });
  it('matches exactly, except the port of a loopback http URI', () => {
    const reg = ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:1234/callback'];
    expect(redirectMatches(reg, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectMatches(reg, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectMatches(reg, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(redirectMatches(reg, 'https://CLAUDE.ai/api/mcp/auth_callback')).toBe(false);
    expect(redirectMatches(reg, 'http://127.0.0.1:5555/callback')).toBe(true);
    expect(redirectMatches(reg, 'http://127.0.0.1:5555/other')).toBe(false);
    expect(redirectMatches(reg, 'http://localhost:1234/callback')).toBe(false);
    expect(redirectMatches(reg, undefined)).toBe(false);
  });
  it('adds parameters and computes the CSP source and label', () => {
    expect(withParams('https://a.example/cb?x=1', { code: 'c', state: undefined, iss: ORIGIN })).toBe('https://a.example/cb?x=1&code=c&iss=https%3A%2F%2Frogue.test');
    expect(cspSourceFor('https://a.example/cb')).toBe('https://a.example');
    expect(cspSourceFor('cursor://anysphere/cb')).toBe('cursor:');
    expect(redirectLabel('http://127.0.0.1:5555/cb')).toBe('127.0.0.1:5555');
  });
});

describe('client registration', () => {
  it('accepts a public client and cleans its name', () => {
    const r = parseRegistration({ client_name: ' Claude\u0007 Code ', redirect_uris: ['http://localhost:9/cb', 'http://localhost:9/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
    expect(r).toEqual({ ok: true, value: { clientName: 'Claude Code', redirectUris: ['http://localhost:9/cb'] } });
    expect(parseRegistration({ redirect_uris: ['https://a.example/cb'] })).toMatchObject({ ok: true, value: { clientName: 'Unnamed app' } });
  });
  it('refuses confidential clients, other grants and bad redirect URIs', () => {
    expect(parseRegistration({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }).ok).toBe(false);
    expect(parseRegistration({ redirect_uris: ['http://evil.example/cb'] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
    expect(parseRegistration({ redirect_uris: [] }).ok).toBe(false);
    expect(parseRegistration([]).ok).toBe(false);
  });
});

describe('authorization request', () => {
  const reg = ['https://claude.ai/cb'];
  const good = { client_id: 'c1', redirect_uri: 'https://claude.ai/cb', response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's', scope: 'facts:rate', resource: RESOURCE };
  it('accepts a complete request', () => {
    expect(parseAuthorizeRequest(good, reg, RESOURCE)).toEqual({ ok: true, value: { clientId: 'c1', redirectUri: 'https://claude.ai/cb', state: 's', codeChallenge: CHALLENGE, scopes: ['facts:rate'], resource: RESOURCE } });
    expect(parseAuthorizeRequest({ ...good, resource: undefined }, reg, RESOURCE).ok).toBe(true);
  });
  it('never redirects before the client and redirect URI are known (no open redirect)', () => {
    expect(parseAuthorizeRequest(good, null, RESOURCE)).toMatchObject({ ok: false, redirect: false });
    expect(parseAuthorizeRequest({ ...good, redirect_uri: 'https://evil.example/cb' }, reg, RESOURCE)).toMatchObject({ ok: false, redirect: false });
    expect(parseAuthorizeRequest({ ...good, client_id: undefined }, reg, RESOURCE)).toMatchObject({ ok: false, redirect: false });
  });
  it('sends other errors back to the client', () => {
    expect(parseAuthorizeRequest({ ...good, code_challenge_method: 'plain' }, reg, RESOURCE)).toMatchObject({ ok: false, redirect: true, error: 'invalid_request' });
    expect(parseAuthorizeRequest({ ...good, code_challenge: undefined }, reg, RESOURCE)).toMatchObject({ ok: false, redirect: true });
    expect(parseAuthorizeRequest({ ...good, response_type: 'token' }, reg, RESOURCE)).toMatchObject({ ok: false, error: 'unsupported_response_type' });
    expect(parseAuthorizeRequest({ ...good, scope: 'admin' }, reg, RESOURCE)).toMatchObject({ ok: false, error: 'invalid_scope' });
    expect(parseAuthorizeRequest({ ...good, resource: 'https://other.example/mcp' }, reg, RESOURCE)).toMatchObject({ ok: false, error: 'invalid_target' });
  });
  it('keeps only known query keys', () => {
    const q = new URLSearchParams({ client_id: 'c', evil: 'x', state: 's' });
    expect(pickAuthorizeParams((k) => q.get(k))).toEqual({ client_id: 'c', state: 's' });
  });
});
