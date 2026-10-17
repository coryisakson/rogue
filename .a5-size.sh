#!/usr/bin/env bash
# Temporary helper (not committed): gzip size of all client JS and CSS in the web build.
cd apps/web/dist/client || exit 1
for ext in js css; do
  printf '%s ' "$ext"
  find . -name "*.$ext" -exec cat {} + | gzip -9 | wc -c
done
