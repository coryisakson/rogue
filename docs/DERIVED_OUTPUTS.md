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

## Review and update (one run per game)
The card "Review and update" on `/admin/games/<slug>/sources` starts a background run (`apps/web/src/lib/game-update.ts`, table `game_updates`, migration 0046). "Review and update everything" runs all steps; single steps can be ticked. Steps, always in this order:
1. **recheck**: lifecycle recheck of each source not checked in the last 24 h (manual captures and retired sources are not fetched; a host that refuses or errors is not asked again in that run; never past a bot wall);
2. **ingest**: re-ingest (forced, same rights gate and tombstone check) each available source without extracted text, then index it;
3. **extract**: Extractor review of unsure pages of each PDF source (waits up to 30 min per job; skipped when the agents are off);
4. **draft**: Librarian on each available rulebook or wiki source that no claim cites yet (with **redraft** ticked: on all of them; waits up to 2 h per job; skipped when the agents are off);
5. **supersede**: claims whose only evidence is a retired or unavailable source become `superseded` (`supersedeSoleSourceClaims`);
6. **rebuild**: `refreshDerivedOutputs(slug, 'review-update')`.

Each step records ok / skipped / failed and one line. One run per game at a time; the step list is saved after every step, so a restart resumes at the unfinished step. **Stop** ends the run after the source or wait it is on (agent jobs already queued carry on). Audit: `game_update_started` / `game_update_finished` with counts only. The game overview shows "Last update: <date>, <status>". Pure parts (step selection, order, progress text, drafting rule): `packages/core/src/game-update.ts`.

## The stamp
Footer of the sheet and of each aid card, on screen and in print: `v<N> · <date> · <k> sources`
- `N`: version, +1 each time sources or published claims changed;
- `date`: when that version was built (UTC);
- `k`: number of available sources at that time.

"Being updated" appears when a new rulebook (or an admin-added link still in the pipeline) has no drafted claims yet. Printing still works.

The admin game overview (`/admin/games/<slug>`) shows the stored version, date and counts, and **STALE** when the basis hash now differs (the next render or refresh bumps it).

## No history
Only the current version is stored (`game_outputs`, one row per game, overwritten in place). Old versions are not kept (Cory 2026-10-19); the audit log (`outputs_refreshed`) records each refresh with counts only.
