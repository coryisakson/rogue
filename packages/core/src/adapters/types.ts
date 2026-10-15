/**
 * Source adapters turn a fetched publisher document into page-split plain text for the Librarian.
 * Why an interface: PDFs, HTML pages (FAQ/errata) and later formats share one ingest path, and provider/library
 * choices (e.g. the PDF parser) stay out of core. Output uses "=== page N ===" markers so citations keep working.
 */
export interface ExtractedSource {
  /** Text with "=== page N ===" markers, one section per page (PDF) or per heading block (HTML). */
  text: string;
  /** Number of "pages" (sections for HTML). */
  pageCount: number;
  /** Human-readable locator per page, index 0 = page 1 (e.g. the heading text for HTML, "page 1" for PDF). */
  locators: string[];
  /** Extra facts for the audit log (e.g. which pages were OCR'd). */
  notes?: Record<string, unknown>;
}

export interface SourceAdapter {
  readonly name: string;
  /** File extension for the private copy, without dot. */
  readonly extension: string;
  canHandle(contentType: string): boolean;
  extract(bytes: Uint8Array, contentType: string): Promise<ExtractedSource>;
}

/** Thrown when bytes do not match what the content-type promised (or nothing readable was found). */
export class UnsupportedSourceError extends Error {}

/** Pick the first adapter that accepts the content-type; undefined means "do not ingest". */
export function selectAdapter(adapters: SourceAdapter[], contentType: string): SourceAdapter | undefined {
  return adapters.find((a) => a.canHandle(contentType.toLowerCase()));
}
