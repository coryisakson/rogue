# Login setup (OAuth)

Rogue stores only provider, provider user id, display name and avatar. No email, no password. Sessions are 30 days; only a SHA-256 of the session token is stored.

Register an OAuth app at one or more providers. Redirect URL for each: `https://rogue.cisakson.olares.com/auth/<provider>/callback`

- GitHub: https://github.com/settings/developers -> New OAuth App. Callback `.../auth/github/callback`.
- Discord: https://discord.com/developers/applications -> your app -> OAuth2 -> add redirect `.../auth/discord/callback`, copy Client ID and Client Secret.
- Google: https://console.cloud.google.com/apis/credentials -> OAuth client ID (Web). Redirect `.../auth/google/callback`.

Give Hermes the client id and secret (never in chat history if avoidable): write them to `/app/data/oauth.json` on the data volume:
`{"github":{"id":"...","secret":"..."},"discord":{"id":"...","secret":"..."}}`
or set env `ROGUE_OAUTH_<PROVIDER>_ID` / `_SECRET`. A provider appears on /login only when both values exist. Optional `ROGUE_PUBLIC_URL` pins the redirect base.
