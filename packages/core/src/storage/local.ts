import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertSafeKey, type StorageProvider, type StoredObject } from './types.js';

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** Provider backed by a directory (a container mount point, NAS path, or Olares Data folder). */
export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local';
  constructor(private readonly root: string) {}

  private path(key: string): string {
    assertSafeKey(key);
    return join(this.root, ...key.split('/'));
  }

  async put(key: string, data: Uint8Array): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write to a temp file then rename, so readers never see a half-written object.
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data);
    await rename(tmp, target);
    return { key, size: data.byteLength, sha256: sha256(data), modified: new Date().toISOString() };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    const data = await this.get(key);
    if (data === null) return null;
    const s = await stat(this.path(key));
    return { key, size: data.byteLength, sha256: sha256(data), modified: s.mtime.toISOString() };
  }

  async delete(key: string): Promise<boolean> {
    try {
      await rm(this.path(key));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  async list(prefix = ''): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(join(this.root, rel), { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
      }
      for (const entry of entries) {
        const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(childRel);
        else if (!entry.name.includes('.tmp-') && childRel.startsWith(prefix)) {
          const info = await this.head(childRel);
          if (info) out.push(info);
        }
      }
    };
    await walk('');
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}
