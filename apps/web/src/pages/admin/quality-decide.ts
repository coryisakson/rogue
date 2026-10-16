import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { applyVariant } from '../../lib/agent-tools';
import { getPool } from '../../lib/services';

/** POST from /admin/quality: approve (reads like the add-game approval: needs the terms box) or reject a text version the agent could not clear alone. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const f = await request.formData();
  const id = Number(f.get('id')); const action = String(f.get('action') ?? '');
  const pool = getPool(); if (!pool || !Number.isInteger(id) || id < 1) return new Response('Bad request', { status: 400 });
  const v = (await pool.query("SELECT source_id, url FROM text_variants WHERE id=$1 AND status='needs_human'", [id])).rows[0];
  if (!v) return new Response('Not waiting for a decision', { status: 409 });
  if (action === 'reject') {
    await pool.query("UPDATE text_variants SET status='rejected', decided_by=$2, reason=COALESCE(reason,'') || ' (rejected by an admin)' WHERE id=$1", [id, locals.user.id]);
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`admin:${locals.user.id}`, 'text_variant_rejected', { id }]);
  } else if (action === 'approve') {
    if (f.get('terms') !== '1') return new Response('Confirm that you read the site terms first.', { status: 400 });
    await applyVariant(Number(v.source_id), String(v.url), `admin:${locals.user.id}`, true, Number(locals.user.id));
  } else return new Response('Bad request', { status: 400 });
  return new Response(null, { status: 303, headers: { location: '/admin/quality', 'cache-control': 'no-store' } });
};
