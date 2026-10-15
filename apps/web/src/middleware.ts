import { defineMiddleware } from 'astro:middleware';
import { isChatPath, isCostlyPath, isPublicPath, RateLimiter, safeEqual } from '@rogue/core';
import { startBackupScheduler } from './lib/backup-runner';
import { adminToken } from './lib/admin-token';
import { userFromRequest } from './lib/auth';

const chat = new RateLimiter(Number(process.env['ROGUE_CHAT_RATE_LIMIT'] ?? 8), 60_000);
const costly = new RateLimiter(Number(process.env['ROGUE_RATE_LIMIT'] ?? 40), 60_000);

const clientIp = (req: Request) => (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
const deny = (status: number, msg: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

// Starts background jobs once per server process (idempotent). Also guards admin routes and rate-limits costly public ones,
// because the entrance may be public (no Olares login in front).
export const onRequest = defineMiddleware(async (ctx, next) => {
  startBackupScheduler();
  const { pathname } = new URL(ctx.request.url);

  if (!isPublicPath(pathname)) {
    // Backend surface (APIs, MCP, admin). Not exposed publicly: needs the token. 404 on purpose, do not advertise routes.
    const given = ctx.request.headers.get('x-rogue-admin') ?? '';
    if (!safeEqual(given, adminToken())) return deny(404, 'not found');
  } else if (isChatPath(pathname) && new URL(ctx.request.url).searchParams.has('q') && !chat.allow(clientIp(ctx.request))) {
    return deny(429, 'too many questions; retry in a minute', { 'retry-after': '60' });
  } else if (isCostlyPath(pathname) && !costly.allow(clientIp(ctx.request))) {
    return deny(429, 'rate limit exceeded; retry in a minute', { 'retry-after': '60' });
  }

  ctx.locals.user = !pathname.startsWith('/_astro/') && ctx.request.headers.has('cookie') ? await userFromRequest(ctx.request) : null;
  const res = await next();
  const h = res.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('x-frame-options', 'SAMEORIGIN');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (!h.has('content-security-policy') && (h.get('content-type') ?? '').includes('text/html'))
    h.set('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  return res;
});
