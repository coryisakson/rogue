#!/usr/bin/env bash
# Automated merge of a worker branch into main: rebase on latest main, re-run the full check, fast-forward, push.
# Usage: scripts/merge-branch.sh cc/<slug>     (run from the main worktree, /opt/data/repos/rogue)
set -euo pipefail
BR="${1:?branch name}"
cd "$(dirname "$0")/.."
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "run from the main worktree"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "main worktree not clean"; exit 1; }
WT="$(git worktree list --porcelain | awk -v b="refs/heads/$BR" '/^worktree /{w=$2} $0=="branch "b{print w}')"
[ -n "$WT" ] || { echo "no worktree for $BR"; exit 1; }
# Rebase inside the worker's worktree so conflicts show up there, not on main.
git -C "$WT" rebase main || { git -C "$WT" rebase --abort; echo "CONFLICT: rebase failed, branch left untouched"; exit 2; }
(cd "$WT" && npm run check) || { echo "CHECK FAILED on rebased $BR; not merged"; exit 3; }
git merge --ff-only "$BR"
set -a; . /opt/data/.env; set +a
git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)" push origin main
echo "merged $BR into main at $(git rev-parse --short HEAD)"
