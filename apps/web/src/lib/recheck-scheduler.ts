import { readFile, writeFile } from 'node:fs/promises';
import { isRecheckDue, formatDigest } from '@rogue/core';
import { services } from './services';
import { recheckAll } from './lifecycle';

const STATE_FILE = `${process.env['ROGUE_DATA_DIR'] || '/app/data'}/recheck-state.json`;
let started = false;

async function lastRun(): Promise<string | undefined> {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')).at; } catch { return undefined; }
}

/** Optional: post the digest to a Discord webhook (env ROGUE_DISCORD_WEBHOOK_URL). Failure never breaks the recheck. */
async function postDigest(text: string): Promise<void> {
  const hook = process.env['ROGUE_DISCORD_WEBHOOK_URL'];
  if (!hook) return;
  await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text }) }).catch(() => {});
}

/** Hourly tick; runs the source recheck once a week and sends the digest. */
export function startRecheckScheduler(): void {
  if (started || !services.databaseUrl) return;
  started = true;
  const tick = async () => {
    const now = new Date();
    if (!isRecheckDue(now, await lastRun())) return;
    // Write state first so a crash mid-run does not cause a retry storm.
    await writeFile(STATE_FILE, JSON.stringify({ at: now.toISOString() })).catch(() => {});
    const results = await recheckAll();
    await postDigest(formatDigest(results, now.toISOString().slice(0, 10)));
  };
  setInterval(() => void tick().catch(() => {}), 60 * 60 * 1000).unref();
  setTimeout(() => void tick().catch(() => {}), 2 * 60 * 1000).unref();
}
