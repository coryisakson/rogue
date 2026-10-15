import type { APIRoute } from 'astro';
import { PROVIDERS, buildAuthUrl, isProviderId, randomToken, safeNext } from '@rogue/core';
import { baseUrl, configuredProviders, setCookie, userFromRequest } from '../../lib/auth';

/** Step 1: remember a random state (+ where to go afterwards) in a short-lived cookie, send the user to the provider. */
export const GET: APIRoute = async ({ params, request, url }) => {
  // ?link=1 only counts for a signed-in user: the callback then attaches the provider to that account instead of signing in.
  const link = url.searchParams.get('link') === '1' && !!(await userFromRequest(request));
  const id = params['provider'] ?? '';
  const creds = isProviderId(id) ? configuredProviders()[id] : undefined;
  if (!isProviderId(id) || !creds) return new Response('Not found', { status: 404 });
  const state = randomToken(24);
  const next = safeNext(url.searchParams.get('next'));
  const headers = new Headers({ location: buildAuthUrl(PROVIDERS[id], creds.id, `${baseUrl(request)}/auth/${id}/callback`, state), 'cache-control': 'no-store' });
  headers.append('set-cookie', setCookie('rogue_oauth', JSON.stringify({ state, next, link }), 600));
  return new Response(null, { status: 302, headers });
};
