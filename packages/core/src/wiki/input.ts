import { parseWikiAuthority, type WikiAuthority } from '../addgame/authority.js';
import { SOURCE_LANGUAGES, parseSourceUrl, type SourceLanguage } from '../addgame/sources.js';
import { clampMaxPages } from './crawl.js';
import { parseWikiPageList } from './links.js';

/** The "Import from wiki" form on /admin/games/<slug>/sources, validated. */
export interface WikiImportInput {
  startUrl: string;
  mode: 'pages' | 'site';
  /** Mode 'pages': the pages to import (same host as startUrl). Empty for mode 'site'. */
  urls: string[];
  maxPages: number;
  language: SourceLanguage;
  /** Wiki owner or community name, shown as the publisher of every page. */
  publisher: string;
  /** Re-fetch pages fetched in the last 24 hours. */
  force: boolean;
  /** 'community' unless the admin attested "This wiki is the publisher's official documentation" (addgame/authority.ts). */
  authority: WikiAuthority;
}

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function parseWikiImport(f: Record<string, unknown>): { ok: true; value: WikiImportInput } | { ok: false; error: string } {
  const start = parseSourceUrl(f['startUrl'], 'Wiki start URL');
  if (!start.ok) return start;
  const mode = text(f['mode'], 8) === 'pages' ? 'pages' : 'site';
  const maxPages = clampMaxPages(f['maxPages']);
  const language = text(f['language'] || 'en', 8).toLowerCase();
  if (!(SOURCE_LANGUAGES as readonly string[]).includes(language)) return { ok: false, error: `Language must be one of ${SOURCE_LANGUAGES.join(', ')}.` };
  const publisher = text(f['publisher'], 80) || new URL(start.url).host;
  let urls: string[] = [];
  if (mode === 'pages') {
    const list = parseWikiPageList(String(f['pages'] ?? ''), start.url, maxPages);
    if (!list.ok) return list;
    urls = list.urls;
  }
  const authority = parseWikiAuthority(f);
  if (!authority.ok) return authority;
  return { ok: true, value: { startUrl: start.url, mode, urls, maxPages, language: language as SourceLanguage, publisher, force: f['force'] === 'yes', authority: authority.value } };
}

/** One edition per wiki host: all pages of a wiki are one "document set" of the game. */
export function wikiEditionLabel(host: string): string {
  return `Wiki: ${host}`;
}

/** Counts of a crawl, stored with the job and written to the audit log (counts and URLs only, never page text). */
export interface WikiCrawlCounts { ingested: number; skipped: number; failed: number; tombstoned: number; discovered: number }

export function wikiProgressText(c: WikiCrawlCounts, visited: number, maxPages: number, queued: number): string {
  return `page ${visited}/${maxPages}: ${c.ingested} imported, ${c.skipped} unchanged (<24h), ${c.failed} failed, ${c.tombstoned} taken down; ${queued} queued`;
}

/** HTTP answers that mean "stop crawling this site": refused (403) or rate limited (429). Never retried around. */
export function isWikiStopStatus(status: number | null | undefined): boolean {
  return status === 403 || status === 429;
}

/**
 * Many small wiki pages per game would swamp a source list: split them off so pages show one collapsed
 * "Wiki (N pages)" entry. Order inside each group is kept.
 */
export function splitWikiSources<T extends { kind?: string | null }>(sources: readonly T[]): { other: T[]; wiki: T[] } {
  return { other: sources.filter((s) => s.kind !== 'wiki'), wiki: sources.filter((s) => s.kind === 'wiki') };
}
