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

/**
 * Per-key counter that resets at UTC midnight (daily chat budget). In-memory like RateLimiter: a restart forgives the day,
 * which is acceptable for a single small instance. `count` reads without spending; `add` spends one.
 */
export class DailyCounter {
  private counts = new Map<string, { day: string; n: number }>();
  constructor(private now: () => number = Date.now) {}
  private today(): string { return new Date(this.now()).toISOString().slice(0, 10); }
  count(key: string): number {
    const c = this.counts.get(key);
    return c && c.day === this.today() ? c.n : 0;
  }
  add(key: string): number {
    const day = this.today();
    if (this.counts.size > 5000) for (const [k, v] of this.counts) if (v.day !== day) this.counts.delete(k);
    const n = this.count(key) + 1;
    this.counts.set(key, { day, n });
    return n;
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
 * Everything else (/api/*, ...) is backend and requires the admin token, even when the entrance is public.
 * Exception: the read-only public MCP endpoint, which rate-limits and caps requests itself (pages/mcp.ts).
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/about' || pathname === '/accessibility' || pathname === '/games' || pathname === '/healthz' || pathname === '/favicon.ico' || pathname === '/favicon.svg' || pathname === '/favicon-32.png' || pathname === '/icon.svg' || pathname === '/icon.png' || pathname === '/icon-256.png' || pathname === '/apple-touch-icon.png' || pathname === '/robots.txt') return true;
  if (pathname.startsWith('/_astro/')) return true;
  if (/^\/agent\/mcp\/[a-z-]+$/.test(pathname)) return true; // Nanobot sidecar: verified by the x-rogue-agent header in the handler, else 404
  if (pathname === '/mcp' || pathname === '/mcp/server-card' || pathname === '/docs/mcp') return true; // public read-only MCP + its card and docs page
  // MCP OAuth (ADR 0004): metadata, registration, consent, token, revoke, connected apps. Each answers 404 unless ROGUE_MCP_OAUTH=1.
  if (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp' || pathname === '/.well-known/oauth-authorization-server') return true;
  if (/^\/oauth\/(register|authorize|token|revoke|apps)$/.test(pathname)) return true;
  if (pathname === '/discord/interactions') return true; // Ed25519-verified in the handler; 404 unless Discord env is set
  if (pathname === '/api/ask') return true; // rules chat JSON for the game-page thread: same-origin + sign-in checked in the handler
  if (/^\/games\/[a-z0-9-]+(\/setup|\/aid|\/ask|\/faq|\/facts)?\/?$/.test(pathname)) return true;
  if (pathname === '/admin' || pathname === '/admin/run' || pathname === '/admin/review' || pathname === '/admin/faq-decide' || pathname === '/admin/quality-decide' || pathname === '/admin/source-delete' || pathname === '/admin/game-delete' || pathname === '/admin/outputs-rebuild' || pathname === '/admin/extract-delete' || pathname === '/admin/extract-review' || pathname === '/admin/capture' || pathname === '/admin/capture-inbox' || /^\/admin\/(claims|backups|review-log|users|approvals|design|requests|sources|settings|faq|quality|extracts|games)\/?$/.test(pathname) || /^\/admin\/games\/[a-z0-9-]{1,80}(\/(sources|extracts))?\/?$/.test(pathname)) return true; // pages guard themselves: admin session, else 404
  if (pathname === '/login' || pathname === '/logout' || pathname === '/rate' || pathname === '/rate-answer' || pathname === '/request-game' || pathname === '/account' || pathname === '/account/delete' || pathname === '/account/language' || /^\/account\/collection(\/(username|upload|import|remove))?\/?$/.test(pathname) || /^\/auth\/[a-z]+(\/callback)?\/?$/.test(pathname)) return true;
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
