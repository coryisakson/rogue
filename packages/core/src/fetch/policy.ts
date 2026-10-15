/**
 * Rights gate for fetching (design plan 5a). Deterministic code, not a prompt: the Scout agent can ask for any URL,
 * but this decides whether the fetch may happen. Every decision carries the policy version so it can be logged.
 */
export const POLICY_VERSION = 'eu-2026-10-15.1';
export const USER_AGENT = 'RogueBot/0.1 (+https://github.com/coryisakson/rogue)';

export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

/** Parse robots.txt for our agent (falls back to "*"). Non-robots bodies (e.g. an HTML placeholder) mean "no rules". */
export function parseRobots(body: string, agent = 'RogueBot'): RobotsRules {
  if (/<html|<body/i.test(body)) return { disallow: [], allow: [] };
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && key === 'disallow' && value) cur.disallow.push(value);
      if (cur && key === 'allow' && value) cur.allow.push(value);
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = mine ?? star;
  return g ? { disallow: g.disallow, allow: g.allow } : { disallow: [], allow: [] };
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
}

/** Longest matching rule wins; Allow beats Disallow on ties (Google/RFC 9309 behaviour). */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const p of rules.disallow) if (matches(p, pathAndQuery) && (!best || p.length > best.len)) best = { len: p.length, allow: false };
  for (const p of rules.allow) if (matches(p, pathAndQuery) && (!best || p.length >= best.len)) best = { len: p.length, allow: true };
  return best ? best.allow : true;
}

/** TDM / AI opt-outs in response headers or HTML meta. Any hit blocks storing and learning from the content. */
export function findOptOut(headers: Record<string, string>, htmlHead = ''): string | null {
  const h = (k: string) => headers[k.toLowerCase()] ?? '';
  if (h('tdm-reservation').trim() === '1') return 'TDM-Reservation header';
  if (/noai|noimageai/i.test(h('x-robots-tag'))) return 'X-Robots-Tag noai';
  if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noai/i.test(htmlHead)) return 'meta robots noai';
  if (/<meta[^>]+name=["']tdm-reservation["'][^>]+content=["']1/i.test(htmlHead)) return 'meta tdm-reservation';
  return null;
}

export interface FetchDecision {
  allowed: boolean;
  reason: string;
  policyVersion: string;
}
