import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MAX_CHARS, botChallengePhrase, captureBookmarklet, captureFileType, captureHostWarning, captureLabel, checkCapturedText,
  gameNameFromPageTitle, parseCaptureForm, parseCapturePayload, splitCapturedText,
} from './capture.js';
import { splitPages } from './index/chunker.js';

const base = { game: 'pandemic', url: 'https://rules.example.com/pandemic#top', terms: 'yes' };

describe('parseCaptureForm', () => {
  it('accepts the minimum and fills defaults (community authority, host as title)', () => {
    const p = parseCaptureForm(base);
    expect(p.ok && p.value).toMatchObject({ url: 'https://rules.example.com/pandemic', host: 'rules.example.com', title: 'rules.example.com', language: 'en', kind: 'rulebook', authority: 'community', notes: null, hostWarned: false });
  });
  it('requires the terms box, a game and a public https link', () => {
    expect(parseCaptureForm({ ...base, terms: '' })).toEqual({ ok: false, code: 'terms' });
    expect(parseCaptureForm({ ...base, game: 'Bad Slug' })).toEqual({ ok: false, code: 'game' });
    for (const url of ['', 'http://rules.example.com/x', 'https://localhost/x', 'not a url']) expect(parseCaptureForm({ ...base, url })).toEqual({ ok: false, code: 'url' });
  });
  it('allows only the capture authorities, known languages and kinds', () => {
    for (const authority of ['publisher', 'community', 'forum', 'other']) expect(parseCaptureForm({ ...base, authority }).ok).toBe(true);
    for (const authority of ['official', 'author', 'x']) expect(parseCaptureForm({ ...base, authority })).toEqual({ ok: false, code: 'authority' });
    expect(parseCaptureForm({ ...base, language: 'fr' })).toEqual({ ok: false, code: 'language' });
    expect(parseCaptureForm({ ...base, kind: 'forum' })).toEqual({ ok: false, code: 'kind' });
  });
  it('limits title and notes', () => {
    expect(parseCaptureForm({ ...base, title: 'x'.repeat(121) })).toEqual({ ok: false, code: 'title' });
    expect(parseCaptureForm({ ...base, notes: 'x'.repeat(501) })).toEqual({ ok: false, code: 'notes' });
    const p = parseCaptureForm({ ...base, title: '  Pandemic   rules ', notes: ' saved from Firefox ' });
    expect(p.ok && [p.value.title, p.value.notes]).toEqual(['Pandemic rules', 'saved from Firefox']);
  });
  it('a warned host (officialgamerules.org, R36) needs its host name typed', () => {
    const url = 'https://www.officialgamerules.org/game-rules/pandemic';
    expect(parseCaptureForm({ ...base, url })).toEqual({ ok: false, code: 'host' });
    expect(parseCaptureForm({ ...base, url, hostConfirm: 'officialgamerules' })).toEqual({ ok: false, code: 'host' });
    for (const hostConfirm of ['officialgamerules.org', 'www.officialgamerules.org', ' OfficialGameRules.org ']) {
      const p = parseCaptureForm({ ...base, url, hostConfirm });
      expect(p.ok && p.value.hostWarned).toBe(true);
    }
  });
});

describe('captureHostWarning', () => {
  it('matches the host and its subdomains only', () => {
    expect(captureHostWarning('officialgamerules.org')?.host).toBe('officialgamerules.org');
    expect(captureHostWarning('WWW.officialgamerules.org')?.host).toBe('officialgamerules.org');
    expect(captureHostWarning('cdn.officialgamerules.org')).not.toBeNull();
    expect(captureHostWarning('notofficialgamerules.org')).toBeNull();
    expect(captureHostWarning('officialgamerules.org.evil.com')).toBeNull();
  });
});

