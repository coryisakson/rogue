# Discord bot

Rogue answers in Discord with two slash commands. It uses Discord's **interactions webhook**: Discord POSTs each
command to `https://rogue.cisakson.olares.com/discord/interactions`. There is no gateway socket, no Discord
library and no always-on connection. Without the two env vars below the route returns 404 and nothing runs.

| Command | What it returns |
| --- | --- |
| `/setup game:<slug> players:<n>` | The cited setup lines (same builder as the website sheet), with source and page numbers. |
| `/ask game:<slug> question:<text>` | A rules answer from the same pipeline as `apps/web/src/lib/chat.ts`, with page cites and a source footer. |

Replies are cut to Discord's 2000-character limit by shortening the body; the **Sources** footer is never cut.
Mentions are neutralised, so model text cannot ping anyone. Rate limit: per Discord user id, in memory
(`/ask` 5 per minute, `/setup` 10 per minute; override with `ROGUE_DISCORD_ASK_LIMIT`, `ROGUE_DISCORD_SETUP_LIMIT`).
Rating buttons are deferred (they need the component-interaction type and a Discord-to-Rogue user link).

## Turn it on (Cory)

1. Go to <https://discord.com/developers/applications> and choose **New Application** (name e.g. "Rogue").
2. On **General Information** copy the **Application ID** and the **Public Key**.
3. On **Bot** click **Reset Token** and copy the token. Keep it private; it is only used by the register script on your machine.
4. Set these env vars on the Rogue app (Olares app env, not the repo):
   - `ROGUE_DISCORD_APP_ID` = Application ID
   - `ROGUE_DISCORD_PUBLIC_KEY` = Public Key (64 hex characters)
   Then redeploy. The bot token is **not** needed by the running app.
5. Back on **General Information** set **Interactions Endpoint URL** to
   `https://rogue.cisakson.olares.com/discord/interactions` and save. Discord sends a signed PING; saving only
   succeeds if the app is deployed with the env vars. The entrance must be public for this path
   (`ROGUE_AUTH_LEVEL=public`), because Discord cannot log in to Olares.
6. Register the commands once from any machine with Node 22:
   ```
   ROGUE_DISCORD_APP_ID=... ROGUE_DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs
   ```
   (`--dry-run` prints the command JSON without calling Discord.) Global commands can take up to an hour to appear.
7. Invite the bot: **OAuth2 > URL Generator**, scopes `applications.commands` (and `bot` only if you want it in the member list). No permissions are needed.

To turn it off, unset the two env vars and redeploy; the route goes back to 404.

## Security notes

- Every request must carry a valid `X-Signature-Ed25519` over `timestamp + raw body` (checked with `node:crypto`),
  and the timestamp must be within 5 minutes. Anything else gets 401.
- `/discord/interactions` is the only Discord path in the public allowlist (`isPublicPath`).
- The follow-up message uses the per-interaction token Discord supplies, so the running app never holds the bot token.

## Draft plan: admins channel (not built)

Goal: a private Discord channel where Rogue's agents tell Cory what needs attention. Today `alertOperator`
(`apps/web/src/lib/notify.ts`) posts plain text to a channel webhook (`ROGUE_DISCORD_WEBHOOK_URL`); this plan builds on it.

1. **Alerts.** Keep the webhook for one-way alerts. Group by severity prefix (info, warn, critical); critical also emails.
   Dedupe identical alerts for 1 hour so a failing job cannot flood the channel.
2. **Weekly digest.** A scheduled post (Monday, instance timezone) built from the existing digest module: claims
   published, claims awaiting review, takedown/opt-out events, backup status, rating averages, chat questions with no
   answer, open `RGE-A..` approvals. One embed, links to `/admin/*` pages. Counts only; no user text or personal data.
3. **Approvals handshake.** Rule 6 says agents never change rights, retention or secrets without an approval entry.
   Flow: agent writes the `RGE-Axx` entry in `docs/APPROVALS.md`/DB, then posts a message with **Approve** and
   **Reject** buttons. Button clicks arrive at the same `/discord/interactions` endpoint (component interactions, type 3).
   The handler must: (a) verify the signature as today, (b) check the clicking Discord user id is on an admin allowlist
   (`ROGUE_DISCORD_ADMIN_IDS`, plus a link to the Rogue admin account), (c) record decision, user, time in an approvals
   table (needs a migration, so a separate task), (d) edit the message to show the outcome, (e) never apply the change
   itself: it only unblocks the agent's next PR, which Cory still merges.
   Use a custom_id of `approve:<id>:<nonce>` where the nonce is HMAC-signed server-side, so stale or forged buttons fail.
4. **Channel access.** Private channel visible to Cory only; the bot needs Send Messages there. Approvals through
   Discord are a convenience; the file/DB entry stays the source of truth, and email remains the fallback.
5. **Open questions for Cory.** Are button approvals acceptable for all RGE classes, or only low-risk ones (e.g. no
   secrets or rights grants)? Which timezone for the digest?
