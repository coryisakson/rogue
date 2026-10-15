import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptBytes, encryptBytes, newBackupKey } from './crypto.js';

describe('backup encryption', () => {
  it('round-trips', () => {
    const k = newBackupKey(); const data = new TextEncoder().encode('secret rows');
    expect(Buffer.from(decryptBytes(encryptBytes(data, k), k)).toString()).toBe('secret rows');
  });
  it('rejects a wrong key and a tampered file', () => {
    const k = newBackupKey(); const blob = Buffer.from(encryptBytes(new Uint8Array([1, 2, 3, 4]), k));
    expect(() => decryptBytes(blob, newBackupKey())).toThrow(/wrong key/);
    blob[blob.length - 20] = blob[blob.length - 20]! ^ 1;
    expect(() => decryptBytes(blob, k)).toThrow(/wrong key or damaged/);
  });
  it('does not leak plaintext', () => {
    const k = newBackupKey(); const blob = Buffer.from(encryptBytes(Buffer.from('PLAINTEXT-MARKER-PLAINTEXT'), k));
    expect(blob.includes('PLAINTEXT-MARKER')).toBe(false);
  });
  it('is readable by the standalone restore script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rge-')); const k = newBackupKey();
    writeFileSync(join(dir, 'x.enc'), encryptBytes(Buffer.from('hello from core'), k));
    execFileSync('node', [join(__dirname, '../../../../scripts/restore.mjs'), 'decrypt', join(dir, 'x.enc'), join(dir, 'x.out')], { env: { ...process.env, ROGUE_BACKUP_KEY: k } });
    expect(readFileSync(join(dir, 'x.out'), 'utf8')).toBe('hello from core');
  });
});
