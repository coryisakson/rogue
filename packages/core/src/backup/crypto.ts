import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Backup encryption: AES-256-GCM. File layout = "RGE1" (4 bytes) + IV (12) + ciphertext + auth tag (16).
 * scripts/restore.mjs reads the same layout without any project code, so a backup can be opened on a bare machine with just the key.
 */
const MAGIC = Buffer.from('RGE1');

export const newBackupKey = (): string => randomBytes(32).toString('base64');

function keyBytes(key: string): Buffer {
  const k = Buffer.from(key.trim(), 'base64');
  if (k.length !== 32) throw new Error('backup key must be 32 bytes, base64 encoded');
  return k;
}

export function encryptBytes(data: Uint8Array, key: string): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}

/** Throws on a wrong key, a damaged file, or a file that is not one of ours. */
export function decryptBytes(blob: Uint8Array, key: string): Uint8Array {
  const b = Buffer.from(blob);
  if (b.length < 32 || !b.subarray(0, 4).equals(MAGIC)) throw new Error('not an encrypted Rogue backup');
  const d = createDecipheriv('aes-256-gcm', keyBytes(key), b.subarray(4, 16));
  d.setAuthTag(b.subarray(b.length - 16));
  try { return Buffer.concat([d.update(b.subarray(16, b.length - 16)), d.final()]); }
  catch { throw new Error('decryption failed: wrong key or damaged backup'); }
}
