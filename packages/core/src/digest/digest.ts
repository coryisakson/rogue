/** Weekly recheck schedule and Discord digest text. Pure functions, so they are easy to test. */

export interface RecheckLine { url: string; outcome: string; detail: string }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Due when never run, or the last run is at least 7 days old. Runs only from 04:00 UTC so it does not collide with the 03:00 backup. */
export function isRecheckDue(now: Date, lastRunIso?: string): boolean {
  if (now.getUTCHours() < 4) return false;
  if (!lastRunIso) return true;
  const last = Date.parse(lastRunIso);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= WEEK_MS;
}

/** Short Discord message (under the 2000-char limit). Lists only sources that need attention. */
export function formatDigest(results: RecheckLine[], date: string): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const summary = [...counts].map(([k, v]) => `${k}: ${v}`).join(', ') || 'no sources';
  const attention = results.filter((r) => r.outcome !== 'unchanged').slice(0, 10);
  const lines = attention.map((r) => `- ${r.outcome}: ${r.url} (${r.detail.slice(0, 80)})`);
  const text = [`Rogue weekly source recheck ${date}`, summary, ...lines].join('\n');
  return text.slice(0, 1900);
}
