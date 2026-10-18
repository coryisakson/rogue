# Curation policy: what gets hidden, marked or removed

Decided with Cory 2026-10-15. Goal: no human monitoring. The system acts on rules; Cory sees exceptions.

| Situation | Action | Who decides |
|---|---|---|
| Source URL returns 404/410 | Mark `availability=unavailable` ("source no longer available"). **Never delete** the source or its claims. | Code (`recheckSource`) |
| Source file changed (hash differs) | Mark `changed`; claims citing it go to `needs_review` | Code, then Curator re-verifies |
| Source gone or changed | Curator periodically searches for a replacement (Scout playbook); users may suggest one (`source_suggestions`), which still goes through the rights gate | Curator + users |
| Takedown request | Arrives by hand (email/contact). Cory (or delegate) runs one command, see `docs/TAKEDOWN_RUNBOOK.md`. Purges private copy and text, blanks stored quotes, tombstones the URL, rejects dependent claims, logs it | Human trigger, code executes |
| Source is inaccurate (Cory 2026-10-18) | Admin deletes it on `/admin/sources` (Delete, repeat the id, give a reason). Hard delete in one transaction: sources row, documents, citations, chunks, agent jobs, rights grants, page quality/overrides, text variants, then the private PDF and extracted text. Facts cited only by it are rejected (`source deleted`); facts with other sources keep those. Chat answers and FAQ entries citing it stop being shown. The URL is tombstoned unless "allow re-ingest" is ticked. Audit log `source_deleted` (counts, no text) | Admin |
| Claim looks wrong | **Ratings first.** Low star ratings surface it for review and lower its rank. | Users |
| Claim proven wrong | Removed (`status=rejected`) only with a stored disproof: quote + source + locator, and verdicts from the checking models. A small local model may flag; a **frontier model must confirm** before rejection. | Curator, escalated |
| Unsure | Do nothing visible beyond `needs_review`; keep it, log it | Curator |

Principles
- Nothing is hard-deleted except what a takedown, a privacy erasure or an admin source delete requires.
- Rejection is reversible (row stays, reason and evidence stored).
- Where admins look (Cory 2026-10-18): `/admin/requests` lists only open requests (Accept, Reject, Open for details) and is the only admin search that adds new games (BoardGameGeek). An accepted game is followed on `/admin/games`: a search box over games already in Rogue (at least one source), the recently added or updated games, and one page per game (`/admin/games/<slug>`) with the request and its rights/terms verdicts, sources with chunk and embedding counts, extract notes, and the audit log for its links (fetched, extract_empty/failed, source_deleted, takedown). Changes (add, replace, re-ingest, delete) stay on `/admin/sources`, linked from the game page, so each gate exists once.
- Escalation ladder: local small model (cheap, flags) -> frontier model via Claude subscription (confirms) -> if still unsure, `needs_review` and a line in the weekly digest.
- The weekly digest (Discord) lists what changed and why; it asks nothing except for irreversible, high-impact items (removing a whole game, overriding a publisher opt-out).
