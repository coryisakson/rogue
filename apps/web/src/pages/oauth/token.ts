import type { APIRoute } from 'astro';
import { canonicalResource } from '@rogue/core';
import { exchangeCode, getClient, notFound, oauthEnabled, oauthError, oauthJson, oauthLimits, preflight, readParams, refreshTokens } from '../../lib/oauth';

/** Token endpoint: authorization_code (+ PKCE) and refresh_token (rotating). Public clients identify by client_id. ADR 0004. */
export const POST: APIRoute = async ({ request }) => {
  if (!oauthEnabled()) return notFound();
  const p = await readParams(request);
  const client = await getClient(p['client_id']);
  if (!client) return oauthError('invalid_client', 'unknown client_id', 401);
  if (!oauthLimits.token.allow(client.clientId)) return oauthError('slow_down', 'too many token requests; retry in a minute', 429);
  // resource is optional here; when present it must be a valid URI (checked against the grant in lib/oauth.ts).
  const resource = p['resource'] === undefined ? null : canonicalResource(p['resource']);
  if (p['resource'] !== undefined && !resource) return oauthError('invalid_target', 'resource must be an absolute https URL');
  let r;
  if (p['grant_type'] === 'authorization_code') {
    if (!p['code'] || !p['redirect_uri'] || !p['code_verifier']) return oauthError('invalid_request', 'code, redirect_uri and code_verifier are required');
    r = await exchangeCode({ code: p['code'], clientId: client.clientId, redirectUri: p['redirect_uri'], verifier: p['code_verifier'], resource });
  } else if (p['grant_type'] === 'refresh_token') {
    if (!p['refresh_token']) return oauthError('invalid_request', 'refresh_token is required');
    r = await refreshTokens({ refreshToken: p['refresh_token'], clientId: client.clientId, scope: p['scope'] ?? null, resource });
  } else {
    return oauthError('unsupported_grant_type', 'use authorization_code or refresh_token');
  }
  return r.ok ? oauthJson(r.tokens) : oauthError(r.error, r.description);
};
export const OPTIONS: APIRoute = () => preflight();
