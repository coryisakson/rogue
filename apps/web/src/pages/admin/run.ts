import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { runBackup, runRestoreTest } from '../../lib/backup-runner';

/** POST action=backup|restore-test from the Backups page. Admin session + same-origin only. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const action = String((await request.formData()).get('action'));
  if (action === 'backup') await runBackup(); else if (action === 'restore-test') await runRestoreTest(); else return new Response('Bad request', { status: 400 });
  return new Response(null, { status: 303, headers: { location: `/admin/backups?done=${action}`, 'cache-control': 'no-store' } });
};
