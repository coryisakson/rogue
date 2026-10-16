/** Fixed-window per-key rate limiter. In-memory, per process (one container); fine for a single instance. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}
  /** Returns true if the request is allowed. */
  allow(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset <= t) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset <= t) { this.hits.set(key, { n: 1, reset: t + this.windowMs }); return true; }
    h.n++;
    return h.n <= this.limit;
  }
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Only the web front end is public: HTML pages, static assets and health probes.
 * Everything else (/api/*, /mcp, ...) is backend and requires the admin token, even when the entrance is public.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/about' || pathname === '/games' || pathname === '/healthz' || pathname === '/favicon.ico' || pathname === '/favicon.svg' || pathname === '/robots.txt') return true;
  if (pathname.startsWith('/_astro/')) return true;
  if (/^\/agent\/mcp\/[a-z-]+$/.test(pathname)) return true; // Nanobot sidecar: verified by the x-rogue-agent header in the handler, else 404
  if (pathname === '/discord/interactions') return true; // Ed25519-verified in the handler; 404 unless Discord env is set
  if (pathname === '/api/ask') return true; // rules chat JSON for the game-page thread: same-origin + sign-in checked in the handler
  if (/^\/games\/[a-z0-9-]+(\/setup|\/aid|\/ask|\/faq|\/facts)?\/?$/.test(pathname)) return true;
  if (pathname === '/admin' || pathname === '/admin/run' || pathname === '/admin/review' || pathname === '/admin/faq-decide' || pathname === '/admin/quality-decide' || /^\/admin\/(claims|backups|review-log|users|approvals|design|requests|faq|quality|extracts)\/?$/.test(pathname)) return true; // pages guard themselves: admin session, else 404
  if (pathname === '/login' || pathname === '/logout' || pathname === '/rate' || pathname === '/rate-answer' || pathname === '/request-game' || pathname === '/account' || pathname === '/account/delete' || /^\/auth\/[a-z]+(\/callback)?\/?$/.test(pathname)) return true;
  return false;
}

/** Public routes that cost compute (database/AI): limited per client IP. */
export function isCostlyPath(pathname: string): boolean {
  return pathname.startsWith('/games/');
}

/** The AI-backed ask is stricter: it runs retrieval, a reranker and an answer model per request (game page or old /ask with ?q=). */
export function isChatPath(pathname: string): boolean {
  return /^\/games\/[a-z0-9-]+(\/ask)?\/?$/.test(pathname);
}
