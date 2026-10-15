/** Pure parsing of Discord interaction payloads into the few things Rogue understands. */

export const INTERACTION_PING = 1;
export const INTERACTION_APPLICATION_COMMAND = 2;
export const INTERACTION_MESSAGE_COMPONENT = 3;

export type ParsedInteraction =
  | { kind: 'ping' }
  | { kind: 'setup'; game: string; players: number | null; userId: string; token: string }
  | { kind: 'ask'; game: string; question: string; userId: string; token: string }
  | { kind: 'rate'; game: string; helpful: boolean; messageId: string; userId: string }
  | { kind: 'invalid'; message: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_QUESTION = 300;
export const MIN_QUESTION = 3;
export const MAX_PLAYERS = 12;

/** Slash-command definitions, shared by the registration script and tests so they cannot drift. */
export const COMMAND_DEFINITIONS = [
  {
    name: 'setup', description: 'Cited one-page setup for a game', type: 1,
    options: [
      { type: 3, name: 'game', description: 'Game slug, e.g. pandemic', required: true, max_length: 64 },
      { type: 4, name: 'players', description: 'Number of players', required: false, min_value: 1, max_value: MAX_PLAYERS },
    ],
  },
  {
    name: 'ask', description: 'Ask a rules question; answers cite the rulebook page', type: 1,
    options: [
      { type: 3, name: 'game', description: 'Game slug, e.g. pandemic', required: true, max_length: 64 },
      { type: 3, name: 'question', description: 'Your rules question', required: true, min_length: MIN_QUESTION, max_length: MAX_QUESTION },
    ],
  },
] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function optionMap(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(data['options'])) for (const o of data['options']) if (isObj(o) && typeof o['name'] === 'string') out[o['name']] = o['value'];
  return out;
}

/** Discord user id: `member.user.id` in servers, `user.id` in DMs. */
export function interactionUserId(i: Record<string, unknown>): string | null {
  const member = isObj(i['member']) && isObj(i['member']['user']) ? i['member']['user']['id'] : undefined;
  const user = isObj(i['user']) ? i['user']['id'] : undefined;
  const id = member ?? user;
  return typeof id === 'string' && /^\d{1,25}$/.test(id) ? id : null;
}

/** custom_id of the rating buttons under an /ask answer. Carries no user text, only the game and the verdict. */
export const ratingCustomId = (game: string, helpful: boolean): string => `rate:${game}:${helpful ? 'up' : 'down'}`;

/** Action row with the two rating buttons (type 2 = button, style 2 = grey). */
export function ratingComponents(game: string) {
  return [{ type: 1, components: [
    { type: 2, style: 2, label: 'Helpful', emoji: { name: '👍' }, custom_id: ratingCustomId(game, true) },
    { type: 2, style: 2, label: 'Not helpful', emoji: { name: '👎' }, custom_id: ratingCustomId(game, false) },
  ] }];
}

function parseRating(payload: Record<string, unknown>): ParsedInteraction {
  const data = payload['data'];
  const m = isObj(data) && typeof data['custom_id'] === 'string' ? /^rate:([a-z0-9][a-z0-9-]{0,63}):(up|down)$/.exec(data['custom_id']) : null;
  const messageId = isObj(payload['message']) ? payload['message']['id'] : undefined;
  const userId = interactionUserId(payload);
  if (!m || !userId || typeof messageId !== 'string' || !/^\d{1,25}$/.test(messageId)) return { kind: 'invalid', message: 'Unknown button.' };
  return { kind: 'rate', game: m[1]!, helpful: m[2] === 'up', messageId, userId };
}

export function parseInteraction(payload: unknown): ParsedInteraction {
  if (!isObj(payload)) return { kind: 'invalid', message: 'Unreadable request.' };
  if (payload['type'] === INTERACTION_PING) return { kind: 'ping' };
  if (payload['type'] === INTERACTION_MESSAGE_COMPONENT) return parseRating(payload);
  if (payload['type'] !== INTERACTION_APPLICATION_COMMAND || !isObj(payload['data'])) return { kind: 'invalid', message: 'Unsupported interaction.' };
  const data = payload['data'];
  const userId = interactionUserId(payload);
  const token = payload['token'];
  if (!userId || typeof token !== 'string' || !token) return { kind: 'invalid', message: 'Unreadable request.' };
  const opts = optionMap(data);
  const game = typeof opts['game'] === 'string' ? opts['game'].trim().toLowerCase() : '';
  if (data['name'] !== 'setup' && data['name'] !== 'ask') return { kind: 'invalid', message: 'Unknown command.' };
  if (!SLUG.test(game)) return { kind: 'invalid', message: 'Give the game as its slug, e.g. `pandemic` (lowercase letters, digits, dashes).' };
  if (data['name'] === 'setup') {
    const p = opts['players'];
    if (p === undefined || p === null) return { kind: 'setup', game, players: null, userId, token };
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > MAX_PLAYERS) return { kind: 'invalid', message: `Players must be a whole number from 1 to ${MAX_PLAYERS}.` };
    return { kind: 'setup', game, players: p, userId, token };
  }
  const question = typeof opts['question'] === 'string' ? opts['question'].replace(/\s+/g, ' ').trim() : '';
  if (question.length < MIN_QUESTION) return { kind: 'invalid', message: 'Please ask a longer question.' };
  return { kind: 'ask', game, question: question.slice(0, MAX_QUESTION), userId, token };
}
