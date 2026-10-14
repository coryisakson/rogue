import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { LocalStorageProvider } from './local.js';
import { runStorageConformance } from './conformance.js';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('LocalStorageProvider', () => {
  it('passes the storage conformance suite', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rogue-storage-'));
    await runStorageConformance(new LocalStorageProvider(dir));
  });
});
