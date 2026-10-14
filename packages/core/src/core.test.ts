import { describe, expect, it } from 'vitest';
import { buildHealth, loadProfile, DEFAULT_PROFILE } from './index.js';

describe('health', () => {
  it('reports ok with version and ISO time', () => {
    const h = buildHealth('web', '1.2.3', new Date('2026-01-02T03:04:05Z'));
    expect(h).toEqual({ status: 'ok', service: 'web', version: '1.2.3', time: '2026-01-02T03:04:05.000Z' });
  });
});

describe('instance profile', () => {
  it('defaults to EU and the eu-default policy pack', () => {
    expect(loadProfile({})).toEqual(DEFAULT_PROFILE);
    expect(DEFAULT_PROFILE.region).toBe('eu');
  });
  it('honours env overrides', () => {
    const p = loadProfile({ ROGUE_INSTANCE_NAME: 'Club', ROGUE_REGION: 'us', ROGUE_LOCAL_ONLY: 'true' });
    expect(p).toMatchObject({ name: 'Club', region: 'us', localOnly: true });
  });
});
