import type { APIRoute } from 'astro';
import { ensureMigrated, getPool, getAi, services } from '../lib/services';

/** Readiness (not liveness): reports dependency state. /healthz stays dependency-free so the pod is never restarted for a DB blip. */
export const GET: APIRoute = async () => {
  const checks: Record<string, string> = {};
  const pool = getPool();
  if (!pool) checks['database'] = 'not_configured';
  else {
    try {
      await ensureMigrated();
      await pool.query('SELECT 1');
      checks['database'] = 'ok';
    } catch (e) {
      checks['database'] = `error: ${(e as Error).message.slice(0, 120)}`;
    }
  }
  checks['ai'] = getAi() ? 'configured' : 'not_configured';
  checks['dataDir'] = services.dataDir;
  const ok = checks['database'] === 'ok' || checks['database'] === 'not_configured';
  return new Response(JSON.stringify({ status: ok ? 'ready' : 'not_ready', checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
