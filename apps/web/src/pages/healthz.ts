import type { APIRoute } from 'astro';
import { buildHealth } from '@rogue/core';
import { VERSION } from '../lib/version';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildHealth('web', VERSION)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
