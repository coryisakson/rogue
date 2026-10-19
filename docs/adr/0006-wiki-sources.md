# 0006. Wiki sources

Status: accepted (task wiki-import, 2026-10-19)

## Context
Some games have no rulebook PDF: the rules live only in a wiki (example: wiki.alliesofmajesty.com, a BookStack site with shelves > books > chapters > pages; robots.txt allows all, the API needs auth). Rogue's intake assumed one publisher document per source, fetched once. A wiki is tens to hundreds of small linked pages, often written by the community, and editable by anyone the owner allows.

## Decision
- A wiki page is a source like any other: one `sources` row per page, document kind `wiki`, `rights_status = link_only`, title = wiki breadcrumb (book > chapter > page). Indexed like HTML sources (section headings as locators), cited by page title + URL, never page numbers.
- Lower authority: `authority = 'community'`, ranked below publisher text (AGENTS.md 2b). Amended 2026-10-19 (Cory): an admin may attest (audited checkbox) that a wiki is the publisher's official documentation; its pages then get `authority = 'publisher'` and still rank below the publisher's rulebook (kind weight). Migration 0043.
- Same gates as "Add rules link": the admin confirms the site's terms for a new host, the Rights Officer probes the start URL, only then is the host approved. Wiki-only game requests (`wikiUrl`) run the rights and terms checks on the wiki host.
- Polite crawling: the existing RightsGatedFetcher (robots.txt, >= 2 s per host, size cap, RogueBot UA), pages fetched within 24 h are skipped, tombstones honoured. A 403, 429 or captcha page stops the crawl; Rogue never tries to get past a bot wall.
- Page cap: default 150 pages, hard cap 500, max depth 4, scope = same host and path prefix of the start URL. Login, edit, history, search, user, tag, export and similar pages are never followed.
- Rendered page text only (BookStack, MediaWiki, generic `main`/`article`), not wiki APIs.
- Crawls run in the background (`wiki_crawls` table), one per game, resumable after a restart, audited with counts and URLs only.

## Consequences
- A game page can list many sources; wiki pages are grouped into one collapsed "Wiki (N pages)" entry.
- Wiki text may change without a new edition; re-import (or Re-ingest per page) refreshes it.
- No agent tool yet: the Scout may propose a wiki URL in a request, but crawling is started by an admin or by approval.
