import { createHash } from 'node:crypto';
import { POLICY_VERSION, USER_AGENT, findOptOut, parseRobots, robotsAllows, type FetchDecision } from './policy.js';

export interface FetchedDocument {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
  lastModified: string | null;
  etag: string | null;
  fetchedAt: string;
  decision: FetchDecision;
}

export interface FetcherOptions {
  fetchImpl?: typeof fetch;
  /** Only these hosts may be fetched at all (the Scout proposes, the allowlist disposes). */
  allowedHosts: string[];
  maxBytes?: number; // default 25 MB
  minDelayMs?: number; // per-host politeness delay
}

const deny = (reason: string): FetchDecision => ({ allowed: false, reason, policyVersion: POLICY_VERSION });

/** Rights-gated fetcher: allowlist -> robots.txt -> request -> opt-out headers -> size cap -> hash. */
export class RightsGatedFetcher {
  private readonly f: typeof fetch;
  private readonly lastHit = new Map<string, number>();
  private readonly robotsCache = new Map<string, ReturnType<typeof parseRobots>>();

  constructor(private readonly o: FetcherOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private async wait(host: string): Promise<void> {
    const gap = this.o.minDelayMs ?? 2000;
    const last = this.lastHit.get(host) ?? 0;
    const delay = last + gap - Date.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    this.lastHit.set(host, Date.now());
  }

  private async robotsFor(url: URL) {
    const cached = this.robotsCache.get(url.host);
    if (cached) return cached;
    let rules = { disallow: [] as string[], allow: [] as string[] };
    try {
      await this.wait(url.host);
      const res = await this.f(`${url.protocol}//${url.host}/robots.txt`, { headers: { 'user-agent': USER_AGENT } });
      if (res.ok) rules = parseRobots(await res.text());
      // 4xx = no robots file = allowed. 5xx = unknown: be conservative and block.
      else if (res.status >= 500) rules = { disallow: ['/'], allow: [] };
    } catch {
      rules = { disallow: ['/'], allow: [] };
    }
    this.robotsCache.set(url.host, rules);
    return rules;
  }

  /** Check without downloading the body. */
  async check(rawUrl: string): Promise<FetchDecision> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return deny('invalid url');
    }
    if (url.protocol !== 'https:') return deny('only https is fetched');
    if (!this.o.allowedHosts.includes(url.host)) return deny(`host ${url.host} is not on the allowlist`);
    const rules = await this.robotsFor(url);
    if (!robotsAllows(rules, url.pathname + url.search)) return deny('blocked by robots.txt');
    return { allowed: true, reason: 'ok', policyVersion: POLICY_VERSION };
  }

  async fetch(rawUrl: string): Promise<FetchedDocument> {
    const decision = await this.check(rawUrl);
    if (!decision.allowed) throw new FetchDenied(rawUrl, decision);
    const url = new URL(rawUrl);
    await this.wait(url.host);
    const res = await this.f(rawUrl, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    if (!res.ok) throw new FetchHttpError(rawUrl, res.status);
    const finalUrl = res.url || rawUrl;
    if (new URL(finalUrl).host !== url.host && !this.o.allowedHosts.includes(new URL(finalUrl).host))
      throw new FetchDenied(rawUrl, deny(`redirected to non-allowlisted host ${new URL(finalUrl).host}`));
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > (this.o.maxBytes ?? 25_000_000)) throw new FetchDenied(rawUrl, deny('over size cap'));
    const contentType = headers['content-type'] ?? 'application/octet-stream';
    const head = contentType.includes('html') ? new TextDecoder().decode(bytes.slice(0, 20000)) : '';
    const optOut = findOptOut(headers, head);
    if (optOut) throw new FetchDenied(rawUrl, deny(`rights holder opt-out: ${optOut}`));
    return {
      url: rawUrl,
      finalUrl,
      status: res.status,
      contentType,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      lastModified: headers['last-modified'] ?? null,
      etag: headers['etag'] ?? null,
      fetchedAt: new Date().toISOString(),
      decision: { allowed: true, reason: 'ok', policyVersion: POLICY_VERSION },
    };
  }
}

export class FetchDenied extends Error {
  constructor(
    readonly url: string,
    readonly decision: FetchDecision,
  ) {
    super(`fetch denied for ${url}: ${decision.reason} (policy ${decision.policyVersion})`);
  }
}

export class FetchHttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`fetch ${url} failed: HTTP ${status}`);
  }
  /** 404/410 mean the file is gone; anything else is treated as transient. */
  get gone(): boolean {
    return this.status === 404 || this.status === 410;
  }
}
