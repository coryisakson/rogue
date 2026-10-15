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

/** Paths that mutate or expose internals; need the admin token even when the entrance is public. */
export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/api/admin') || pathname === '/api/ai-ping';
}

/** Public routes that cost compute (embeddings, LLM): limited per client IP. */
export function isCostlyPath(pathname: string): boolean {
  return pathname === '/mcp' || pathname.startsWith('/api/rules') || pathname === '/api/search';
}
