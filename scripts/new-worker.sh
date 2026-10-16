#!/usr/bin/env bash
# Create an isolated worker: worktree ../rogue-wt-<slug> on branch cc/<slug>, with a TASK.md skeleton to fill in.
# Usage: scripts/new-worker.sh <slug>
set -euo pipefail; SLUG="${1:?slug}"; cd "$(dirname "$0")/.."
WT="../rogue-wt-$SLUG"; git worktree add -b "cc/$SLUG" "$WT" main >/dev/null
# Share the main install but point @rogue/* at THIS worktree (a plain symlink made type checks see main'"'"'s old code).
mkdir -p "$WT/node_modules/@rogue"
for f in "$PWD"/node_modules/* "$PWD"/node_modules/.bin; do n=$(basename "$f"); [ "$n" = "@rogue" ] || ln -s "$f" "$WT/node_modules/$n" 2>/dev/null || true; done
ln -s ../../packages/core "$WT/node_modules/@rogue/core"; ln -s ../../apps/web "$WT/node_modules/@rogue/web"
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
