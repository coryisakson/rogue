#!/usr/bin/env node
// Registers Rogue's global slash commands with Discord (bulk overwrite, idempotent).
// Env: ROGUE_DISCORD_APP_ID, ROGUE_DISCORD_BOT_TOKEN. The token is only sent to Discord, never printed.
// Usage: ROGUE_DISCORD_APP_ID=... ROGUE_DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs [--dry-run]

// Keep in sync with COMMAND_DEFINITIONS in packages/core/src/discord/commands.ts (a test pins the names).
const commands = [
  { name: 'setup', description: 'Cited one-page setup for a game', type: 1, options: [
    { type: 3, name: 'game', description: 'Game slug, e.g. pandemic', required: true, max_length: 64 },
    { type: 4, name: 'players', description: 'Number of players', required: false, min_value: 1, max_value: 12 } ] },
  { name: 'ask', description: 'Ask a rules question; answers cite the rulebook page', type: 1, options: [
    { type: 3, name: 'game', description: 'Game slug, e.g. pandemic', required: true, max_length: 64 },
    { type: 3, name: 'question', description: 'Your rules question', required: true, min_length: 3, max_length: 300 } ] },
];

const appId = process.env.ROGUE_DISCORD_APP_ID;
const token = process.env.ROGUE_DISCORD_BOT_TOKEN;
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(commands, null, 2)); process.exit(0); }
if (!appId || !/^\d+$/.test(appId)) { console.error('Set ROGUE_DISCORD_APP_ID (numeric application id).'); process.exit(1); }
if (!token) { console.error('Set ROGUE_DISCORD_BOT_TOKEN.'); process.exit(1); }

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: 'PUT',
  headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  // Print only the status and Discord's error message, never request headers.
  const text = await res.text();
  console.error(`Discord returned ${res.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}
const out = await res.json();
console.log(`Registered ${out.length} commands: ${out.map((c) => '/' + c.name).join(', ')}`);
