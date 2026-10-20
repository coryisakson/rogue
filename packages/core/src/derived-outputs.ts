import { createHash } from 'node:crypto';
import { planClaimRejections, type ClaimCitation } from './source-delete.js';

/**
 * Derived outputs (docs/DERIVED_OUTPUTS.md, ADR 0008): the setup one-pager and the player aid are built from a game's
 * published claims, which come from its sources. The "basis" is what they were built from; its hash decides the version.
 * Old versions are not kept (Cory 2026-10-19): one row per game, overwritten in place. The database work lives in
 * apps/web/src/lib/derived-outputs.ts.
 */

export interface BasisSource { sourceId: number; contentHash: string | null }
export interface OutputBasis { sources: BasisSource[]; claimIds: number[]; claims: number }

/** Sorted and without duplicates, so the same sources and claims always give the same basis (and hash). */
export function buildBasis(sources: BasisSource[], claimIds: number[]): OutputBasis {
  const bySource = new Map<number, string | null>();
  for (const s of sources) bySource.set(s.sourceId, s.contentHash ?? null);
  const ids = [...new Set(claimIds)].sort((a, b) => a - b);
  return {
    sources: [...bySource.entries()].sort((a, b) => a[0] - b[0]).map(([sourceId, contentHash]) => ({ sourceId, contentHash })),
    claimIds: ids,
    claims: ids.length,
  };
}

/** sha256 (hex) of the basis in a fixed key order. */
export function basisHash(b: OutputBasis): string {
  const canonical = JSON.stringify({
    sources: b.sources.map((s) => [s.sourceId, s.contentHash ?? null]),
    claimIds: b.claimIds,
    claims: b.claims,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export type VersionStep = { action: 'create'; version: 1 } | { action: 'same'; version: number } | { action: 'bump'; version: number };

/** The version rule: a new game starts at 1; the version goes up by one only when the basis hash changed. */
export function nextVersion(current: { version: number; basisHash: string } | null, hash: string): VersionStep {
  if (!current) return { action: 'create', version: 1 };
  if (current.basisHash === hash) return { action: 'same', version: current.version };
  return { action: 'bump', version: current.version + 1 };
}

/** Values for the footer stamp "v<N> · <date> · <k> sources" (i18n key outputs.stamp); the date is YYYY-MM-DD (UTC). */
export function stampParams(o: { version: number; builtAt: Date | string; sources: number }): { n: number; date: string; k: number } {
  const d = o.builtAt instanceof Date ? o.builtAt : new Date(o.builtAt);
  return { n: o.version, date: Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10), k: o.sources };
}

/** A citation of a claim with whether the cited source is still available (not retired, deleted or gone). */
export interface AvailableCitation extends ClaimCitation { available: boolean }

/**
 * When a source is retired, replaced or deleted: claims whose only available evidence is that source are superseded
 * (sheets stop using them; the row stays); claims that also cite another available source stay. Same rule as the
 * source delete (planClaimRejections), counting only available other sources as evidence.
 */
export function planSupersede(citations: AvailableCitation[], sourceId: number): { supersede: number[]; keep: number[] } {
  const usable = citations.filter((c) => c.sourceId === sourceId || c.available);
  const p = planClaimRejections(usable, sourceId);
  return { supersede: p.reject, keep: p.keep };
}
