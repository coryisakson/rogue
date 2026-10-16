# OCR for scanned PDFs

Ingest (`apps/web/src/lib/ingest.ts`) extracts text with `unpdf`. Pages with fewer than 40 letters/digits
(`needsOcr` in `packages/core/src/ocr`) are treated as scanned.

## Behaviour
- **No provider configured** (`ROGUE_OCR_COMMAND` unset): ingestion is unchanged; the `fetched` audit_log detail gets `pagesWithoutText: [..]`.
- **Provider configured**: each flagged page is OCR'd and its text replaces the empty text. Audit detail gets `ocr: true`, `ocrPages`, `pagesWithoutText` (pages still empty) and up to 3 `ocrErrors`. A failing page never fails ingestion.
- No schema change.

## Choosing the engine (configurable, like the model and storage providers)
`ROGUE_OCR_PROVIDER` = `none` | `command` | `http`. If unset: `http` when `ROGUE_OCR_BASE_URL` is set, else `command` when `ROGUE_OCR_COMMAND` is set, else `none`.
- **http** (e.g. PaddleOCR on Olares): set `ROGUE_OCR_BASE_URL` (service root; the request goes to `<base>/layout-parsing`) and optionally `ROGUE_OCR_API_KEY` (sent as `Authorization: Bearer`). Speaks the PaddleOCR/PaddleX serving API: `POST /layout-parsing {file: <base64 PDF>, fileType: 0}`, reads `result.layoutParsingResults[i].markdown.text`. The whole PDF is sent once per document and pages come from that one response. In the Olares chart set `rogueOcrBaseUrl` / `rogueOcrApiKey` values (deployment env `ROGUE_OCR_BASE_URL` / `ROGUE_OCR_API_KEY`). Verified live (2026-10-15) against the PaddleOCR-VL service on Olares (a 2-page image-only PDF came back correct in 2 s). That service has no /ocr route, only /layout-parsing and /restructure-pages.
- **mineru** (default since 0.0.86): `ROGUE_OCR_PROVIDER=mineru`, `ROGUE_OCR_BASE_URL` = MinerU API root (`mineru-kit api-server`; Olares entrance `mineruapi`, host from `olares-cli settings apps get mineru`). One `POST /v1/file_parse?tier=advanced&ocr_mode=ocr&output_formats=structured_content` per PDF (tier `advanced` = MinerU's xhigh hybrid effort; `ocr` = ForceOCR, ignores the PDF text layer); a 202 is polled via `/v1/tasks/<id>/result`. Reads `files[0].content.structured_content.pages[].blocks[]` (NOT `items`, unlike the MinerU docs): headers, footers, page numbers and images are dropped, titles become `##`, tables stay as text. Env: `ROGUE_MINERU_TIER`, `ROGUE_MINERU_OCR_MODE`, and `ROGUE_OCR_ALL_PAGES=1` to OCR every page, not only pages with no text layer. Measured 2026-10-16: Pandemic (8 pp) 19 s, Slay the Spire (24 pp) 25 s.
- **command** (built-in lightweight, tesseract in the image): `ROGUE_OCR_COMMAND`, see below. It stays as the fallback and for desktop use.
- **none**: off.

## Configuration (env)
| Var | Meaning | Default |
|---|---|---|
| `ROGUE_OCR_COMMAND` | Executable (no shell), called as `<cmd> <file.pdf> <page>`; prints page text on stdout | unset = off |
| `ROGUE_OCR_PROVIDER` | `none`/`command`/`http` | auto, see above |
| `ROGUE_OCR_BASE_URL` | PaddleOCR-compatible service root (http provider) | unset |
| `ROGUE_OCR_API_KEY` | Optional bearer key for the http provider | unset |
| `ROGUE_OCR_TIMEOUT_MS` | Timeout (command: per page 60000; http: whole document 300000) | see left |
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
