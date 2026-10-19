# 0005. Extractor agent, separate from Scout

Status: accepted 2026-10-19 (Cory). Built as a skill of the Reviewer agent, see ADR 0007, not as a separate process.

## Context
Scout only finds and judges sources. Extraction (PDF text layer, OCR, markdown, chunking) is plain code in `packages/core` (ocr/, markdown/, ingest). Per-page text-layer/OCR selection (`ROGUE_OCR_MODE=auto`) shipped in 0.0.126; measured ~95% of pages in text-born PDFs have clean text layers. Plain code cannot judge things like: reading order across columns, rules split into sidebars, tables, icon-only text, wrong-language pages, or a page that is an ad.

## Decision (proposed)
- New agent `extractor` (sidecar/agents/extractor.md, own port) running as a background `extract_review` job, per ADR 0002 (website never waits on AI).
- Input: one ingested source with its per-page text, the quality score and the OCR/text-layer choice per page. Tools (propose-only): `get_job`, `get_page(source, page)` (text-layer text and OCR text side by side), `propose_page_choice(page, text_layer|ocr|merge, reason)`, `propose_structure(page, headings/table fixes)`, `finish_job`.
- Code decides: it re-checks that proposed text only uses words present in one of the two candidate texts (no invented content), applies the choice, records provenance (`extractor:<model>`), re-chunks and re-embeds. Rights gate and citations are unchanged.
- Trigger: only for pages where the scorer is unsure (garbled-but-nonempty, tables, text layer and OCR disagree strongly). Clean pages skip the agent, so cost stays small.

## Consequences
- Needs the auto-vs-all Ask eval comparison first, to know whether the agent is worth its cost.
- One new job kind, one new agent port, one migration for per-page provenance. No change to the public site.

## As built (2026-10-19)
- Runs as the Reviewer's skill `extract_review` (ADR 0007), not as its own port. Tools: `get_job`, `get_page`, `propose_page_choice`, `finish_job`; `propose_structure` is not built (structure fixes stay with the Quality Curator for now).
- Code: `pagesNeedingExtractReview` and `acceptPageChoice` in `packages/core/src/quality/extract.ts`; `apps/web/src/lib/extractor-run.ts`; migration 0044 (`page_extract`, page_overrides method `extract`). Provenance string `extractor:<reason>`.
- Triggers: after a PDF ingest (agents on) and the admin button on the extract viewer. Details in docs/OCR.md.
