#!/usr/bin/env bash
# Run Claude Code on a worker worktree, quietly: full result stays in .cc-result.json, console gets ~25 lines.
# Usage: scripts/run-worker.sh <slug> [max_turns=40]   (use terminal background=true notify=true)
set -euo pipefail; SLUG="${1:?slug}"; cd "$(dirname "$0")/../../rogue-wt-$SLUG"
bash /opt/data/skills/software-development/claude-code-offload/scripts/cc_run.sh "$PWD" TASK.md "${2:-40}" > .cc-summary.txt 2>&1 || true
head -c 2500 .cc-summary.txt; echo; git log --oneline main..HEAD | head -10; git diff --stat main | tail -8
