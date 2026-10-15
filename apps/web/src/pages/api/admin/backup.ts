import type { APIRoute } from 'astro';
import { getBackupState, runBackup, runRestoreTest } from '../../../lib/backup-runner';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Admin only (the whole app is private behind Olares auth until real accounts land: see roadmap). */
export const GET: APIRoute = () => json(getBackupState());

export const POST: APIRoute = async ({ url }) => {
  const action = url.searchParams.get('action');
  if (action === 'backup') return json(await runBackup());
  if (action === 'restore-test') return json(await runRestoreTest());
  return json({ error: 'use ?action=backup or ?action=restore-test' }, 400);
};
