import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let cached: string | null = null;

/** Admin token lives on the data volume (never in git or the image). Created on first use, mode 0600. */
export function adminToken(): string {
  if (cached) return cached;
  const file = join(process.env['ROGUE_DATA_DIR'] ?? '/app/data', 'admin-token');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  cached = readFileSync(file, 'utf8').trim();
  return cached;
}
