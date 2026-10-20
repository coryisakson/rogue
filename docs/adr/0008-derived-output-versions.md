# 0008. Derived output versions: one stamp per game, refreshed on every source change, no history

Status: accepted (Cory 2026-10-19: old versions are not kept)

## Context
The setup one-pager (`/games/<slug>/setup`) and the player aid (`/games/<slug>/aid`) are rendered per request from a game's published claims. Nothing tied them to the sources behind those claims: when the Space Base rulebook PDF (source 32) replaced a store page (source 11), no step reviewed the claims of the retired page, queued the Librarian for the new PDF, or told a reader that the printed sheet came from the old basis. A printed sheet also carried no way to tell which build it was.

## Decision
- One row per game in `game_outputs` (migration 0045): `version`, `built_at`, `basis_hash`, `basis`. The basis is the sorted list of the game's available sources with their content hash, plus the ids and count of its published claims; the hash is sha256 of it (`basisHash`, packages/core). The version goes up by one only when the hash changes (`nextVersion`). The row is overwritten in place; no history table.
- The check runs on every sheet/aid render (a first render backfills v1 without an audit line) and in `refreshDerivedOutputs(slug, reason)` (apps/web/src/lib/derived-outputs.ts), which audits `outputs_refreshed` with counts only.
- Every source-changing path calls the hook `sourcesChanged`: add, replace, re-ingest, runtime ingest, capture, wiki import end, source delete, recheck (changed or gone), accepted extract review. It queues the Librarian for an available rulebook with text that no published claim cites and that the Librarian has not finished (agents sidecar only), then refreshes. The Librarian end (agent job or in-process run) refreshes too.
- A retired or replaced source supersedes the claims whose only available evidence it was (`planSupersede`, the same rule as the source delete's `planClaimRejections`). The hard delete keeps rejecting such claims, since their citations are removed with the source.
- A sheet/aid with an undrafted new source says "Being updated" (small notice); it still prints.
- Footers carry `v<N> · <date> · <k> sources`.

## Alternatives
- Keep every version (history table, diff view): rejected by Cory; nobody reads old sheets, and the audit log already records each bump.
- Cache rendered sheets and invalidate: no cache exists; rendering is cheap.
- Block the sheet while stale: a partial but cited sheet is still useful at the table, so it is labelled, not hidden.

## Consequences
- The stamp lets a reader of a printed sheet compare it with the current version.
- Every claim change (Librarian, review, dedupe) bumps the version on the next render, also without a source change. That is intended: the sheet did change.
- Without the agents sidecar, a second rulebook is not drafted automatically; the in-process Librarian drafts the first rulebook when an admin starts it, so such a game may say "Being updated" until then.
