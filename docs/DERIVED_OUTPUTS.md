# Derived outputs: setup one-pager and player aid

Decision record: [ADR 0008](adr/0008-derived-output-versions.md).

## What is derived
- Setup one-pager: `/games/<slug>/setup` (`packages/core/src/sheet`).
- Player aid: `/games/<slug>/aid` (`packages/core/src/aid`).

Both are built on each request from the game's **published** claims. Each claim cites a source, so the outputs depend on the game's sources.

## When they are refreshed
`refreshDerivedOutputs(slug, reason)` (`apps/web/src/lib/derived-outputs.ts`) recomputes the basis (the game's available sources with their content hash, plus the published claim ids) and bumps the version if its hash changed. It runs:
- through the `sourcesChanged` hook, after a source is added, replaced, re-ingested, ingested from an admin link, captured, deleted or rechecked (changed or gone), after a wiki import ends and after an accepted extract review. The hook first queues the Librarian for a new rulebook it has not read (agents sidecar on);
- after the Librarian ends (agent job or in-process run);
- with the admin button "Rebuild one-pager and player aid" on `/admin/games/<slug>/sources`;
- on every render of the sheet or the aid (a game without a row gets v1 here, without an audit line).

A retired or replaced source supersedes the claims that cite only it (status `superseded`; claims that also cite another available source stay). A deleted source rejects them (its citations are gone).

## The stamp
Footer of the sheet and of each aid card, on screen and in print: `v<N> · <date> · <k> sources`
- `N`: version, +1 each time sources or published claims changed;
- `date`: when that version was built (UTC);
- `k`: number of available sources at that time.

"Being updated" appears when a new rulebook (or an admin-added link still in the pipeline) has no drafted claims yet. Printing still works.

The admin game overview (`/admin/games/<slug>`) shows the stored version, date and counts, and **STALE** when the basis hash now differs (the next render or refresh bumps it).

## No history
Only the current version is stored (`game_outputs`, one row per game, overwritten in place). Old versions are not kept (Cory 2026-10-19); the audit log (`outputs_refreshed`) records each refresh with counts only.
