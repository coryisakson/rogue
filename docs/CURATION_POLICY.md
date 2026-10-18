# Curation policy: what gets hidden, marked or removed

Decided with Cory 2026-10-15. Goal: no human monitoring. The system acts on rules; Cory sees exceptions.

| Situation | Action | Who decides |
|---|---|---|
| Source URL returns 404/410 | Mark `availability=unavailable` ("source no longer available"). **Never delete** the source or its claims. | Code (`recheckSource`) |
| Source file changed (hash differs) | Mark `changed`; claims citing it go to `needs_review` | Code, then Curator re-verifies |
| Source gone or changed | Curator periodically searches for a replacement (Scout playbook); users may suggest one (`source_suggestions`), which still goes through the rights gate | Curator + users |
| Takedown request | Arrives by hand (email/contact). Cory (or delegate) runs one command, see `docs/TAKEDOWN_RUNBOOK.md`. Purges private copy and text, blanks stored quotes, tombstones the URL, rejects dependent claims, logs it | Human trigger, code executes |
| Source is inaccurate (Cory 2026-10-18) | Admin deletes it on `/admin/games/<slug>/sources` (Delete, repeat the id, give a reason). Hard delete in one transaction: sources row, documents, citations, chunks, agent jobs, rights grants, page quality/overrides, text variants, then the private PDF and extracted text. Facts cited only by it are rejected (`source deleted`); facts with other sources keep those. Chat answers and FAQ entries citing it stop being shown. The URL is tombstoned unless "allow re-ingest" is ticked. Audit log `source_deleted` (counts, no text) | Admin |
| Claim looks wrong | **Ratings first.** Low star ratings surface it for review and lower its rank. | Users |
| Claim proven wrong | Removed (`status=rejected`) only with a stored disproof: quote + source + locator, and verdicts from the checking models. A small local model may flag; a **frontier model must confirm** before rejection. | Curator, escalated |
| Unsure | Do nothing visible beyond `needs_review`; keep it, log it | Curator |

Principles
- Nothing is hard-deleted except what a takedown, a privacy erasure, an admin source delete or an admin extract delete requires.
- Rejection is reversible (row stays, reason and evidence stored).
- Where admins look (Cory 2026-10-18): exactly two game sections. `/admin/requests` lists only open requests (Accept, Reject, Open for details) and is the only admin search that adds new games (BoardGameGeek). `/admin/games` is Rogue's content: a search box over games already in Rogue (at least one source, never offers "add") and the recently added or updated games. Each game has a read-only overview `/admin/games/<slug>`: text quality first (per source: average page score, scored and low-scoring pages, text-layer vs OCR pages, extract_empty/failed, chunks without embeddings, the worst pages linked to the viewer), then history, the request with its rights/terms verdicts, sources, extracts and the audit log for its links. Changes live on two Manage subpages, so each gate exists once: `/admin/games/<slug>/sources` (add, replace, re-ingest, delete a source) and `/admin/games/<slug>/extracts` (page viewer, markdown download, delete extract). The old `/admin/sources` and `/admin/extracts` URLs redirect there.
- Bad extraction (Cory 2026-10-18): admin uses Delete extract on `/admin/games/<slug>/extracts` (repeat the id, give a reason). Removes the extracted text, chunks, page quality, page overrides and text-version proposals, or only one page's chunks; keeps the sources row, private file, URL, documents and citations, so facts keep their source and the source shows as not extracted until re-ingested. Chat answers and FAQ entries citing it stop being shown. Audit log `extract_deleted` (counts, no text).
- Escalation ladder: local small model (cheap, flags) -> frontier model via Claude subscription (confirms) -> if still unsure, `needs_review` and a line in the weekly digest.
- The weekly digest (Discord) lists what changed and why; it asks nothing except for irreversible, high-impact items (removing a whole game, overriding a publisher opt-out).
