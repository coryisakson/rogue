import { describe, expect, it } from 'vitest';
import { htmlAdapter, decodeEntities } from './html.js';
import { selectAdapter, UnsupportedSourceError, type SourceAdapter } from './types.js';
import { splitPages } from '../index/chunker.js';

// Fixture: a typical publisher FAQ page with chrome around the content.
const FIXTURE = `<!doctype html><html><head><title>Pandemic FAQ &amp; Errata</title>
<style>.x{color:red}</style><script>var tracking = "SECRET_SCRIPT";</script></head>
<body>
<header><nav><ul><li>Home</li><li>Shop</li></ul></nav></header>
<div role="navigation">Breadcrumb junk</div>
<main>
  <p>Official answers to common questions.</p>
  <h1>Setup</h1>
  <p>Deal 2 cards to each player in a <b>4-player</b> game.</p>
  <h2>Epidemics</h2>
  <ul><li>Shuffle the infection discard pile.</li><li>Place it on top &mdash; not below.</li></ul>
  <h2>Empty heading</h2>
  <h2 id="x">Events <span>&amp; Roles</span></h2>
  <p>The Contingency Planner can store one event.</p>
  <div aria-hidden="true">hidden promo</div>
  <!-- comment text -->
</main>
<aside>Newsletter signup</aside>
<footer>Copyright Publisher</footer>
<script>alert("SECRET_SCRIPT2")</script>
</body></html>`;
const bytes = (s: string) => new TextEncoder().encode(s);

describe('htmlAdapter', () => {
  it('extracts readable text and removes boilerplate', async () => {
    const r = await htmlAdapter.extract(bytes(FIXTURE), 'text/html; charset=utf-8');
    for (const junk of ['SECRET_SCRIPT', 'color:red', 'Home', 'Shop', 'Breadcrumb', 'hidden promo', 'Newsletter', 'Copyright', 'comment text']) {
      expect(r.text).not.toContain(junk);
    }
    expect(r.text).toContain('Deal 2 cards to each player in a 4-player game.');
    expect(r.text).toContain('- Shuffle the infection discard pile.');
    expect(r.text).toContain('Place it on top — not below.');
  });

  it('splits one section per heading block with locators, compatible with splitPages', async () => {
    const r = await htmlAdapter.extract(bytes(FIXTURE), 'text/html');
    expect(r.locators).toEqual([
      'section: Pandemic FAQ & Errata', // text before the first heading uses the page title
      'section: Setup',
      'section: Epidemics',
      'section: Events & Roles', // empty "Empty heading" block is dropped
    ]);
    expect(r.pageCount).toBe(4);
    const pages = splitPages(r.text);
    expect([...pages.keys()]).toEqual([1, 2, 3, 4]);
    expect(pages.get(4)).toContain('Contingency Planner');
    expect(pages.get(1)).toContain('Official answers');
  });

  it('falls back to the whole body when there is no <main>, still dropping nav/footer', async () => {
    const r = await htmlAdapter.extract(bytes('<body><nav>menu</nav><h1>Rules</h1><p>Roll the die.</p><footer>f</footer></body>'), 'text/html');
    expect(r.text).toContain('Roll the die.');
    expect(r.text).not.toContain('menu');
  });

  it('handles nested skipped tags', async () => {
    const r = await htmlAdapter.extract(bytes('<main><nav><nav>inner</nav>still nav</nav><p>Keep me.</p></main>'), 'text/html');
    expect(r.text).toContain('Keep me.');
    expect(r.text).not.toContain('still nav');
  });

  it('rejects non-html content types and unreadable bodies', async () => {
    expect(htmlAdapter.canHandle('application/pdf')).toBe(false);
    await expect(htmlAdapter.extract(bytes('%PDF-1.7'), 'application/pdf')).rejects.toBeInstanceOf(UnsupportedSourceError);
    await expect(htmlAdapter.extract(bytes('just plain words'), 'text/html')).rejects.toBeInstanceOf(UnsupportedSourceError);
    await expect(htmlAdapter.extract(bytes('<html><body><script>x</script></body></html>'), 'text/html')).rejects.toBeInstanceOf(UnsupportedSourceError);
  });

  it('decodes entities', () => {
    expect(decodeEntities('a&nbsp;b &#65; &#x42; &unknown;')).toBe('a b A B &unknown;');
  });
});

describe('selectAdapter', () => {
  const pdf: SourceAdapter = { name: 'pdf', extension: 'pdf', canHandle: (c) => c.includes('pdf'), extract: async () => ({ text: '', pageCount: 0, locators: [] }) };
  it('selects by content-type and returns undefined for unknown types', () => {
    expect(selectAdapter([pdf, htmlAdapter], 'application/pdf')?.name).toBe('pdf');
    expect(selectAdapter([pdf, htmlAdapter], 'Text/HTML; charset=utf-8')?.name).toBe('html');
    expect(selectAdapter([pdf, htmlAdapter], 'image/png')).toBeUndefined();
  });
});
