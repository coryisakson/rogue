import type { APIRoute } from 'astro';
import { checkBggUsername } from '@rogue/core';
import { backToCollection, collectionPostGuard, setBggUsername } from '../../../lib/collection';

/** POST username=... saves or fixes the BGG username; clear=1 removes it. Typed, not verified (BGG has no login). */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = collectionPostGuard(request, locals.user);
  if (user instanceof Response) return user;
  const form = await request.formData();
  if (form.get('clear') === '1') {
    await setBggUsername(user.id, null);
    return backToCollection('username-cleared');
  }
  const check = checkBggUsername(String(form.get('username') ?? ''));
  if (!check.ok) return backToCollection(`username-${check.reason}`);
  await setBggUsername(user.id, check.username);
  return backToCollection('username-saved');
};
