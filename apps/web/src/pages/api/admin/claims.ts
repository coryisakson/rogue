import type { APIRoute } from 'astro';
import { dedupeClaims, rejectClaims } from '../../../lib/claims-admin';

const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

/**
 * POST ?action=reject&ids=1,2|created_by=librarian&reason=...[&dry=1]
 * POST ?action=dedupe&game=pandemic[&dry=1]      (dry run is the default: add &dry=0 to apply)
 */
export const POST: APIRoute = async ({ url }) => {
  const q = url.searchParams; const dry = q.get('dry') !== '0';
  try {
    if (q.get('action') === 'reject') {
      const o: Parameters<typeof rejectClaims>[0] = { reason: q.get('reason') ?? 'admin', dry };
      const ids = q.get('ids'); if (ids) o.ids = ids.split(',').map(Number).filter(Number.isInteger);
      const cb = q.get('created_by'); if (cb) o.createdBy = cb;
      return json(await rejectClaims(o));
    }
    if (q.get('action') === 'dedupe') return json(await dedupeClaims(q.get('game') ?? '', dry));
    return json({ error: 'action=reject|dedupe' }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
};
