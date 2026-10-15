import { RateLimiter, buildSheet, formatAnswer, formatError, formatSetup, type CitedSource, type ParsedInteraction } from '@rogue/core';
import { askRules } from './chat';
import { getClaims, getGame } from './kb';
import { ipv4Fetch } from './services';

/**
 * Discord glue (interactions-webhook style): no gateway socket, no Discord library.
 * Everything here is inert unless BOTH env vars are set; the route returns 404 otherwise.
 */
export function discordConfig(): { publicKey: string; appId: string } | null {
  const publicKey = process.env['ROGUE_DISCORD_PUBLIC_KEY']?.trim();
  const appId = process.env['ROGUE_DISCORD_APP_ID']?.trim();
  return publicKey && appId ? { publicKey, appId } : null;
}

// Per Discord user. /ask costs an AI call, so it is stricter than /setup.
const askLimit = new RateLimiter(Number(process.env['ROGUE_DISCORD_ASK_LIMIT'] ?? 5), 60_000);
const setupLimit = new RateLimiter(Number(process.env['ROGUE_DISCORD_SETUP_LIMIT'] ?? 10), 60_000);

/** True if this user may run the command now. Exported for the route and tests. */
export function allowDiscordUser(kind: 'ask' | 'setup', userId: string): boolean {
  return (kind === 'ask' ? askLimit : setupLimit).allow(userId);
}

const pageNumber = (locator: string | null): number | null => {
  const n = Number(locator?.match(/\d+/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function buildSetupReply(game: string, players: number | null): Promise<string> {
  const g = await getGame(game);
  if (!g) return formatError(`I don't know a game called \`${game}\`. Use the slug from the website, e.g. \`pandemic\`.`);
  const all = await getClaims(game);
  if (!all.length) return formatError('No cited setup facts for this game yet.');
  // Keep generic claims plus the ones written for this exact player count.
  const claims = players ? all.filter((c) => c.player_count == null || c.player_count === players) : all;
  const sheet = buildSheet(claims);
  const sources = new Map<string, CitedSource & { pages: number[] }>();
  for (const sec of sheet.sections) for (const line of sec.lines) {
    const c = claims.find((x) => x.id === line.id); if (!c) continue;
    const s = sources.get(c.source_title) ?? { title: c.source_title, publisher: c.publisher, url: c.source_url, pages: [] };
    const p = pageNumber(c.locator); if (p) s.pages.push(p);
    sources.set(c.source_title, s);
  }
  const used = [...sources.values()];
  return formatSetup(g.name, players, sheet.sections, used.length ? used : [{ title: all[0]!.source_title, publisher: all[0]!.publisher }]);
}

async function buildAskReply(game: string, question: string): Promise<string> {
  if (!(await getGame(game))) return formatError(`I don't know a game called \`${game}\`.`);
  const r = await askRules(game, question);
  const byTitle = new Map<string, CitedSource & { pages: number[] }>();
  for (const s of r.sources) {
    const e = byTitle.get(s.title) ?? { title: s.title, publisher: s.publisher, url: s.url, pages: [] };
    e.pages.push(s.page); byTitle.set(s.title, e);
  }
  return formatAnswer(question, r.answer, [...byTitle.values()], r.warning);
}

/** Edit the deferred "thinking…" message. The interaction token is the credential, so no bot token is needed here. */
async function sendFollowUp(appId: string, token: string, content: string): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/@original`;
  const res = await ipv4Fetch(url, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    // allowed_mentions empty: model text can never ping anyone.
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.warn('[discord] follow-up failed', res.status);
}

/** Runs after the deferred ACK has been returned. Never throws; users only see a generic error. */
export async function runDiscordCommand(cmd: Extract<ParsedInteraction, { kind: 'setup' | 'ask' }>, appId: string): Promise<void> {
  let content: string;
  try {
    content = cmd.kind === 'setup' ? await buildSetupReply(cmd.game, cmd.players) : await buildAskReply(cmd.game, cmd.question);
  } catch (e) {
    console.warn('[discord] command failed', e instanceof Error ? e.message : 'error');
    content = formatError('Something went wrong on my side. Please try again in a minute.');
  }
  await sendFollowUp(appId, cmd.token, content).catch((e) => console.warn('[discord] follow-up error', e instanceof Error ? e.message : 'error'));
}
