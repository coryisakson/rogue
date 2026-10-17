// Temporary helper (not committed): gzip size of all client JS and CSS in the web build.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const dir = 'apps/web/dist/client/_astro';
for (const ext of ['.js', '.css']) {
  const all = Buffer.concat(readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => readFileSync(join(dir, f))));
  console.log(ext, gzipSync(all, { level: 9 }).length);
}
