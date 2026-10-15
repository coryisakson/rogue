# Curation policy: what gets hidden, marked or removed

Decided with Cory 2026-10-15. Goal: no human monitoring. The system acts on rules; Cory sees exceptions.

| Situation | Action | Who decides |
|---|---|---|
| Source URL returns 404/410 | Mark `availability=unavailable` ("source no longer available"). **Never delete** the source or its claims. | Code (`recheckSource`) |
| Source file changed (hash differs) | Mark `changed`; claims citing it go to `needs_review` | Code, then Curator re-verifies |
| Source gone or changed | Curator periodically searches for a replacement (Scout playbook); users may suggest one (`source_suggestions`), which still goes through the rights gate | Curator + users |
| Takedown request | Arrives by hand (email/contact). Cory (or delegate) runs one command, see `docs/TAKEDOWN_RUNBOOK.md`. Purges private copy and text, blanks stored quotes, tombstones the URL, rejects dependent claims, logs it | Human trigger, code executes |
| Claim looks wrong | **Ratings first.** Low star ratings surface it for review and lower its rank. | Users |
| Claim proven wrong | Removed (`status=rejected`) only with a stored disproof: quote + source + locator, and verdicts from the checking models. A small local model may flag; a **frontier model must confirm** before rejection. | Curator, escalated |
| Unsure | Do nothing visible beyond `needs_review`; keep it, log it | Curator |

Principles
- Nothing is hard-deleted except what a takedown or privacy erasure requires.
- Rejection is reversible (row stays, reason and evidence stored).
- Escalation ladder: local small model (cheap, flags) -> frontier model via Claude subscription (confirms) -> if still unsure, `needs_review` and a line in the weekly digest.
- The weekly digest (Discord) lists what changed and why; it asks nothing except for irreversible, high-impact items (removing a whole game, overriding a publisher opt-out).
