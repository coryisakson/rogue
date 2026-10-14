import { expect } from 'vitest';
import type { StorageProvider } from './types.js';

/**
 * Conformance suite every StorageProvider must pass (local today; S3/Azure/GCS later).
 * Call from a test with a fresh, empty provider.
 */
export async function runStorageConformance(p: StorageProvider): Promise<void> {
  const data = new TextEncoder().encode('hello rogue');

  const put = await p.put('a/b/one.txt', data);
  expect(put.size).toBe(data.byteLength);
  expect(put.sha256).toMatch(/^[0-9a-f]{64}$/);

  expect(new TextDecoder().decode((await p.get('a/b/one.txt'))!)).toBe('hello rogue');
  expect((await p.head('a/b/one.txt'))?.sha256).toBe(put.sha256);
  expect(await p.get('missing')).toBeNull();
  expect(await p.head('missing')).toBeNull();

  await p.put('a/two.txt', data);
  await p.put('z/three.txt', data);
  expect((await p.list()).map((o) => o.key)).toEqual(['a/b/one.txt', 'a/two.txt', 'z/three.txt']);
  expect((await p.list('a/')).map((o) => o.key)).toEqual(['a/b/one.txt', 'a/two.txt']);

  await p.put('a/two.txt', new TextEncoder().encode('v2'));
  expect(new TextDecoder().decode((await p.get('a/two.txt'))!)).toBe('v2');

  expect(await p.delete('a/two.txt')).toBe(true);
  expect(await p.delete('a/two.txt')).toBe(false);

  await expect(p.put('../escape', data)).rejects.toThrow();
  await expect(p.put('/abs', data)).rejects.toThrow();
  await expect(p.put('a//b', data)).rejects.toThrow();
}
