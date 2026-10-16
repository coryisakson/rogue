import { createHash } from 'node:crypto';
import { RateLimiter, buildSheet, ratingComponents, formatAnswer, formatError, formatSetup, type CitedSource, type ParsedInteraction } from '@rogue/core';
import { askRules } from './chat';
import { recordAsk } from './unanswered';
import { getClaims, getGame } from './kb';
import { hashDiscordUser } from './discord-link';
import { ensureMigrated, getPool, ipv4Fetch } from './services';

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
  recordAsk(game, question, 'discord', r);
  const byTitle = new Map<string, CitedSource & { pages: number[]; printed: Record<number, number | null> }>();
  for (const s of r.sources) {
    const e = byTitle.get(s.title) ?? { title: s.title, publisher: s.publisher, url: s.url, pages: [], printed: {} };
    e.pages.push(s.page); e.printed[s.page] = s.printed; byTitle.set(s.title, e);
  }
  return formatAnswer(question, r.answer, [...byTitle.values()], r.warning);
}

/** Edit the deferred "thinking…" message. The interaction token is the credential, so no bot token is needed here. */
async function sendFollowUp(appId: string, token: string, content: string, components?: unknown): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(token)}/messages/@original`;
  const res = await ipv4Fetch(url, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    // allowed_mentions empty: model text can never ping anyone.
    body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...(components ? { components } : {}) }), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.warn('[discord] follow-up failed', res.status);
}

/** Runs after the deferred ACK has been returned. Never throws; users only see a generic error. */
export async function runDiscordCommand(cmd: Extract<ParsedInteraction, { kind: 'setup' | 'ask' }>, appId: string): Promise<void> {
  let content: string;
  let components: unknown;
  try {
    content = cmd.kind === 'setup' ? await buildSetupReply(cmd.game, cmd.players) : await buildAskReply(cmd.game, cmd.question);
    // Only /ask answers can be rated; error replies below get no buttons.
    if (cmd.kind === 'ask') components = ratingComponents(cmd.game);
  } catch (e) {
    console.warn('[discord] command failed', e instanceof Error ? e.message : 'error');
    if (cmd.kind === 'ask') recordAsk(cmd.game, cmd.question, 'discord', { error: e });
    content = formatError('Something went wrong on my side. Please try again in a minute.');
  }
  await sendFollowUp(appId, cmd.token, content, components).catch((e) => console.warn('[discord] follow-up error', e instanceof Error ? e.message : 'error'));
}

/** The Rogue account linked to this Discord user id (signed in with Discord on the website), if any. */
async function linkedRogueUser(discordId: string): Promise<number | null> {
  const r = await getPool()!.query("SELECT user_id FROM identities WHERE provider='discord' AND provider_uid=$1", [discordId]);
  return r.rows[0] ? Number(r.rows[0].user_id) : null;
}

/** Record (or replace) one user's thumbs on one answer message. Returns the text shown to that user only. */
export async function recordDiscordRating(r: Extract<ParsedInteraction, { kind: 'rate' }>): Promise<string> {
  try {
    await ensureMigrated();
    const linked = await linkedRogueUser(r.userId);
    await getPool()!.query(
      `INSERT INTO discord_answer_ratings(game_slug, message_id, user_hash, helpful, user_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (message_id, user_hash) DO UPDATE SET helpful = EXCLUDED.helpful, created_at = now(), user_id = EXCLUDED.user_id`,
      [r.game, r.messageId, hashDiscordUser(r.userId), r.helpful, linked]);
    const thanks = r.helpful ? 'Thanks, glad it helped.' : 'Thanks, noted. The rulebook is authoritative; check the cited page.';
    // Nudge once per vote: signing in with Discord on the site ties votes to an account you can delete.
    return linked ? thanks : `${thanks} Tip: sign in with Discord at the Rogue website to link your votes to your account.`;
  } catch (e) {
    console.warn('[discord] rating failed', e instanceof Error ? e.message : 'error');
    return formatError('Could not save your rating. Please try again later.');
  }
}
