import type { APIRoute } from 'astro';
import { clientIp } from '../../lib/mcp';
import { notFound, oauthEnabled, oauthError, oauthLimits, OPEN_CORS, preflight, readParams, revokeToken } from '../../lib/oauth';

/** RFC 7009 token revocation: revokes the token's whole grant. Always 200, so it reveals nothing about tokens. ADR 0004. */
export const POST: APIRoute = async ({ request }) => {
  if (!oauthEnabled()) return notFound();
  if (!oauthLimits.revoke.allow(clientIp(request))) return oauthError('slow_down', 'too many requests; retry in a minute', 429);
  const p = await readParams(request);
  if (!p['token']) return oauthError('invalid_request', 'token is required');
  await revokeToken(p['token'], p['client_id'] ?? null);
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', ...OPEN_CORS } });
};
export const OPTIONS: APIRoute = () => preflight();
