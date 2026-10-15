# Takedown runbook (manual trigger, one command)

1. A rights holder contacts you (email, Discord, publisher portal later). Reply promptly and politely; keep the message.
2. Identify scope: one URL, or everything for a game slug.
3. Dry run (changes nothing, shows what will be removed):
   `POST /api/admin/lifecycle?action=takedown&url=<URL>&requester=<who>&reason=<text>&dry=1`
   (or `game=<slug>` instead of `url`). From the pod: use `olares-cli cluster pod exec ... node -e fetch(...)`; a Discord command will wrap this later.
4. Run it without `dry=1`. It tombstones the URL (never refetched, replayed after any restore), deletes the private PDF and extracted text, blanks stored quotes, rejects claims that cited it, and writes the audit log and a `takedown_requests` row.
5. Confirm to the requester. Offer the publisher-contact flow if they want to grant a licence instead.
6. Backups taken before the takedown still contain the data until they rotate out (7 daily / 4 weekly / 6 monthly). Tombstones are replayed after any restore. Log this in `REVIEW_LOG.md` if a requester asks about backups.

Reply template: "Thanks for letting us know. We have removed our cached copy of <doc>, stopped fetching it, and removed derived statements that relied on it. Rogue only links to publisher sources. If you would like to authorise specific material instead, reply here."
