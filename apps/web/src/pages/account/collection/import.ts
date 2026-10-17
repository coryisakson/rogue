import type { APIRoute } from 'astro';
import { fetchBggCollection } from '../../../lib/bgg';
import { backToCollection, cachedApiCollection, collectionPostGuard, getBggUsername, saveCollection } from '../../../lib/collection';

/** POST: import the saved username's owned games from the BGG API (needs ROGUE_BGG_TOKEN). Reuses a fresh cached import. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = collectionPostGuard(request, locals.user);
  if (user instanceof Response) return user;
  const username = await getBggUsername(user.id);
  if (!username) return backToCollection('need-username');
  const cached = await cachedApiCollection(username);
  if (cached) {
    await saveCollection(user.id, { username, source: 'api', items: cached.items, fetchedAt: cached.fetchedAt });
    return backToCollection('imported-cached', cached.items.length);
  }
  const r = await fetchBggCollection(username, user.id);
  switch (r.kind) {
    case 'items':
      // Zero owned games usually means a misspelt name or a private collection: say so instead of storing nothing.
      if (!r.items.length) return backToCollection('api-empty');
      await saveCollection(user.id, { username, source: 'api', items: r.items });
      return backToCollection('imported', r.items.length);
    case 'bad-username': return backToCollection('api-bad-username');
    case 'queued': return backToCollection('api-queued');
    case 'rate-limited': return backToCollection('api-rate-limited');
    case 'no-token': return backToCollection('api-no-token');
    case 'error': return backToCollection('api-error');
  }
};
