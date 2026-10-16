#!/usr/bin/env bash
# Create an isolated worker: worktree ../rogue-wt-<slug> on branch cc/<slug>, with a TASK.md skeleton to fill in.
# Usage: scripts/new-worker.sh <slug>
set -euo pipefail; SLUG="${1:?slug}"; cd "$(dirname "$0")/.."
WT="../rogue-wt-$SLUG"; git worktree add -b "cc/$SLUG" "$WT" main >/dev/null
ln -s "$PWD/node_modules" "$WT/node_modules" 2>/dev/null || true   # workers can run check without a fresh install
cat > "$WT/TASK.md" <<T
# Task: $SLUG
## Goal (one sentence)
## Files in scope (only these; list paths)
## Do NOT touch
docs/PROGRESS.md, docs/HANDOFF.md, version files, anything outside scope. Migration numbers: <assigned range>.
## Acceptance (commands that must pass)
scripts/qcheck.sh   (plus any targeted vitest file)
## Pattern to copy
<sibling file path>
## Final report (max 15 lines): files changed, tests added, check result, anything left.
T
echo "worker ready: $WT (branch cc/$SLUG). Fill $WT/TASK.md, then: scripts/run-worker.sh $SLUG"
