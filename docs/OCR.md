# OCR for scanned PDFs

Ingest (`apps/web/src/lib/ingest.ts`) extracts text with `unpdf`. Pages with fewer than 40 letters/digits
(`needsOcr` in `packages/core/src/ocr`) are treated as scanned.

## Which pages are OCR'd (`ROGUE_OCR_MODE`)
A clean PDF text layer is exact, so it is preferred over OCR; OCR is for pages that are empty or garbled.
`textLayerQuality` / `pickPagesForOcr` (`packages/core/src/ocr/text-layer.ts`) score each page 0..1. A page scores 0 when
it has fewer than 40 letters/digits; otherwise the score is 1 minus the worst of these penalties: replacement/private-use
glyphs (`bad-glyphs`), mostly symbols (`symbols`), mostly single-letter tokens like "T h e" (`spaced-out`), few word-like
tokens (`few-words`). The word checks are skipped on mostly-CJK pages. Pages below 0.5 are OCR'd.
- `auto` (default): OCR only empty or garbled pages, keep every clean text layer.
- `all`: OCR every page (the old ForceOCR behaviour). `ROGUE_OCR_ALL_PAGES=1` still means `all` when `ROGUE_OCR_MODE` is unset.
- `off`: never call OCR.

`ROGUE_OCR_MODE` wins over `ROGUE_OCR_ALL_PAGES`. The Olares chart still sets only `ROGUE_OCR_ALL_PAGES`; switching
production to `auto` is a later decision after measuring. Measure a PDF with `node scripts/textlayer-report.mjs <file.pdf>`
(per page: letters/digits, score, decision; counts only, no text).

**Measured 2026-10-18** (`textlayer-report.mjs`, public rulebook PDFs): Slay the Spire 24 pp: 23 clean text layers, 1 empty (cover) -> OCR 1. Azul EN 6 pp: 5 clean, 1 empty cover. Pandemic sample 1 pp clean. So `auto` would skip OCR on ~95% of pages for these text-born PDFs. Open question before switching the chart: does text-layer order and heading structure retrieve as well as MinerU output (compare Ask evals with `ROGUE_OCR_MODE=auto` vs `all` on one game). Scanned PDFs untested (none in the set).

## Extract review (unsure pages, ADR 0005/0007)
After a PDF ingest, code (`pagesNeedingExtractReview`, core) flags pages it is unsure about: garbled but not empty, text layer and OCR
disagree (word overlap < 0.5), table-like, or very short. With the agents on, the Reviewer agent (skill `extract_review`) compares
both readings per page and proposes `text_layer`, `ocr` or a `merge`; `acceptPageChoice` rejects any merge with words or numbers absent
from both readings, a dropped number both agree on, or a length outside +/-30% of the longer reading. Accepted choices are page
overrides (method `extract`, provenance in `page_extract`), so the index is rebuilt from them. Both readings are rebuilt on demand
(text layer re-read from the private PDF; OCR run per page when ingest kept the text layer, at most 8 per job); nothing extra is
stored or served. Admin button: "Review unsure pages with the Extractor" on `/admin/games/<slug>/extracts?source=<id>`. Agents off:
nothing runs and the page says so. OCR defaults are unchanged.

## Behaviour
- **No provider configured** (`ROGUE_OCR_COMMAND` unset): text layers are used as they are; the audit detail still records the scores and `pagesWithoutText`.
- **Provider configured**: each picked page is OCR'd and its text replaces the text layer when OCR returns text. A failing page keeps its text layer and never fails ingestion.
- The `fetched` audit_log detail gets `ocrMode`, `ocr` (any page OCR'd), `ocrPages` (pages whose text came from OCR), `textLayerPages`, `pageSource` (per page `text`/`ocr`), `textLayerScores` (per page, of the original text layer), `pagesWithoutText` (pages still empty after OCR) and up to 3 `ocrErrors`.
- No schema change.

## Choosing the engine (configurable, like the model and storage providers)
`ROGUE_OCR_PROVIDER` = `none` | `command` | `http`. If unset: `http` when `ROGUE_OCR_BASE_URL` is set, else `command` when `ROGUE_OCR_COMMAND` is set, else `none`.
- **http** (e.g. PaddleOCR on Olares): set `ROGUE_OCR_BASE_URL` (service root; the request goes to `<base>/layout-parsing`) and optionally `ROGUE_OCR_API_KEY` (sent as `Authorization: Bearer`). Speaks the PaddleOCR/PaddleX serving API: `POST /layout-parsing {file: <base64 PDF>, fileType: 0}`, reads `result.layoutParsingResults[i].markdown.text`. The whole PDF is sent once per document and pages come from that one response. In the Olares chart set `rogueOcrBaseUrl` / `rogueOcrApiKey` values (deployment env `ROGUE_OCR_BASE_URL` / `ROGUE_OCR_API_KEY`). Verified live (2026-10-15) against the PaddleOCR-VL service on Olares (a 2-page image-only PDF came back correct in 2 s). That service has no /ocr route, only /layout-parsing and /restructure-pages.
- **mineru** (default since 0.0.86): `ROGUE_OCR_PROVIDER=mineru`, `ROGUE_OCR_BASE_URL` = MinerU API root (`mineru-kit api-server`; Olares entrance `mineruapi`, host from `olares-cli settings apps get mineru`). One `POST /v1/file_parse?tier=advanced&ocr_mode=ocr&output_formats=structured_content` per PDF (tier `advanced` = MinerU's xhigh hybrid effort; `ocr` = ForceOCR, ignores the PDF text layer); a 202 is polled via `/v1/tasks/<id>/result`. Reads `files[0].content.structured_content.pages[].blocks[]` (NOT `items`, unlike the MinerU docs): headers, footers, page numbers and images are dropped, titles become `##`, tables stay as text. Env: `ROGUE_MINERU_TIER`, `ROGUE_MINERU_OCR_MODE`, and `ROGUE_OCR_MODE` (see above; `ROGUE_OCR_ALL_PAGES=1` is the older alias for `all`). Measured 2026-10-16: Pandemic (8 pp) 19 s, Slay the Spire (24 pp) 25 s.
- **command** (built-in lightweight, tesseract in the image): `ROGUE_OCR_COMMAND`, see below. It stays as the fallback and for desktop use.
- **none**: off.

## Configuration (env)
| Var | Meaning | Default |
|---|---|---|
| `ROGUE_OCR_COMMAND` | Executable (no shell), called as `<cmd> <file.pdf> <page>`; prints page text on stdout | unset = off |
| `ROGUE_OCR_PROVIDER` | `none`/`command`/`http` | auto, see above |
| `ROGUE_OCR_MODE` | `auto` (OCR empty/garbled pages), `all` (every page), `off` | `auto` |
| `ROGUE_OCR_ALL_PAGES` | Older alias: `1` = `ROGUE_OCR_MODE=all` when that is unset | unset |
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
