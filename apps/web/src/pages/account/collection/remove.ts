import type { APIRoute } from 'astro';
import { backToCollection, collectionPostGuard, deleteCollection } from '../../../lib/collection';

/** POST: forget the imported collection (the username stays until cleared). */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = collectionPostGuard(request, locals.user);
  if (user instanceof Response) return user;
  await deleteCollection(user.id);
  return backToCollection('removed');
};
