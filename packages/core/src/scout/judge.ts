/**
 * Scout page judgement, pure gates (ADR 0002). The Nanobot Scout agent (job kind scout_judge) reads the candidate links the
 * code found on the publisher page and PROPOSES which ones are this game's official rulebook, FAQ or errata. Code decides here:
 * the address must be one the code listed or on the publisher page's own site, robots must allow it, and anything on a site
 * no one has approved yet is needs_human. A pick is advice for the Rights Officer and the admin; nothing is ingested from it.
 */
import { hostProblem } from '../addgame/index.js';
import { isAggregator } from '../intake/index.js';
import { registrableDomain } from '../terms/index.js';

export const SOURCE_ROLES = ['rulebook', 'faq', 'errata'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export type PickStatus = 'accepted' | 'needs_human' | 'rejected';

export interface SourcePick { url: string; role: string; reason: string; status: PickStatus; why: string }

export interface PickContext {
  /** URLs the code listed for this request (the scout report's candidates). */
  candidates: readonly string[];
  /** The publisher page the candidates came from; same-site addresses may be proposed even when not listed. */
  publisherPage: string | null;
  /** Hosts already approved for ingest (allowlist plus admin-approved hosts). */
  approvedHosts: readonly string[];
  /** robots.txt verdict for the proposed URL, checked by the web app before calling this. */
  robots: 'allowed' | 'blocked' | 'unknown';
}

const sameSite = (a: string, b: string): boolean => registrableDomain(a) === registrableDomain(b);

/** Decide one proposal. Order matters: malformed and foreign addresses are rejected before the host approval question. */
export function judgeSourcePick(input: { url: unknown; role: unknown; reason: unknown }, ctx: PickContext): SourcePick {
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const role = typeof input.role === 'string' ? input.role.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const out = (status: PickStatus, why: string): SourcePick => ({ url, role, reason, status, why });
  let u: URL;
  try { u = new URL(url); } catch { return out('rejected', 'not a valid address'); }
  const problem = hostProblem(u);
  if (problem) return out('rejected', problem);
  if (!(SOURCE_ROLES as readonly string[]).includes(role)) return out('rejected', `role must be one of ${SOURCE_ROLES.join(', ')}`);
  if (!reason) return out('rejected', 'a reason is required');
  if (isAggregator(u.hostname)) return out('rejected', 'third-party copy site; only the publisher is a source');
  const listed = ctx.candidates.includes(url);
  let onPublisherSite = false;
  if (ctx.publisherPage) { try { onPublisherSite = sameSite(new URL(ctx.publisherPage).hostname, u.hostname); } catch { /* bad page url: not same site */ } }
  if (!listed && !onPublisherSite) return out('rejected', 'not a listed candidate and not on the publisher page\'s site');
  if (ctx.robots === 'blocked') return out('rejected', 'robots.txt does not allow Rogue to read it');
  if (!ctx.approvedHosts.includes(u.host)) return out('needs_human', 'the site is not approved yet; an admin must read its terms and approve it');
  if (ctx.robots !== 'allowed') return out('needs_human', 'robots.txt could not be checked');
  return out('accepted', 'listed or same publisher site, approved host, robots allow');
}

/** The agent may re-propose a URL; the last decision per URL counts. Order of first appearance is kept. */
export function latestPicks(picks: readonly SourcePick[]): SourcePick[] {
  const byUrl = new Map<string, SourcePick>();
  for (const p of picks) { byUrl.delete(p.url); byUrl.set(p.url, p); }
  return [...byUrl.values()];
}

/** Plain notes for the scout report (shown on /admin/requests) once a scout_judge job ended. */
export function scoutJudgementNotes(picks: readonly SourcePick[], jobStatus: string, requestedRulebook: string | null): string[] {
  const kept = latestPicks(picks).filter((p) => p.status !== 'rejected');
  if (jobStatus === 'failed') return ['The Scout agent could not judge the candidates (job failed); the code ranking above stands.'];
  if (!kept.length) return ['The Scout agent found no official rulebook, FAQ or errata among the candidates; the code ranking above stands.'];
  const notes = kept.map((p) => `Scout agent: ${p.role} ${p.url} (${p.status === 'accepted' ? 'approved site' : 'needs you: ' + p.why}). ${p.reason}`);
  const rulebooks = kept.filter((p) => p.role === 'rulebook');
  if (requestedRulebook && rulebooks.length && !rulebooks.some((p) => p.url === requestedRulebook)) notes.push('The Scout agent picked a different rulebook than the requested link; check which one is official.');
  if (jobStatus === 'needs_human') notes.push('The Scout agent asked for a person to look at this request.');
  return notes;
}
