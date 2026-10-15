#!/bin/sh
# OCR one PDF page: ocr-page.sh <file.pdf> <page>  -> text on stdout.
# Used via ROGUE_OCR_COMMAND. Needs pdftoppm (poppler-utils) and tesseract; exits 127 if either is missing.
set -eu
command -v pdftoppm >/dev/null 2>&1 && command -v tesseract >/dev/null 2>&1 || { echo "pdftoppm/tesseract not installed" >&2; exit 127; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pdftoppm -r 300 -f "$2" -l "$2" -png "$1" "$tmp/p"
img=$(ls "$tmp"/p*.png | head -n 1)
tesseract "$img" - -l "${ROGUE_OCR_LANGS:-eng}" 2>/dev/null
