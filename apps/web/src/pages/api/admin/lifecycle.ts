import type { APIRoute } from 'astro';
import { recheckAll, recheckSource, takedown } from '../../../lib/lifecycle';

const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { 'cache-control': 'no-store' } });

/**
 * Admin only (private Olares entrance for now).
 *   POST ?action=recheck[&source=ID]
 *   POST ?action=takedown&url=...|game=slug&requester=...&reason=...[&dry=1]
 */
export const POST: APIRoute = async ({ url }) => {
  const q = url.searchParams;
  try {
    if (q.get('action') === 'recheck') return json(q.get('source') ? await recheckSource(Number(q.get('source'))) : await recheckAll());
    if (q.get('action') === 'takedown') {
      const input = { requester: q.get('requester') ?? 'unknown', dryRun: q.get('dry') === '1' } as Parameters<typeof takedown>[0];
      const u = q.get('url'), g = q.get('game'), r = q.get('reason');
      if (u) input.url = u;
      if (g) input.game = g;
      if (r) input.reason = r;
      return json(await takedown(input));
    }
    return json({ error: 'action=recheck|takedown' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
