# Wiki import

For games whose rules live in a wiki (BookStack, MediaWiki or any site of linked pages). Decision record: `docs/adr/0006-wiki-sources.md`.

## Admin: Import from wiki
On `/admin/games/<slug>/sources`, card "Import from wiki":
1. Paste the wiki start URL. A whole-wiki import stays on that host and under that path (e.g. `https://wiki.example.org/books/rules` only follows `/books/rules...`).
2. Tick "I read the wiki's terms" when the host is not approved yet (same rule as Add rules link).
3. Optional: **Discover pages** reads only the start page and lists its in-scope links. List pages (books, chapters, categories) start unticked. Untick what you do not want, then **Import selected pages**.
4. Or choose a mode and **Run rights checks and import**: *whole wiki* (breadth-first crawl, max pages default 150, hard cap 500, depth 4) or *selected pages* (one URL per line, same host).

The import runs in the background, one page every 2 s or more. Progress shows on the card (reload to update); **Stop import** ends it after the current page. One import per game at a time; an interrupted import resumes after a restart.

## What happens to each page
- Fetched by the rights-gated fetcher (robots.txt, RogueBot UA, size cap); skipped if fetched within 24 h (unless "Re-fetch" is ticked); tombstoned URLs are never fetched.
- Text: the page content region only (BookStack `.page-content`/`#main-content`, MediaWiki `#mw-content-text`, else `main`/`article`), headings, lists and tables kept as markdown; nav, sidebars, TOC, edit links and comments dropped.
- Stored as its own source: document kind `wiki`, authority `community` (ranks below publisher text), `rights_status=link_only`, title = breadcrumb (book > chapter > page). Indexed and cited by title + URL.
- Listing pages (books, chapters, categories) are read for their links only.
- A 403, 429 or captcha page stops the import and says so. Rogue does not get past bot walls; use Capture from browser instead.

## Game requests
`/request-game?mode=link` accepts a wiki start page instead of a rulebook link. Rights and terms checks run on the wiki host; approval imports the whole wiki, then the Librarian drafts facts.

## Lists
Wiki pages show as one collapsed "Wiki (N pages)" entry on the game page and on the admin sources page (each page keeps its Re-ingest and Delete actions).

Code: `packages/core/src/wiki/` (detect, links, crawl plan, page cleanup), `apps/web/src/lib/wiki-crawl.ts`, migration `0042_wiki_sources.sql`.
