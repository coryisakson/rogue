import type { APIRoute } from 'astro';
import { LANG_COOKIE, isLocale, safeNext, sameOrigin } from '@rogue/core';
import { setCookie, setUserLanguage } from '../../lib/auth';

/**
 * POST lang=de&next=/games/pandemic from the language switcher (every page) or the account page. Works without JavaScript.
 * Sets the language cookie (anonymous visitors) and, when signed in, saves it on the profile; then goes back.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  const lang = String(form.get('lang') ?? '');
  const next = safeNext(String(form.get('next') ?? '/'));
  if (!isLocale(lang)) return new Response('Unknown language', { status: 400 });
  if (locals.user) await setUserLanguage(locals.user.id, lang);
  return new Response(null, { status: 303, headers: { location: next, 'set-cookie': setCookie(LANG_COOKIE, lang, 365 * 24 * 3600), 'cache-control': 'no-store' } });
};
