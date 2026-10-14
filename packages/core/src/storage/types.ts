/**
 * Storage Provider interface (design plan section 6b). One interface for every kind of persistent bytes
 * (backups, exports, caches, user media). Providers: local/mount now; S3, Azure Blob, GCS later.
 * Keys are POSIX-style relative paths such as "backups/kb/2026-10-14/dump.sql".
 */
export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
  modified: string; // ISO time
}

export interface StorageProvider {
  readonly id: string;
  put(key: string, data: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<StoredObject[]>;
}

/** Reject keys that could escape the provider root or hide files. */
export function assertSafeKey(key: string): void {
  if (key === '' || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
  }
  for (const part of key.split('/')) {
    if (part === '' || part === '.' || part === '..') {
      throw new Error(`invalid storage key: ${JSON.stringify(key)}`);
    }
  }
}
