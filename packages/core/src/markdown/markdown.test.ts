import { describe, expect, it } from 'vitest';
import { escapeHtml, renderInline, renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders headings, bold and italic', () => {
    expect(renderMarkdown('# Setup\n## Cards')).toBe('<h1>Setup</h1>\n<h2>Cards</h2>');
    expect(renderInline('**Draw** two *cards* and _discard_')).toBe('<strong>Draw</strong> two <em>cards</em> and <em>discard</em>');
  });

  it('does not italicise snake_case words or lone asterisks', () => {
    expect(renderInline('max_players and 2 * 3')).toBe('max_players and 2 * 3');
  });

  it('renders bullet and numbered lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. first\n2) second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('renders a MinerU pipe table with a header', () => {
    const html = renderMarkdown('| Players | Cards |\n| --- | :---: |\n| 2 | 4 |\n| 3 | 3 |');
    expect(html).toBe('<table><thead><tr><th>Players</th><th>Cards</th></tr></thead><tbody><tr><td>2</td><td>4</td></tr><tr><td>3</td><td>3</td></tr></tbody></table>');
  });

  it('renders a table without a header rule as body rows, keeping escaped pipes', () => {
    expect(renderMarkdown('| a \\| b | c |')).toBe('<table><tbody><tr><td>a | b</td><td>c</td></tr></tbody></table>');
  });

  it('joins paragraph lines with <br> and splits paragraphs on blank lines', () => {
    expect(renderMarkdown('line one\nline two\n\nnext')).toBe('<p>line one<br>line two</p>\n<p>next</p>');
  });

  it('keeps inline code literal', () => {
    expect(renderInline('`**x**`')).toBe('<code>**x**</code>');
  });
});

describe('renderMarkdown safety', () => {
  it('escapes script tags and HTML attributes', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n| <b>x</b> |');
    expect(html).not.toMatch(/<script|<img|<b>/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;alert(1)&quot;');
  });

  it('never turns javascript: links into anchors', () => {
    const html = renderMarkdown('[click](javascript:alert(1)) and <a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/<a\b|href="javascript/i);
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;');
  });

  it('escapes markup inside headings, list items and bold', () => {
    const html = renderMarkdown('# <svg onload=x>\n- **<iframe>**');
    expect(html).toBe('<h1>&lt;svg onload=x&gt;</h1>\n<ul><li><strong>&lt;iframe&gt;</strong></li></ul>');
  });

  it('escapeHtml covers all five special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});
