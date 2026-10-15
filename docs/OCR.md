# OCR for scanned PDFs

Ingest (`apps/web/src/lib/ingest.ts`) extracts text with `unpdf`. Pages with fewer than 40 letters/digits
(`needsOcr` in `packages/core/src/ocr`) are treated as scanned.

## Behaviour
- **No provider configured** (`ROGUE_OCR_COMMAND` unset): ingestion is unchanged; the `fetched` audit_log detail gets `pagesWithoutText: [..]`.
- **Provider configured**: each flagged page is OCR'd and its text replaces the empty text. Audit detail gets `ocr: true`, `ocrPages`, `pagesWithoutText` (pages still empty) and up to 3 `ocrErrors`. A failing page never fails ingestion.
- No schema change.

## Configuration (env)
| Var | Meaning | Default |
|---|---|---|
| `ROGUE_OCR_COMMAND` | Executable (no shell), called as `<cmd> <file.pdf> <page>`; prints page text on stdout | unset = off |
| `ROGUE_OCR_TIMEOUT_MS` | Per-page timeout | 60000 |
| `ROGUE_OCR_MAX_INPUT_BYTES` | Max PDF size passed to the command | 100 MiB |
| `ROGUE_OCR_MAX_OUTPUT_BYTES` | Max text accepted per page | 1 MiB |
| `ROGUE_OCR_LANGS` | Tesseract languages for `scripts/ocr-page.sh` | `eng` |

## Pluggable
`OcrProvider` (`recognizePage({ pdf, pageNumber }) -> text`) lives in `packages/core`; `NoopOcrProvider` and `CommandOcrProvider` ship. Any other engine (a hosted or local-model OCR) can be added as another provider or as a wrapper command.

## Docker image
`scripts/ocr-page.sh` renders the page with `pdftoppm` and reads it with `tesseract`. The Dockerfile installs
`poppler-utils tesseract-ocr tesseract-ocr-data-eng` (Alpine, tens of MB) and sets `ROGUE_OCR_COMMAND=/app/scripts/ocr-page.sh`.
Extra languages: add `tesseract-ocr-data-deu` etc. and set `ROGUE_OCR_LANGS=eng+deu`. On Debian/Ubuntu:
`apt-get install -y poppler-utils tesseract-ocr`. If the binaries are absent the wrapper exits 127, pages stay empty and are listed in `pagesWithoutText`.
To disable OCR in a deployment, set `ROGUE_OCR_COMMAND=` (empty).
