import type { APIRoute } from 'astro';
import { parseRegistration } from '@rogue/core';
import { clientIp } from '../../lib/mcp';
import { notFound, oauthEnabled, oauthError, oauthJson, oauthLimits, preflight, registerClient } from '../../lib/oauth';

/** RFC 7591 dynamic client registration: public clients only (no secret), PKCE required later. ADR 0004. */
export const POST: APIRoute = async ({ request }) => {
  if (!oauthEnabled()) return notFound();
  if (!oauthLimits.register.allow(clientIp(request))) return oauthError('slow_down', 'too many registrations; retry later', 429);
  let body: unknown;
  try { body = JSON.parse((await request.text()).slice(0, 16_384)); } catch { return oauthError('invalid_client_metadata', 'body must be JSON'); }
  const p = parseRegistration(body);
  if (!p.ok) return oauthError(p.error, p.description);
  const c = await registerClient(p.value);
  return oauthJson({
    client_id: c.clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: c.clientName,
    redirect_uris: c.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201);
};
export const OPTIONS: APIRoute = () => preflight();
