import { describe, expect, it } from 'vitest';
import { basisHash, buildBasis, nextVersion, planSupersede, stampParams } from './derived-outputs.js';
import { t } from './i18n/index.js';

describe('derived output basis', () => {
  it('is sorted and deduplicated, so order does not change the hash', () => {
    const a = buildBasis([{ sourceId: 32, contentHash: 'b' }, { sourceId: 11, contentHash: 'a' }], [5, 3, 5]);
    const b = buildBasis([{ sourceId: 11, contentHash: 'a' }, { sourceId: 32, contentHash: 'b' }], [3, 5]);
    expect(a).toEqual({ sources: [{ sourceId: 11, contentHash: 'a' }, { sourceId: 32, contentHash: 'b' }], claimIds: [3, 5], claims: 2 });
    expect(basisHash(a)).toBe(basisHash(b));
    expect(basisHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes the hash when a source is added, retired, re-fetched, or a claim changes', () => {
    const base = basisHash(buildBasis([{ sourceId: 11, contentHash: 'a' }], [1, 2]));
    expect(basisHash(buildBasis([{ sourceId: 11, contentHash: 'a' }, { sourceId: 32, contentHash: 'c' }], [1, 2]))).not.toBe(base);
    expect(basisHash(buildBasis([], [1, 2]))).not.toBe(base);
    expect(basisHash(buildBasis([{ sourceId: 11, contentHash: 'z' }], [1, 2]))).not.toBe(base);
    expect(basisHash(buildBasis([{ sourceId: 11, contentHash: 'a' }], [1, 3]))).not.toBe(base);
    expect(basisHash(buildBasis([{ sourceId: 11, contentHash: null }], [1, 2]))).not.toBe(base);
  });
});

describe('version rule', () => {
  it('starts at 1, stays on the same hash, bumps by one on a new hash', () => {
    expect(nextVersion(null, 'h')).toEqual({ action: 'create', version: 1 });
    expect(nextVersion({ version: 4, basisHash: 'h' }, 'h')).toEqual({ action: 'same', version: 4 });
    expect(nextVersion({ version: 4, basisHash: 'h' }, 'g')).toEqual({ action: 'bump', version: 5 });
  });
});

describe('sole-source supersede', () => {
  it('supersedes claims with no other available source and keeps the rest', () => {
    const cites = [
      { claimId: 1, sourceId: 11, available: false }, // only the retired store page
      { claimId: 2, sourceId: 11, available: false }, { claimId: 2, sourceId: 32, available: true }, // also in the new rulebook
      { claimId: 3, sourceId: 11, available: false }, { claimId: 3, sourceId: 9, available: false }, // other source is gone too
      { claimId: 4, sourceId: 32, available: true }, // does not cite source 11
    ];
    expect(planSupersede(cites, 11)).toEqual({ supersede: [1, 3], keep: [2] });
  });
});

describe('stamp', () => {
  it('formats version, UTC date and source count', () => {
    const p = stampParams({ version: 3, builtAt: '2026-10-20T23:30:00Z', sources: 2 });
    expect(p).toEqual({ n: 3, date: '2026-10-20', k: 2 });
    expect(t('en', 'outputs.stamp', p)).toBe('v3 · 2026-10-20 · 2 sources');
    expect(stampParams({ version: 1, builtAt: 'nonsense', sources: 0 }).date).toBe('');
  });
});
