import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { SESSION_COOKIE, setCookie } from '../../lib/auth';
import { ensureMigrated, getPool } from '../../lib/services';

/** POST confirm=yes. Deletes the user; sessions and ratings go with them through ON DELETE CASCADE. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const user = locals.user;
  if (!user) return new Response(null, { status: 303, headers: { location: '/login?next=/account' } });
  const form = await request.formData();
  if (form.get('confirm') !== 'yes') return new Response('Confirmation missing', { status: 400 });
  const pool = getPool();
  if (!pool) return new Response('Unavailable', { status: 503 });
  await ensureMigrated();
  await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
  return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie(SESSION_COOKIE, '', 0), 'cache-control': 'no-store' } });
};
