#!/usr/bin/env bash
# Usage: scripts/bump-version.sh [major|minor|patch]  (default patch). Syncs package.json, Chart.yaml, OlaresManifest.yaml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
C=deploy/olares/rogue
CUR=$(grep -m1 '"version"' package.json | sed 's/.*"version": "\([^"]*\)".*/\1/')
IFS=. read -r MA MI PA <<< "$CUR"
case "${1:-patch}" in
  major) MA=$((MA+1)); MI=0; PA=0;;
  minor) MI=$((MI+1)); PA=0;;
  patch) PA=$((PA+1));;
  *) echo "usage: $0 [major|minor|patch]"; exit 1;;
esac
NEW="$MA.$MI.$PA"
sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$NEW\"/" package.json
sed -i "s/^version: .*/version: $NEW/; s/^appVersion: .*/appVersion: \"$NEW\"/" $C/Chart.yaml
sed -i "s/^  version: .*/  version: $NEW/; s/versionName: \".*\"/versionName: \"$NEW\"/" $C/OlaresManifest.yaml
echo "$CUR -> $NEW"
bash scripts/check-versions.sh
