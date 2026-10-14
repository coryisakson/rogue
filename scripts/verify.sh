#!/usr/bin/env bash
# Post-deploy monitoring: app state on Olares + /healthz version matches package.json.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
VER=$(grep -m1 '"version"' package.json | sed 's/.*"version": "\([^"]*\)".*/\1/')
URL="${ROGUE_URL:-https://rogue.cisakson.olares.com}"
olares-cli market status rogue || true
BODY=$(curl -fsS -m 15 "$URL/healthz") && echo "$BODY" && echo "$BODY" | grep -q "\"version\":\"$VER\"" && echo "OK: $VER live" || { echo "FAIL: $URL/healthz does not report $VER (auth-level private returns login page)"; exit 1; }
