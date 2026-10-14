#!/usr/bin/env bash
# Deploy Rogue to Olares. Pattern copied from web-olares/scripts/deploy.sh (see docs/DEPLOY.md).
#   scripts/deploy.sh                 deploy the version in package.json (image must already be on Docker Hub)
#   scripts/deploy.sh --version X.Y.Z deploy/rollback to a specific published version
# Never uninstalls; upgrades in place when already installed. Run on a host with olares-cli logged in.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
APP=rogue; ROUTE=rogue; HUB=cisakson/rogue; C=deploy/olares/rogue
VER=$(grep -m1 '"version"' package.json | sed 's/.*"version": "\([^"]*\)".*/\1/')
[[ "${1:-}" == "--version" ]] && VER="$2"

echo "Deploying $APP $VER"
curl -fsS "https://hub.docker.com/v2/repositories/$HUB/tags/$VER" -o /dev/null || { echo "Image $HUB:$VER not on Docker Hub; wait for CI"; exit 1; }

if [[ "$VER" != "$(grep -m1 '^version:' $C/Chart.yaml | sed 's/^version: //')" ]]; then
  # rollback path: sync chart to the requested version in a temp copy, never committed
  TMP=$(mktemp -d); cp -r "$C" "$TMP/$APP"; C="$TMP/$APP"
  sed -i "s/^version: .*/version: $VER/; s/^appVersion: .*/appVersion: \"$VER\"/" $C/Chart.yaml
  sed -i "s/^  version: .*/  version: $VER/; s/versionName: \".*\"/versionName: \"$VER\"/" $C/OlaresManifest.yaml
fi

olares-cli chart lint "$C"
OUT=$(mktemp -d)
olares-cli chart package "$C" -o "$OUT"
TGZ="$OUT/$APP-$VER.tgz"
[[ -f "$TGZ" ]] || { echo "chart package not found: $TGZ"; exit 1; }
olares-cli market upload "$TGZ"

if olares-cli market status $APP &>/dev/null; then
  olares-cli market upgrade $APP -s upload --version "$VER"
else
  olares-cli market install $APP -s upload --version "$VER"
fi

for i in $(seq 1 60); do
  S=$(olares-cli market status $APP 2>&1 | grep '^State:' | awk '{print $2}' || true)
  [[ "$S" == "running" && $i -gt 2 ]] && { echo "running"; break; }
  sleep 5
done
[[ "$S" == "running" ]] || { echo "not running after wait (state=$S)"; exit 1; }

olares-cli settings apps domain set $APP $APP --third-level $ROUTE   # hard gate, per astro-olares-app skill
olares-cli settings apps auth-level set $APP $APP --level "${ROGUE_AUTH_LEVEL:-private}" || echo "auth-level set failed (non-fatal)"
echo "Deployed. Verify: scripts/verify.sh"
