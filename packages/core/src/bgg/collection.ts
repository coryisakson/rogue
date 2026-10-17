/**
 * BGG collection, pure parts: check a BGG username, read the user's own CSV export or the XML API2 answer,
 * and compare the result with the games Rogue indexes (matched by games.bgg_id).
 * BGG rules (docs/BGG_NOTES.md): store only what the feature needs (id, name, year), never re-expose it to other apps.
 */
import { decodeEntities } from '../adapters/html.js';

/** One owned game: only what the comparison needs. */
export interface BggItem { bggId: number; name: string; year: number | null }

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: 'empty' | 'too-long' | 'bad-chars' };

/** BGG usernames are letters, digits, spaces, underscores and dashes. Trims and collapses inner spaces first. */
export function checkBggUsername(raw: string): UsernameCheck {
  const username = raw.trim().replace(/\s+/g, ' ');
  if (!username) return { ok: false, reason: 'empty' };
  if (username.length > 64) return { ok: false, reason: 'too-long' };
  if (!/^[A-Za-z0-9 _-]+$/.test(username)) return { ok: false, reason: 'bad-chars' };
  return { ok: true, username };
}

/** The XML API2 collection URL: owned board games of one user (boardgamegeek.com without www, per BGG). */
export function bggCollectionUrl(username: string): string {
  return `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1&subtype=boardgame`;
}

/** Splits CSV text into rows. Handles quoted fields, doubled quotes, commas and newlines inside quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export type CsvResult = { ok: true; items: BggItem[]; rows: number } | { ok: false; reason: 'not-bgg-csv' | 'no-owned' };

const toYear = (s: string | undefined): number | null => {
  const n = Number((s ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Reads the CSV a user exports from their BGG collection page (columns objectid, objectname, yearpublished, own, ...).
 * Keeps owned rows only when an `own` column exists; other columns are ignored and never stored.
 */
export function parseBggCollectionCsv(text: string): CsvResult {
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, reason: 'not-bgg-csv' };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iId = col('objectid'), iName = col('objectname'), iYear = col('yearpublished'), iOwn = col('own');
  if (iId < 0 || iName < 0) return { ok: false, reason: 'not-bgg-csv' };
  const byId = new Map<number, BggItem>();
  for (const r of body) {
    if (iOwn >= 0 && (r[iOwn] ?? '').trim() !== '1') continue;
    const bggId = Number((r[iId] ?? '').trim());
    const name = (r[iName] ?? '').trim();
    if (!Number.isSafeInteger(bggId) || bggId < 1 || !name) continue;
    byId.set(bggId, { bggId, name: name.slice(0, 200), year: iYear >= 0 ? toYear(r[iYear]) : null });
  }
  if (!byId.size) return { ok: false, reason: 'no-owned' };
  return { ok: true, items: [...byId.values()], rows: body.length };
}

/** What a BGG API answer means for us. 202 = BGG is preparing the collection: retry later. */
export type BggApiResult =
  | { kind: 'items'; items: BggItem[] }
  | { kind: 'queued' }
  | { kind: 'bad-username' }
  | { kind: 'error'; status: number };

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Interprets the HTTP status and XML body of a collection request. Regex-based: the XML shape is small and fixed. */
export function interpretBggCollection(status: number, body: string): BggApiResult {
  if (status === 202) return { kind: 'queued' };
  // BGG answers an unknown user with <errors><error><message>Invalid username specified</message></error></errors>.
  if (/<error>[\s\S]*invalid username/i.test(body)) return { kind: 'bad-username' };
  if (status !== 200 || !/<items[\s>]/.test(body)) return { kind: 'error', status };
  const byId = new Map<number, BggItem>();
  for (const m of body.matchAll(/<item\s([^>]*)>([\s\S]*?)<\/item>/g)) {
    const bggId = Number(attr(` ${m[1]}`, 'objectid'));
    const inner = m[2] ?? '';
    const name = decodeEntities(/<name[^>]*>([\s\S]*?)<\/name>/.exec(inner)?.[1] ?? '').trim();
    const status = /<status\s[^>]*>/.exec(inner)?.[0];
    if (status && attr(status, 'own') === '0') continue;
    if (!Number.isSafeInteger(bggId) || bggId < 1 || !name) continue;
    byId.set(bggId, { bggId, name: name.slice(0, 200), year: toYear(/<yearpublished>(\d+)<\/yearpublished>/.exec(inner)?.[1]) });
  }
  return { kind: 'items', items: [...byId.values()] };
}

/** A Rogue game with a BGG id. */
export interface RogueGameRef { bggId: number; slug: string; name: string }
export interface CollectionComparison { inRogue: (BggItem & { slug: string })[]; notInRogue: BggItem[] }

/** Splits a collection into games Rogue has (by BGG id) and games not in Rogue yet; both sorted by name. */
export function compareCollection(items: BggItem[], games: RogueGameRef[]): CollectionComparison {
  const bySlug = new Map(games.map((g) => [g.bggId, g.slug]));
  const byName = (a: BggItem, b: BggItem) => a.name.localeCompare(b.name);
  const inRogue: (BggItem & { slug: string })[] = [];
  const notInRogue: BggItem[] = [];
  for (const it of items) {
    const slug = bySlug.get(it.bggId);
    if (slug) inRogue.push({ ...it, slug }); else notInRogue.push(it);
  }
  return { inRogue: inRogue.sort(byName), notInRogue: notInRogue.sort(byName) };
}
