# Settings (/admin/settings)

Admins set every model, endpoint and API key the app uses at `/admin/settings`. No redeploy, no env edits.

## Resolution
For every key: **saved setting > env var > code default**. Each setting is named after the env var it overrides
(`ROGUE_AI_CHAT_MODEL`, `ROGUE_OCR_BASE_URL`, ...), so chart values stay the fallback defaults. With nothing saved the
app behaves exactly as with env only. The page shows each effective value and where it comes from (setting / env / default).

The app reads settings through one accessor (`apps/web/src/lib/settings.ts`), cached 15 s and reloaded right after a save.
Until the first load after a restart (a few ms) and when the database is down, env values apply.

## Groups
- **Router**: `ROGUE_AI_BASE_URL`, `ROGUE_AI_API_KEY`.
- **Roles** (`ROGUE_AI_<ROLE>_MODEL` / `_BASE_URL` / `_API_KEY`): `CHAT` (answers; also the default model for other roles),
  `TRANSLATE` (follow-up rewrite + translation), `MULTI` (multilingual override, used only with its own base URL),
  `EMBED` (embeddings; a new model needs a re-index), `RERANK` (new; empty = the chat model ranks as before; set = `POST {base}/rerank`
  Cohere/Jina style, falling back to the chat-model ranking on any error). A role with its own base URL gets only its own key, never the Router key.
- **Reasoning**: `ROGUE_AI_ANSWER_REASONING` (default low), `ROGUE_AI_REWRITE_REASONING` (default none). `default` sends nothing.
- **Judge**: `ROGUE_JUDGE_BASE_URL` / `_MODEL` / `_API_KEY`.
- **Agents**: `ROGUE_AGENT_MODEL` (default for all) and `ROGUE_AGENT_MODEL_<NAME>` (REVIEWER, SCOUT, LIBRARIAN; ADR 0007 retired the others).
- **OCR**: `ROGUE_OCR_PROVIDER`, `ROGUE_OCR_BASE_URL`, `ROGUE_OCR_API_KEY`. **Search**: `ROGUE_SEARCH_BASE_URL`.
- **Integrations**: `ROGUE_BGG_TOKEN`, `ROGUE_DISCORD_WEBHOOK_URL`.

Each group has a **Test** button (tiny live call: chat ping, one embedding, a two-document rerank, OCR reachability,
search "test", a BGG API call with the token) that shows latency and ok/error. "Models on the Router" lists `GET {base}/models`
(cached 60 s) and feeds the model fields' suggestions.

## Secrets
API keys, the BGG token and the Discord webhook are stored AES-256-GCM encrypted (`enc:v1:` prefix, same layout as
backups) with the backup key (`ROGUE_BACKUP_KEY`, else `data/backup-key`). They are never rendered back: the page shows the
last 4 characters and a "replace" box. **If the backup key changes, saved secrets cannot be decrypted**: they are skipped
(env/default applies, a warning is logged) and must be saved again.

## Audit
Every save and reset writes `audit_log` action `setting_change` with the admin (`user:<id>`), the key and old -> new value;
for secrets only `set` / `replaced` / `cleared`.

## Agents (Nanobot sidecar)
On every settings load the app writes `agent-settings.json` into `ROGUE_AGENT_SHARE_DIR` (only saved values: Router base
URL and key, default and per-agent models). The sidecar (0.6.0+) reads it at start and checks it every 5 s; agents whose
generated config changed are restarted with the new model. A job running on a restarted agent is interrupted.
Agent model order: per-agent setting > `ROGUE_AGENT_MODEL` > saved chat model > sidecar env `ROGUE_AI_CHAT_MODEL`.
