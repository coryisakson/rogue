import type { APIRoute } from 'astro';
import { parseExtractDeleteForm, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { deleteExtract } from '../../lib/extract-delete';
import { sourceInGame, deleteSource } from '../../lib/source-delete';

/**
 * POST from /admin/games/<slug>/extracts: delete a source's extract, or one page's chunks (lib/extract-delete.ts). The
 * source itself stays. Admin session + same-origin only; the form must repeat the source id and tick the confirm box.
 * Redirects back with numbers or an error code only, so nothing typed by a user is reflected through the URL.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = Object.fromEntries((await request.formData()).entries());
  const game = typeof form['game'] === 'string' && /^[a-z0-9-]{1,80}$/.test(form['game']) ? form['game'] : '';
  const back = (q: Record<string, string | number>) => new Response(null, {
    status: 303,
    headers: {
      location: game ? `/admin/games/${encodeURIComponent(game)}/extracts?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}` : '/admin/games',
      'cache-control': 'no-store',
    },
  });
  const p = parseExtractDeleteForm(form);
  const id = typeof form['source'] === 'string' && /^[1-9][0-9]{0,15}$/.test(form['source']) ? form['source'] : '';
  const page = typeof form['page'] === 'string' && /^[1-9][0-9]{0,3}$/.test(form['page']) ? form['page'] : '';
  if (!p.ok) return back({ ...(id ? { delete: id } : {}), ...(page ? { delpage: page } : {}), err: p.code });
  if (!(await sourceInGame(p.value.game, p.value.sourceId))) return back({ err: 'missing' });
  // Whole-extract delete removes the data source itself (Cory 2026-10-18); replacement is the separate Replace action.
  // Only a single page's chunks stay a partial delete. URL is tombstoned unless "allow re-ingest" is ticked.
  if (p.value.page === null) {
    const d = await deleteSource(p.value.sourceId, `admin:${locals.user.id}`, p.value.reason, form['reingest'] === 'yes');
    if (d === null) return back({ err: 'missing' });
    return back({ removed: d.id, chunks: d.chunks, claims: d.claimsRejected, tombstoned: d.tombstoned ? 1 : 0 });
  }
  const r = await deleteExtract(p.value.sourceId, p.value.page, `admin:${locals.user.id}`, p.value.reason);
  if (r === null) return back({ err: 'missing' });
  if (r === 'nothing') return back({ err: 'nothing' });
  return back({ deleted: r.id, chunks: r.chunks, ...(r.page ? { page: r.page } : {}), quality: r.pageQuality, overrides: r.overrides, variants: r.variants });
};
