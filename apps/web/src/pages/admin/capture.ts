import type { APIRoute } from 'astro';
import { CAPTURE_MAX_CHARS, CAPTURE_MAX_FILE_BYTES, parseCaptureForm, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { captureSource, readCapture } from '../../lib/source-capture';

/**
 * POST from the "Capture from browser" form on /admin/games/<slug>/sources or from /admin/capture-inbox (bookmarklet).
 * Stores text an admin captured in their own browser as a source marked manual capture (lib/source-capture.ts). Admin
 * session + same-origin only. Redirects back with numbers or an error code only, so nothing typed is reflected in the URL.
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
  const game = /^[a-z0-9-]{1,80}$/.test(form['game'] ?? '') ? form['game']! : '';
  const sources = game ? `/admin/games/${encodeURIComponent(game)}/sources` : '';
  const go = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
  const fail = (code: string) => go(form['from'] === 'inbox' || !sources ? `/admin/capture-inbox?capture_err=${code}` : `${sources}?capture_err=${code}#capture`);

  const p = parseCaptureForm(form);
  if (!p.ok) return fail(p.code);
  const text = await readCapture(form['text'] ?? '', file);
  if (!text.ok) return fail(text.code);
  const r = await captureSource(p.value, text.value, locals.user.id);
  if (!r.ok) return fail(r.code);
  return go(`${sources}?${new URLSearchParams({ captured: String(r.sourceId), chars: String(r.chars), pages: String(r.pages), ...(r.recapture ? { recapture: 'yes' } : {}) })}#capture`);
};
