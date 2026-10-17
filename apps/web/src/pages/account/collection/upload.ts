import type { APIRoute } from 'astro';
import { parseBggCollectionCsv } from '@rogue/core';
import { backToCollection, collectionPostGuard, getBggUsername, saveCollection } from '../../../lib/collection';

const MAX_BYTES = 2 * 1024 * 1024;

/** POST multipart file=<the CSV the user exported from their BGG collection page>. User-supplied data; works without a token. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = collectionPostGuard(request, locals.user);
  if (user instanceof Response) return user;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES + 64 * 1024) return backToCollection('csv-too-big');
  const file = (await request.formData()).get('file');
  if (!(file instanceof File) || file.size === 0) return backToCollection('csv-missing');
  if (file.size > MAX_BYTES) return backToCollection('csv-too-big');
  const parsed = parseBggCollectionCsv(await file.text());
  if (!parsed.ok) return backToCollection(`csv-${parsed.reason}`);
  // The export has no username column, so remember the saved one (if any) only for display.
  await saveCollection(user.id, { username: await getBggUsername(user.id), source: 'csv', items: parsed.items });
  return backToCollection('imported', parsed.items.length);
};