describe('checkCapturedText', () => {
  it('refuses empty text', () => {
    for (const t of ['', '   \n', '\f\f', '=== page 1 ===\n  ']) expect(checkCapturedText(t)).toBe('empty');
  });
  it('refuses text over the cap', () => {
    expect(checkCapturedText('a'.repeat(CAPTURE_MAX_CHARS + 1))).toBe('toolarge');
  });
  it('refuses bot-check pages and says which phrase', () => {
    expect(checkCapturedText('Just a moment...\nEnable JavaScript and cookies to continue')).toBe('challenge');
    expect(botChallengePhrase('rules.example.com\nPerforming security verification\nThis website uses a security service')).toBe('Performing security verification');
    expect(botChallengePhrase('Please complete the CAPTCHA to continue.')).toBe('CAPTCHA');
    expect(botChallengePhrase('Verify you are human by completing the action below.')).toMatch(/verify you are human/i);
  });
  it('keeps a long real page that only mentions reCAPTCHA in its footer', () => {
    const page = `Setup\n${'Each player takes a role card and places their pawn in Atlanta. '.repeat(80)}\nThis site is protected by reCAPTCHA.`;
    expect(checkCapturedText(page)).toBeNull();
  });
});

describe('splitCapturedText', () => {
  it('one page when there are no page breaks', () => {
    const r = splitCapturedText('Setup\r\nPlace the board.\r\n');
    expect(r.pages).toBe(1);
    expect([...splitPages(r.text)]).toEqual([[1, 'Setup\nPlace the board.']]);
  });
  it('splits on form feeds and keeps page numbers when a page is empty', () => {
    const r = splitCapturedText('page one\fpage two\f \fpage four');
    expect(r.pages).toBe(4);
    expect([...splitPages(r.text)]).toEqual([[1, 'page one'], [2, 'page two'], [4, 'page four']]);
  });
  it('reads existing "=== page N ===" markers', () => {
    const r = splitCapturedText('=== page 1 ===\nIntro\n\n=== page 2 ===\nSetup');
    expect([...splitPages(r.text)]).toEqual([[1, 'Intro'], [2, 'Setup']]);
    expect(r.pages).toBe(2);
  });
});

describe('captureLabel and captureFileType', () => {
  it('labels manual captures only', () => {
    expect(captureLabel('manual_capture', 'Cory', new Date('2026-10-18T12:00:00Z'))).toBe('Manual capture by Cory on 2026-10-18');
    expect(captureLabel('manual_capture', null, null)).toBe('Manual capture by an unknown admin on an unknown date');
    expect(captureLabel(null, 'Cory', new Date())).toBeNull();
  });
  it('allows txt, md, html and pdf files only', () => {
    expect(captureFileType('Rules.TXT')).toBe('text/plain');
    expect(captureFileType('rules.md')).toBe('text/plain');
    expect(captureFileType('page.htm')).toBe('text/html');
    expect(captureFileType('rulebook.pdf')).toBe('application/pdf');
    for (const n of ['x.exe', 'x', 'x.pdf.js', 'x.docx']) expect(captureFileType(n)).toBeNull();
  });
});

describe('bookmarklet payload', () => {
  const ok = { type: 'rogue-capture', url: 'https://rules.example.com/pandemic', title: 'Pandemic', text: 'Setup', truncated: false };
  it('accepts a payload from the page it names', () => {
    expect(parseCapturePayload(ok, 'https://rules.example.com')).toEqual({ url: ok.url, title: 'Pandemic', text: 'Setup', truncated: false });
  });
  it('refuses a payload from another origin, the wrong shape or over the cap', () => {
    expect(parseCapturePayload(ok, 'https://evil.example.net')).toBeNull();
    expect(parseCapturePayload({ ...ok, type: 'other' }, 'https://rules.example.com')).toBeNull();
    expect(parseCapturePayload({ ...ok, url: 'nope' }, 'https://rules.example.com')).toBeNull();
    expect(parseCapturePayload('text', 'https://rules.example.com')).toBeNull();
    expect(parseCapturePayload({ ...ok, text: 'a'.repeat(CAPTURE_MAX_CHARS + 1) }, 'https://rules.example.com')).toBeNull();
  });
  it('the bookmarklet addresses only the Rogue origin and carries no token', () => {
    const b = captureBookmarklet('https://rogue.example.org/admin/games/x/sources');
    expect(b.startsWith('javascript:')).toBe(true);
    const js = decodeURIComponent(b.slice('javascript:'.length));
    expect(js).toContain('var R="https://rogue.example.org"');
    expect(js).toContain("w.postMessage(p,R)");
    expect(js).toContain("e.origin===R");
    expect(js).not.toMatch(/token|cookie/i);
    expect(() => new Function(js)).not.toThrow(); // valid JavaScript
  });
});

