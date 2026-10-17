import { describe, expect, it } from 'vitest';
import { bggCollectionUrl, checkBggUsername, compareCollection, interpretBggCollection, parseBggCollectionCsv, parseCsv } from './collection.js';

describe('checkBggUsername', () => {
  it('accepts letters, digits, space, underscore and dash, trimmed', () => {
    expect(checkBggUsername('  cisakson ')).toEqual({ ok: true, username: 'cisakson' });
    expect(checkBggUsername('Board_Gamer-42  two')).toEqual({ ok: true, username: 'Board_Gamer-42 two' });
  });
  it('rejects empty, too long and other characters', () => {
    expect(checkBggUsername('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkBggUsername('a'.repeat(65))).toEqual({ ok: false, reason: 'too-long' });
    expect(checkBggUsername('cory@example.com')).toEqual({ ok: false, reason: 'bad-chars' });
    expect(checkBggUsername('https://boardgamegeek.com/user/cisakson')).toEqual({ ok: false, reason: 'bad-chars' });
  });
});

describe('bggCollectionUrl', () => {
  it('builds the owned board games URL with an encoded username', () => {
    expect(bggCollectionUrl('Some User')).toBe('https://boardgamegeek.com/xmlapi2/collection?username=Some%20User&own=1&subtype=boardgame');
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded commas/newlines, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"two\nlines",3\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '3']]);
  });
});

const EXPORT = [
  'objectname,objectid,rating,numplays,own,want,yearpublished,comment,itemtype',
  'Pandemic,30549,8,12,1,0,2008,"Great, co-op",standalone',
  '"Azul",230802,N/A,3,1,0,2017,,standalone',
  'Wingspan,266192,0,0,0,1,2019,wishlist only,standalone',
  'Broken,,0,0,1,0,2000,,standalone',
].join('\n');

describe('parseBggCollectionCsv', () => {
  it('keeps owned rows with id, name and year only', () => {
    const r = parseBggCollectionCsv(EXPORT);
    expect(r).toEqual({ ok: true, rows: 4, items: [
      { bggId: 30549, name: 'Pandemic', year: 2008 },
      { bggId: 230802, name: 'Azul', year: 2017 },
    ] });
  });
  it('keeps every row when there is no own column', () => {
    const r = parseBggCollectionCsv('objectid,objectname\n13,Catan\n13,Catan');
    expect(r).toEqual({ ok: true, rows: 2, items: [{ bggId: 13, name: 'Catan', year: null }] });
  });
  it('says clearly when the file is not a BGG export or owns nothing', () => {
    expect(parseBggCollectionCsv('name,price\nfoo,3')).toEqual({ ok: false, reason: 'not-bgg-csv' });
    expect(parseBggCollectionCsv('')).toEqual({ ok: false, reason: 'not-bgg-csv' });
    expect(parseBggCollectionCsv('objectid,objectname,own\n13,Catan,0')).toEqual({ ok: false, reason: 'no-owned' });
  });
});

const XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<items totalitems="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse" pubdate="Fri, 17 Oct 2026">
  <item objecttype="thing" objectid="30549" subtype="boardgame" collid="1">
    <name sortindex="1">Pandemic</name><yearpublished>2008</yearpublished>
    <status own="1" prevowned="0" fortrade="0" want="0" lastmodified="2026-01-01 00:00:00" />
  </item>
  <item objecttype="thing" objectid="9209" subtype="boardgame" collid="2">
    <name sortindex="1">Ticket to Ride &amp; Friends</name>
    <status own="1" />
  </item>
  <item objecttype="thing" objectid="42" subtype="boardgame" collid="3"><name sortindex="1">Gone</name><status own="0" /></item>
</items>`;

describe('interpretBggCollection', () => {
  it('reads owned items from the XML API answer', () => {
    expect(interpretBggCollection(200, XML)).toEqual({ kind: 'items', items: [
      { bggId: 30549, name: 'Pandemic', year: 2008 },
      { bggId: 9209, name: 'Ticket to Ride & Friends', year: null },
    ] });
    expect(interpretBggCollection(200, '<items totalitems="0"></items>')).toEqual({ kind: 'items', items: [] });
  });
  it('maps 202, unknown user and other failures', () => {
    expect(interpretBggCollection(202, '<message>Your request has been accepted</message>')).toEqual({ kind: 'queued' });
    expect(interpretBggCollection(200, '<errors><error><message>Invalid username specified</message></error></errors>')).toEqual({ kind: 'bad-username' });
    expect(interpretBggCollection(429, '')).toEqual({ kind: 'error', status: 429 });
    expect(interpretBggCollection(200, '<html>oops</html>')).toEqual({ kind: 'error', status: 200 });
  });
});

describe('compareCollection', () => {
  it('splits by games.bgg_id and sorts by name', () => {
    const items = [{ bggId: 9209, name: 'Ticket to Ride', year: 2004 }, { bggId: 230802, name: 'Azul', year: 2017 }, { bggId: 30549, name: 'Pandemic', year: 2008 }];
    const games = [{ bggId: 30549, slug: 'pandemic', name: 'Pandemic' }, { bggId: 230802, slug: 'azul', name: 'Azul' }, { bggId: 1, slug: 'x', name: 'X' }];
    expect(compareCollection(items, games)).toEqual({
      inRogue: [{ bggId: 230802, name: 'Azul', year: 2017, slug: 'azul' }, { bggId: 30549, name: 'Pandemic', year: 2008, slug: 'pandemic' }],
      notInRogue: [{ bggId: 9209, name: 'Ticket to Ride', year: 2004 }],
    });
  });
});
