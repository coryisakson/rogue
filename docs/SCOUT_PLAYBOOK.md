# Scout playbook: finding and retrieving sources for a game

Written from the manual Pandemic run (2026-10-15). This is the procedure the Scout agent (and later the Librarian) must follow.
The agent proposes; deterministic code decides (see `packages/core/src/fetch`). Playbooks are versioned in git and improved by the Steward.

## Steps
1. **Find the publisher page.** Web search `<game> official rulebook <publisher>`. Rank results: publisher/author site > distributor/CDN > BGG file page with a stated publisher permission > everything else. Record why each candidate ranked where it did.
2. **Read the publisher page, don't trust the search snippet.** Fetch the page (through the gate) and extract every link to PDFs/rules/FAQ/errata/scenarios. Pandemic's page linked 15 PDFs; only the rulebook and solo/variant rules were relevant. Note the page URL as `foundOn` provenance.
3. **Pick documents by role.** Rulebook first, then errata/FAQ, quickstart, variants. Skip puzzles/scenarios/marketing unless asked.
4. **Check rights BEFORE fetching.** For each host: allowlist (human-approved), robots.txt (RFC 9309), TDM-reservation header and `/.well-known/tdmrep.json`, noai meta/headers, and read the site's terms of use for scraper/bot/AI clauses. Any ambiguity goes to `docs/REVIEW_LOG.md`; a clear ban means link-only and a "Contact the publisher" entry, no fetch.
5. **Fetch once, politely.** Identify as RogueBot, honour delays, size cap, skip if fetched within 24h, never retry in a loop.
6. **Store privately, extract, hash.** Private copy + extracted text with page markers, `rights_status=link_only` unless a grant exists, audit-log the decision with the policy version.
7. **Hand off to the Librarian.** Claims in our own words, each with a citation (page + short quote within policy limits). Drafts need human review; the database refuses to publish a claim without a citation.
8. **Re-check on a schedule.** Compare ETag/Last-Modified/hash; a changed file creates a new edition candidate and marks old claims for re-verification, never silently overwrites.
9. **Report what couldn't be done.** No source found = say so on the game page and offer the publisher-contact flow.

## Tools the Scout gets (least privilege)
`search_web`, `check_rights(url)`, `fetch_source(url)` (the gated fetcher), `list_links(page)`, `record_source(...)`, `propose_review_item(...)`. No database writes outside these, no shell, no raw HTTP.

## Open implementation items
- Wire steps 1-3 and 8 (search, link extraction, scheduled re-check) as agent tools; steps 4-6 already exist as code.
- Add the terms-of-use check as a tool that flags clauses for review, never as an auto-approval.
- Extend host allowlist through an approval item, not by the agent itself.

## Tooling pitfalls found while building
- `olares-cli cluster pod exec` appears to run each command twice. Never use it for non-idempotent actions in tests without a guard; all ingest/takedown endpoints must be idempotent.
