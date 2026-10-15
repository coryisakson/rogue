import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { services } from './services';

/** Discord webhook: env ROGUE_DISCORD_WEBHOOK_URL, else {"webhook":"https://..."} in /app/data/discord.json. Never logged. */
function webhook(): string | undefined {
  const env = process.env['ROGUE_DISCORD_WEBHOOK_URL']; if (env) return env;
  try { return JSON.parse(readFileSync(join(services.dataDir, 'discord.json'), 'utf8')).webhook; } catch { return undefined; }
}

/** Fire-and-forget operator alert. Without a webhook it only logs; a failing alert must never break the job that raised it. */
export async function alertOperator(text: string): Promise<void> {
  console.warn('[alert]', text);
  const hook = webhook(); if (!hook) return;
  await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**Rogue** ${text}`.slice(0, 1900) }), signal: AbortSignal.timeout(8000) }).catch(() => {});
}
