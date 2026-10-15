# BoardGameGeek (BGG) integration notes

Source: https://boardgamegeek.com/using_the_xml_api (version date 2025-07-02), researched 2026-10-15. Status: NOT applied yet. Cory will decide later.

## No "Sign in with BGG"
BGG offers no OAuth/OpenID login for third-party sites. Its tokens identify an application to BGG, not a user to us. So BGG cannot be a Rogue login provider. Login stays GitHub / Google / Discord.

## XML API access
- Registration and authorization required for nearly all use: https://boardgamegeek.com/applications ("create an application"). Approval can take a week or more.
- After approval, create tokens under the application ("Tokens"). Send on every request: `Authorization: Bearer <token>` to `boardgamegeek.com` (no `www`). Tokens are not refreshed for now (may change).
- One token per application. End users never get or need their own. Third-party services that re-expose BGG data to other applications are prohibited.
- Call from the server and cache results. Client-side calls risk a suspended license. Keep requests to a minimum. Usage is visible under the application's "Usage" link. Exact limits not published.
- Exception: downloading your own collection while logged in needs no registration. Other users' collections without registration work but are heavily rate limited. Routine multi-user collection fetches need a registered app. The CSV dump of all games also needs an approved app.
- Public-facing apps must show the "Powered by BGG" logo linking to BGG.
- No technical support. Policies can change at any time (announcements: Geek Tools News forum).

## Licensing
- Commercial = for-profit, raises money, shows ads, or charges users. Free commercial license is usual until 100 paying users (user payments) or 1000 users (ads). Donation-only still needs a (likely free) commercial license.
- Non-commercial is generally free, possibly different usage limits. Rogue is open source and unmonetized, so register as non-commercial.
- BGG may deny apps that compete with any part of its business or harm it. Rogue (rules facts, setup sheets, rules chat) is different from BGG's database/marketplace, but BGG decides. Do not copy BGG data wholesale, store only what a feature needs, link back.

## Design implications (backlog feature: collection by player count + "what shall we play")
- Collection import by BGG username is read-only, public data, via our single server-side app token. Typing a username does not prove ownership, so it must never gate private or write features.
- Cache collections per username with a TTL, rate-limit our own fetches, show the Powered by BGG logo on those pages.
- Match to Rogue games by BGG id (store `bgg_id` on games). Unindexed games show as "not in Rogue yet".
- Do not use scraped (non-API) BGG pages.

## Test account
Cory's BGG username for testing collection import: `CoryIsakson` (provided 2026-10-15). Public username, fine to keep in docs.
