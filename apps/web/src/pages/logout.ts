import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { SESSION_COOKIE, endSession, setCookie } from '../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  await endSession(request);
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie(SESSION_COOKIE, '', 0), 'cache-control': 'no-store' } });
};
