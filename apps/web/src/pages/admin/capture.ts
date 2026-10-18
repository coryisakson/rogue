import type { APIRoute } from 'astro';
import { CAPTURE_MAX_CHARS, CAPTURE_MAX_FILE_BYTES, parseCaptureForm, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { auditCapturedGame, gameForCapture, undoCapturedGame } from '../../lib/game-sources';
import { captureSource, readCapture } from '../../lib/source-capture';

/**
 * POST from the "Capture from browser" form on /admin/games/<slug>/sources, from /admin/capture-inbox (bookmarklet) or from
 * "Capture new game" on /admin/requests. Stores text an admin captured in their own browser as a source marked manual
 * capture (lib/source-capture.ts). With "Add as new game" (target=new, newGame=name) the game is created first, directly as
 * an admin-approved game (game-sources.ts gameForCapture), or the game already in Rogue is used. Admin session +
 * same-origin only. Redirects back with numbers or an error code only, so nothing typed is reflected in the URL.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  // Refuse an oversized body before reading it: the largest file plus the largest paste (UTF-8, form encoding) and some fields.
  if (Number(h.get('content-length') ?? 0) > CAPTURE_MAX_FILE_BYTES + CAPTURE_MAX_CHARS * 4 + 64 * 1024) return new Response(null, { status: 303, headers: { location: '/admin/capture-inbox?capture_err=toolarge' } });
  const data = await request.formData();
  const form: Record<string, string> = {};
  for (const [k, v] of data.entries()) if (typeof v === 'string') form[k] = v;
  const upload = data.get('file');
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  // The game of the page the form came from (a sources page), for the way back after a refusal.
  const game = /^[a-z0-9-]{1,80}$/.test(form['game'] ?? '') ? form['game']! : '';
  const sourcesOf = (slug: string) => `/admin/games/${encodeURIComponent(slug)}/sources`;
  const go = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
  const fail = (code: string) => go(
    form['from'] === 'requests' ? `/admin/requests?capture_err=${code}#capture`
      : form['from'] === 'inbox' || !game ? `/admin/capture-inbox?capture_err=${code}`
        : `${sourcesOf(game)}?capture_err=${code}#capture`);

  const p = parseCaptureForm(form);
  if (!p.ok) return fail(p.code);
  const text = await readCapture(form['text'] ?? '', file);
  if (!text.ok) return fail(text.code);
  const ng = p.value.newGame;
  let created = false;
  if (ng) {
    const g = await gameForCapture(ng);
    if ('error' in g) return fail('newgame');
    p.value.game = g.slug;
    created = g.created;
  }
  const r = await captureSource(p.value, text.value, locals.user.id);
  if (!r.ok) {
    // Every refusal (tombstone, another game's link, a fetched source) comes before anything is stored: drop the new game.
    if (created) await undoCapturedGame(p.value.game);
    return fail(r.code);
  }
  if (created && ng) await auditCapturedGame(locals.user.id, p.value.game, ng.name, ng.bggId, r.sourceId);
  const done = new URLSearchParams({ captured: String(r.sourceId), chars: String(r.chars), pages: String(r.pages) });
  if (r.recapture) done.set('recapture', 'yes');
  if (ng) done.set('newgame', created ? 'created' : 'existing');
  return go(`${sourcesOf(p.value.game)}?${done}#capture`);
};
