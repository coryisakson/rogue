#!/usr/bin/env bash
# Fails if package.json, Chart.yaml and OlaresManifest.yaml versions drift. Run in CI before building the image.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
C=deploy/olares/rogue
PKG=$(grep -m1 '"version"' package.json | sed 's/.*"version": "\([^"]*\)".*/\1/')
CV=$(grep -m1 '^version:' $C/Chart.yaml | sed 's/^version: //')
CA=$(grep -m1 '^appVersion:' $C/Chart.yaml | sed 's/^appVersion: "\(.*\)"$/\1/')
MV=$(grep -m1 '^  version:' $C/OlaresManifest.yaml | sed 's/^  version: //')
MN=$(grep -m1 'versionName:' $C/OlaresManifest.yaml | sed 's/.*versionName: "\(.*\)"/\1/')
echo "package=$PKG chart=$CV appVersion=$CA manifest=$MV versionName=$MN"
for v in "$CV" "$CA" "$MV" "$MN"; do [[ "$v" == "$PKG" ]] || { echo "version mismatch"; exit 1; }; done
echo "versions consistent: $PKG"