describe('gameNameFromPageTitle', () => {
  it('strips rules words, how-to-play phrases and site names', () => {
    const cases: [string, string, string][] = [
      ['How to Play Wingspan - Official Rules - UltraBoardGames', 'www.ultraboardgames.com', 'Wingspan'],
      ['Terraforming Mars Rules: How to Play | Official Game Rules', 'officialgamerules.org', 'Terraforming Mars'],
      ['Ark Nova Rules - officialgamerules.org', 'officialgamerules.org', 'Ark Nova'],
      ['Catan - Board Game', 'example.com', 'Catan'],
      ['Ticket to Ride Rules and FAQ', 'example.com', 'Ticket to Ride'],
      ['Pandemic: Iberia rulebook (PDF)', 'zmangames.com', 'Pandemic: Iberia'],
      ['Slay the Spire: The Board Game | Board Game | BoardGameGeek', 'boardgamegeek.com', 'Slay the Spire: The Board Game'],
      ['Rules | Root | Leder Games', 'ledergames.com', 'Root'],
      ['Spirit Island FAQ – Greater Than Games', 'greaterthangames.com', 'Spirit Island'],
      ['Azul', '', 'Azul'],
    ];
    for (const [title, host, name] of cases) expect([title, gameNameFromPageTitle(title, host)]).toEqual([title, name]);
  });
  it('gives an empty name when nothing is left', () => {
    expect(gameNameFromPageTitle('', 'x.com')).toBe('');
    expect(gameNameFromPageTitle('Rules', 'x.com')).toBe('');
    expect(gameNameFromPageTitle('x'.repeat(200)).length).toBe(80);
  });
});

describe('parseCaptureForm: add as new game', () => {
  const page = { url: 'https://officialgamerules.org/ark-nova', hostConfirm: 'officialgamerules.org', terms: 'yes' };
  it('takes the typed name, BGG id and year, and the slug the name gives', () => {
    const p = parseCaptureForm({ ...page, target: 'new', newGame: ' Ark  Nova ', newBggId: '342942', newYear: '2021', game: 'pandemic' });
    expect(p.ok && [p.value.game, p.value.newGame]).toEqual(['ark-nova', { name: 'Ark Nova', bggId: 342942, year: 2021 }]);
  });
  it('prefills the name from the page title when none is typed', () => {
    const p = parseCaptureForm({ ...page, target: 'new', title: 'Ark Nova Rules - officialgamerules.org' });
    expect(p.ok && p.value.newGame).toEqual({ name: 'Ark Nova', bggId: null, year: null });
  });
  it('a newGame name with no game picked means a new game; a picked game without target=new stays as is', () => {
    expect(parseCaptureForm({ ...page, newGame: 'Ark Nova' }).ok).toBe(true);
    const p = parseCaptureForm({ ...page, game: 'pandemic', newGame: 'Ark Nova' });
    expect(p.ok && [p.value.game, p.value.newGame]).toEqual(['pandemic', null]);
  });
  it('refuses a bad name, BGG id or year, and keeps the other checks', () => {
    expect(parseCaptureForm({ ...page, target: 'new', newGame: '!!' })).toEqual({ ok: false, code: 'newgame' });
    expect(parseCaptureForm({ ...page, target: 'new', title: 'Rules' })).toEqual({ ok: false, code: 'newgame' });
    expect(parseCaptureForm({ ...page, target: 'new', newGame: 'Ark Nova', newBggId: '12a' })).toEqual({ ok: false, code: 'bggid' });
    expect(parseCaptureForm({ ...page, target: 'new', newGame: 'Ark Nova', newYear: '1700' })).toEqual({ ok: false, code: 'year' });
    expect(parseCaptureForm({ ...page, target: 'new', newGame: 'Ark Nova', terms: '' })).toEqual({ ok: false, code: 'terms' });
    expect(parseCaptureForm({ ...page, target: 'new', newGame: 'Ark Nova', hostConfirm: '' })).toEqual({ ok: false, code: 'host' });
  });
});
