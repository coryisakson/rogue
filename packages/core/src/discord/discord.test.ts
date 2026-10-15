import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_DEFINITIONS, DISCORD_LIMIT, defang, formatAnswer, formatError, formatSetup, formatSources, interactionUserId,
  parseInteraction, ratingComponents, ratingCustomId, truncate, verifyDiscordSignature, withFooter,
} from './index.js';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex');
  return { pub: raw, sign: (msg: string) => sign(null, Buffer.from(msg), privateKey).toString('hex') };
}
const NOW = 1_800_000_000;

describe('verifyDiscordSignature', () => {
  const k = keypair();
  const body = '{"type":1}';
  const ts = String(NOW);
  it('accepts a valid signature', () => expect(verifyDiscordSignature(k.pub, k.sign(ts + body), ts, body, NOW)).toBe(true));
  it('rejects a tampered body', () => expect(verifyDiscordSignature(k.pub, k.sign(ts + body), ts, '{"type":2}', NOW)).toBe(false));
  it('rejects a different timestamp', () => expect(verifyDiscordSignature(k.pub, k.sign(ts + body), String(NOW + 1), body, NOW)).toBe(false));
  it('rejects a signature from another key', () => expect(verifyDiscordSignature(keypair().pub, k.sign(ts + body), ts, body, NOW)).toBe(false));
  it('rejects stale timestamps (replay) but can skip the check', () => {
    const old = String(NOW - 1000);
    const sig = k.sign(old + body);
    expect(verifyDiscordSignature(k.pub, sig, old, body, NOW)).toBe(false);
    expect(verifyDiscordSignature(k.pub, sig, old, body, null)).toBe(true);
  });
  it('never throws on malformed input', () => {
    expect(verifyDiscordSignature(k.pub, null, ts, body, NOW)).toBe(false);
    expect(verifyDiscordSignature(k.pub, 'zz', ts, body, NOW)).toBe(false);
    expect(verifyDiscordSignature('nothex', k.sign(ts + body), ts, body, NOW)).toBe(false);
    expect(verifyDiscordSignature(k.pub, k.sign(ts + body), 'abc', body, NOW)).toBe(false);
    expect(verifyDiscordSignature(k.pub, k.sign(ts + body), undefined, body, NOW)).toBe(false);
  });
});

const cmd = (name: string, options: unknown[], extra: Record<string, unknown> = {}) =>
  ({ type: 2, token: 'tok', member: { user: { id: '42' } }, data: { name, options }, ...extra });

