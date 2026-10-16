#!/usr/bin/env bash
# Quiet `npm run check`: full output goes to a log file, only a verdict + the failing lines reach the console.
# Usage: scripts/qcheck.sh [dir=.]   Log: $TMPDIR/rogue-check.log
cd "${1:-.}"; LOG="${TMPDIR:-/tmp}/rogue-check-$(basename "$PWD").log"
if npm run check >"$LOG" 2>&1; then
  echo "CHECK OK ($(grep -Eo 'Tests +[0-9]+ passed[^)]*' "$LOG" | tail -1)) log=$LOG"
else
  echo "CHECK FAILED log=$LOG"; grep -nE 'error|FAIL|✗|×|AssertionError' "$LOG" | head -20; exit 1
fi
