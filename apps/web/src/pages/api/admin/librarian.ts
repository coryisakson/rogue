import type { APIRoute } from 'astro';
import { librarianStatus, runLibrarian } from '../../../lib/librarian-run';

/** POST /api/admin/librarian?game=pandemic starts a background run; GET returns progress. */
export const POST: APIRoute = async ({ url }) => {
  const game = url.searchParams.get('game') ?? '';
  if (!/^[a-z0-9-]+$/.test(game)) return Response.json({ error: 'use ?game=<slug>' }, { status: 400 });
  if (librarianStatus()?.running) return Response.json({ started: false, status: librarianStatus() }, { status: 409 });
  void runLibrarian(game);
  return Response.json({ started: true });
};
export const GET: APIRoute = async () => Response.json(librarianStatus() ?? { running: false }, { headers: { 'cache-control': 'no-store' } });