describe('parseInteraction', () => {
  it('ping', () => expect(parseInteraction({ type: 1 })).toEqual({ kind: 'ping' }));
  it('setup with and without players', () => {
    expect(parseInteraction(cmd('setup', [{ name: 'game', value: ' Pandemic ' }, { name: 'players', value: 3 }])))
      .toEqual({ kind: 'setup', game: 'pandemic', players: 3, userId: '42', token: 'tok' });
    expect(parseInteraction(cmd('setup', [{ name: 'game', value: 'pandemic' }]))).toMatchObject({ kind: 'setup', players: null });
  });
  it('ask normalises whitespace and caps length', () => {
    const r = parseInteraction(cmd('ask', [{ name: 'game', value: 'pandemic' }, { name: 'question', value: '  hand   limit?\n' }]));
    expect(r).toMatchObject({ kind: 'ask', question: 'hand limit?' });
    const long = parseInteraction(cmd('ask', [{ name: 'game', value: 'pandemic' }, { name: 'question', value: 'x'.repeat(900) }]));
    expect(long.kind === 'ask' && long.question.length).toBe(300);
  });
  it('uses DM user id', () => {
    expect(interactionUserId({ user: { id: '7' } })).toBe('7');
    expect(interactionUserId({ user: { id: 'abc' } })).toBeNull();
  });
  it('rejects bad input', () => {
    expect(parseInteraction(null).kind).toBe('invalid');
    expect(parseInteraction({ type: 3 }).kind).toBe('invalid');
    expect(parseInteraction(cmd('nope', [{ name: 'game', value: 'x' }])).kind).toBe('invalid');
    expect(parseInteraction(cmd('setup', [{ name: 'game', value: '../etc' }])).kind).toBe('invalid');
    expect(parseInteraction(cmd('setup', [{ name: 'game', value: 'pandemic' }, { name: 'players', value: 99 }])).kind).toBe('invalid');
    expect(parseInteraction(cmd('setup', [{ name: 'game', value: 'pandemic' }, { name: 'players', value: 2.5 }])).kind).toBe('invalid');
    expect(parseInteraction(cmd('ask', [{ name: 'game', value: 'pandemic' }, { name: 'question', value: 'hi' }])).kind).toBe('invalid');
    expect(parseInteraction({ type: 2, data: { name: 'setup' }, token: 't' }).kind).toBe('invalid'); // no user
  });
  it('definitions match the parser', () => expect(COMMAND_DEFINITIONS.map((c) => c.name)).toEqual(['setup', 'ask']));
  it('register script payload equals COMMAND_DEFINITIONS', () => {
    const script = fileURLToPath(new URL('../../../../scripts/register-discord-commands.mjs', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8', env: {} });
    expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(COMMAND_DEFINITIONS)));
  });
  it('register script refuses to run without env and prints no token', () => {
    const script = fileURLToPath(new URL('../../../../scripts/register-discord-commands.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ROGUE_DISCORD_APP_ID: '123', ROGUE_DISCORD_BOT_TOKEN: '' } });
    expect(r.status).toBe(1);
  });
});

describe('formatting', () => {
  const src = [{ title: 'Pandemic Rules', publisher: 'Z-Man', pages: [5, 3] }, { title: 'Pandemic Rules', publisher: 'Z-Man', pages: [3, 9] }];
  it('truncate respects the limit and adds an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    const t = truncate('word '.repeat(100), 50);
    expect(t.length).toBeLessThanOrEqual(50);
    expect(t.endsWith('…')).toBe(true);
  });
  it('formatSources merges and sorts pages', () => expect(formatSources(src)).toBe('**Sources:** Pandemic Rules (Z-Man) p.3, 5, 9'));
  it('formatSources says so when empty', () => expect(formatSources([])).toContain('No source'));
  it('withFooter keeps footer whole and stays within the limit', () => {
    const out = withFooter('a '.repeat(3000), 'FOOTER-CITES');
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(out.endsWith('FOOTER-CITES')).toBe(true);
  });
  it('formatSetup cites pages and sources, even when huge', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `Setup step number ${i} with words`, page: String(i % 9 + 1) }));
    const out = formatSetup('Pandemic', 3, [{ title: 'Setup', lines }], src);
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(out).toContain('Pandemic · Setup (3 players)');
    expect(out).toContain('[p.1]');
    expect(out).toContain('**Sources:** Pandemic Rules (Z-Man)');
  });
  it('formatAnswer includes sources and warning, within limit', () => {
    const out = formatAnswer('Hand limit?', 'Seven cards (p.6). '.repeat(300), src, 'Check the rulebook.');
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(out).toContain('⚠️ Check the rulebook.');
    expect(out).toContain('p.3, 5, 9');
  });
  it('defang blocks mass mentions', () => {
    expect(defang('hi @everyone and <@123> and @here')).not.toMatch(/@everyone|@here|<@123>/);
    expect(formatError('@everyone oops')).not.toContain('@everyone');
  });
});

describe('rating buttons', () => {
  const click = (custom_id: unknown, extra: Record<string, unknown> = {}) =>
    ({ type: 3, token: 't', data: { custom_id }, message: { id: '123456' }, member: { user: { id: '42' } }, ...extra });
  it('parses a thumbs up and a thumbs down', () => {
    expect(parseInteraction(click('rate:pandemic:up'))).toEqual({ kind: 'rate', game: 'pandemic', helpful: true, messageId: '123456', userId: '42' });
    expect(parseInteraction(click('rate:slay-the-spire:down'))).toMatchObject({ kind: 'rate', helpful: false });
  });
  it('rejects forged or malformed buttons', () => {
    for (const id of ['rate:pandemic:maybe', 'rate:../x:up', 'approve:1:x', 42, undefined]) expect(parseInteraction(click(id)).kind).toBe('invalid');
    expect(parseInteraction(click('rate:pandemic:up', { message: {} })).kind).toBe('invalid');
    expect(parseInteraction(click('rate:pandemic:up', { member: undefined })).kind).toBe('invalid');
  });
  it('builds buttons whose ids parse back', () => {
    const [row] = ratingComponents('pandemic');
    expect(row!.components.map((c) => c.custom_id)).toEqual([ratingCustomId('pandemic', true), ratingCustomId('pandemic', false)]);
  });
});
