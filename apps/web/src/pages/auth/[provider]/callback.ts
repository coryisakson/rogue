import type { APIRoute } from 'astro';
import { PROVIDERS, exchangeCode, isProviderId, safeEqual, safeNext } from '@rogue/core';
import { SESSION_COOKIE, baseUrl, configuredProviders, cookieValue, linkIdentity, setCookie, upsertUserAndStartSession, userFromRequest } from '../../../lib/auth';

const fail = (why: string) => {
  console.warn('[auth] callback failed:', why);
  return new Response(null, { status: 302, headers: { location: '/login?error=1', 'set-cookie': setCookie('rogue_oauth', '', 0), 'cache-control': 'no-store' } });
};

/** Step 2: verify state from the cookie, swap the code for a profile, create a session cookie. */
export const GET: APIRoute = async ({ params, request, url }) => {
  const id = params['provider'] ?? '';
  const creds = isProviderId(id) ? configuredProviders()[id] : undefined;
  if (!isProviderId(id) || !creds) return new Response('Not found', { status: 404 });
  let saved: { state?: string; next?: string; link?: boolean } = {};
  try { saved = JSON.parse(cookieValue(request, 'rogue_oauth') ?? '{}'); } catch { /* ignore */ }
  const state = url.searchParams.get('state') ?? ''; const code = url.searchParams.get('code') ?? '';
  if (!saved.state || !code || !safeEqual(state, saved.state)) return fail('state mismatch or missing code');
  try {
    const profile = await exchangeCode(PROVIDERS[id], creds, code, `${baseUrl(request)}/auth/${id}/callback`);
    if (saved.link) {
      const me = await userFromRequest(request);
      if (!me) return fail('link requested but not signed in');
      const r = await linkIdentity(me.id, id, profile);
      const sep = safeNext(saved.next).includes('?') ? '&' : '?';
      return new Response(null, { status: 302, headers: { location: `${safeNext(saved.next)}${sep}linked=${r}`, 'set-cookie': setCookie('rogue_oauth', '', 0), 'cache-control': 'no-store' } });
    }
    const token = await upsertUserAndStartSession(id, profile);
    const headers = new Headers({ location: safeNext(saved.next), 'cache-control': 'no-store' });
    headers.append('set-cookie', setCookie(SESSION_COOKIE, token, 30 * 86400));
    headers.append('set-cookie', setCookie('rogue_oauth', '', 0));
    return new Response(null, { status: 302, headers });
  } catch (e) { return fail((e as Error).message); }
};
