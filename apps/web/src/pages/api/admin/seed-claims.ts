import type { APIRoute } from 'astro';
import { seedPandemicClaims } from '../../../lib/seed-claims';

export const POST: APIRoute = async () => {
  try {
    return Response.json(await seedPandemicClaims(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
};
