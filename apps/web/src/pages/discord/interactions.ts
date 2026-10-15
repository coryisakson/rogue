import type { APIRoute } from 'astro';
import { formatError, parseInteraction, verifyDiscordSignature } from '@rogue/core';
import { allowDiscordUser, discordConfig, recordDiscordRating, runDiscordCommand } from '../../lib/discord-bot';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// Discord response types: 1 = PONG, 4 = message, 5 = deferred message (we edit it later).
const message = (content: string) => json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

/** Discord interactions endpoint. 404 unless configured, 401 unless the Ed25519 signature checks out. */
export const POST: APIRoute = async ({ request }) => {
  const cfg = discordConfig();
  if (!cfg) return json({ error: 'not found' }, 404);

  const raw = await request.text(); // raw text: the signature covers the exact bytes
  if (raw.length > 20_000) return json({ error: 'too large' }, 413);
  const ok = verifyDiscordSignature(cfg.publicKey, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), raw);
  if (!ok) return json({ error: 'invalid request signature' }, 401);

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const cmd = parseInteraction(payload);

  if (cmd.kind === 'ping') return json({ type: 1 });
  if (cmd.kind === 'invalid') return message(formatError(cmd.message));
  if (cmd.kind === 'rate') return message(await recordDiscordRating(cmd));
  if (!allowDiscordUser(cmd.kind, cmd.userId)) return message(formatError('Slow down a little, try again in a minute.'));

  // Acknowledge within Discord's 3 s window, then do the work and edit the reply.
  void runDiscordCommand(cmd, cfg.appId);
  return json({ type: 5 });
};

// Everything else is not a route.
export const ALL: APIRoute = () => json({ error: 'not found' }, 404);
