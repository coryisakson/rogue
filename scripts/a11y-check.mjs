#!/usr/bin/env node
// Static accessibility checks on the Astro templates (roadmap A2). No browser and no dependencies: it reads the
// source files and fails on the regressions that are easy to spot by text. Axe on the live site still covers the rest.
// Usage: node scripts/a11y-check.mjs   (part of `npm run check`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WEB = join(ROOT, 'apps/web/src');
const problems = [];
const fail = (file, msg) => problems.push(`${relative(ROOT, file)}: ${msg}`);

function astroFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? astroFiles(p) : p.endsWith('.astro') ? [p] : [];
  });
}

// The markup part of an .astro file (after the --- frontmatter), without <style> and <script> blocks.
function markup(src) {
  const body = src.startsWith('---') ? src.slice(src.indexOf('---', 3) + 3) : src;
  return body.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
}

// 1. Base layout: lang follows the chosen language, and the skip link is the first thing in <body>.
const basePath = join(WEB, 'layouts/Base.astro');
const base = readFileSync(basePath, 'utf8');
if (!/<html lang=\{L\}>/.test(base)) fail(basePath, '<html> must take lang from the resolved locale ({L})');
const afterBody = base.slice(base.indexOf('<body>') + 6).replace(/<!--[\s\S]*?-->/g, '').trimStart();
if (!/^<a class="skip-link" href="#main">/.test(afterBody)) fail(basePath, 'the skip link to #main must be the first element in <body>');
const css = readFileSync(join(WEB, 'styles/rogue.css'), 'utf8');
if (!/\.skip-link:focus/.test(css)) fail(join(WEB, 'styles/rogue.css'), 'the skip link must become visible on focus');

// 2. Every page rendered with a layout has the <main id="main"> the skip link points to (admin pages get it from Admin.astro).
const admin = readFileSync(join(WEB, 'layouts/Admin.astro'), 'utf8');
if (!admin.includes('<main id="main"')) fail(join(WEB, 'layouts/Admin.astro'), 'missing <main id="main">');
for (const file of astroFiles(join(WEB, 'pages'))) {
  const src = readFileSync(file, 'utf8');
  const html = markup(src);
  if (/<Base[\s>]/.test(html) && !html.includes('<main id="main"')) fail(file, 'page uses Base but has no <main id="main">');
  checkControls(file, html);
  checkHeadings(file, html, /<Admin[\s>]/.test(html) ? 1 : 0);
  checkTables(file, html);
}
for (const file of astroFiles(join(WEB, 'layouts'))) checkControls(file, markup(readFileSync(file, 'utf8')));

// 3. Form controls need an accessible name: aria-label(ledby), a <label for=id>, or a wrapping <label>.
function checkControls(file, html) {
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="(hidden|submit)"/.test(attrs) || /aria-label(ledby)?=/.test(attrs)) continue;
    const id = attrs.match(/\bid=(?:"([^"]+)"|\{(\w+)\})/);
    if (id && (html.includes(`for="${id[1]}"`) || html.includes(`for={${id[2]}}`))) continue;
    const before = html.slice(0, m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
    fail(file, `<${m[1]}${attrs.slice(0, 50)}> has no label`);
  }
  // Buttons whose visible text is only symbols or emoji (★, 👍) need words for screen readers.
  for (const m of html.matchAll(/<button\b([^>]*)>([^<{]*)<\/button>/g)) {
    if (!/\p{L}|\p{N}/u.test(m[2]) && !/aria-label=/.test(m[1])) fail(file, `icon-only button "${m[2].trim()}" needs aria-label`);
  }
}

// 4. Headings never skip a level going down (h1 -> h3). Admin pages start below the layout's h1.
function checkHeadings(file, html, start) {
  let prev = start;
  for (const m of html.matchAll(/<h([1-6])\b/g)) {
    const level = Number(m[1]);
    if (level > prev + 1) fail(file, `heading jumps from h${prev} to h${level}`);
    prev = level;
  }
}

// 5. Data tables: a caption, and header cells say what they head.
function checkTables(file, html) {
  for (const m of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)) {
    if (!/<caption\b/.test(m[1])) fail(file, 'table without <caption>');
    for (const th of m[1].matchAll(/<th\b([^>]*)>/g)) if (!/scope=/.test(th[1])) { fail(file, '<th> without scope'); break; }
  }
}

// 6. Colour tokens (roadmap A3): every text/background pair meets WCAG 2.2 AA (4.5:1 text, 3:1 UI parts) in both themes.
// The token blocks are read from rogue.css, so a colour change there is checked here without a browser.
const cssPath = join(WEB, 'styles/rogue.css');
// The first rule with exactly this selector (at the start of a line) that defines colour tokens.
function tokenBlock(selector) {
  const re = new RegExp(`^\\s*${selector.replace(/[[\]().:"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'gm');
  const body = [...css.matchAll(re)].map((m) => m[1]).find((b) => b.includes('--color-bg:'));
  if (!body) { fail(cssPath, `token block ${selector} not found`); return {}; }
  return Object.fromEntries([...body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}
const themes = {
  light: tokenBlock(':root'),
  dark: tokenBlock(':root[data-theme="dark"]'),
};
const darkMedia = tokenBlock(':root:not([data-theme="light"])');
const print = tokenBlock(':root:root');
if (JSON.stringify(darkMedia) !== JSON.stringify(themes.dark)) fail(cssPath, 'the prefers-color-scheme dark block and [data-theme="dark"] differ');
if (JSON.stringify(print) !== JSON.stringify(themes.light)) fail(cssPath, 'the print token block must repeat the light colours');

// #rgb, #rgba, #rrggbb, #rrggbbaa -> { r, g, b, a } with a in 0..1.
function parseHex(value) {
  let h = String(value).replace('#', '');
  if (!/^[0-9a-f]{3,8}$/i.test(h)) return null;
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const [r, g, b, a = 255] = [0, 2, 4, 6].map((i) => (h.length > i ? parseInt(h.slice(i, i + 2), 16) : undefined)).filter((n) => n !== undefined);
  return { r, g, b, a: a / 255 };
}
// A see-through colour (pills, borders) is judged as it looks: painted over what is below it.
const over = (top, below) => ({ r: top.r * top.a + below.r * (1 - top.a), g: top.g * top.a + below.g * (1 - top.a), b: top.b * top.a + below.b * (1 - top.a), a: 1 });
function luminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// [foreground, background(s) from top to bottom, minimum ratio]. Backgrounds may be see-through layers over the last one.
const PAIRS = [
  ['--color-text', ['--color-bg'], 4.5],
  ['--color-text', ['--color-bg-raised'], 4.5],
  ['--color-muted', ['--color-bg'], 4.5],
  ['--color-accent', ['--color-bg'], 4.5], // links and focus ring on the page
  ['--color-header-text', ['--color-header-bg'], 4.5],
  ['--color-on-surface', ['--color-surface'], 4.5],
  ['--color-link-on-surface', ['--color-surface'], 4.5],
  ['--color-btn-text', ['--color-btn-bg'], 4.5],
  ['--color-btn-text', ['--color-secondary'], 4.5],
  ['--color-on-secondary', ['--color-secondary'], 4.5],
  ['--color-btn-text', ['--color-btn-danger'], 4.5],
  ['--color-on-surface', ['--color-pill', '--color-surface'], 4.5],
  ['--color-on-surface', ['--color-pill-ok', '--color-surface'], 4.5],
  ['--color-on-surface', ['--color-pill-warn', '--color-surface'], 4.5],
  ['--color-on-surface', ['--color-pill-bad', '--color-surface'], 4.5],
  ['--color-text', ['--color-pill-bad', '--color-bg'], 4.5], // admin tab badges sit on the page
  ['--color-accent', ['--color-surface'], 3], // focus ring around controls on cards
  ['--color-icon-off', ['--color-surface'], 3], // unselected rating star
];
// Light is the pre-A3 look, kept pixel-identical on purpose; these pairs already failed before the tokens and need a
// design decision (tracked for the next a11y pass). Dark has no exceptions.
const LIGHT_KNOWN_FAILS = new Set([
  '--color-btn-text on --color-btn-danger',
  '--color-accent on --color-surface',
  '--color-icon-off on --color-surface',
]);
const contrastReport = [];
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fgName, bgNames, min] of PAIRS) {
    const layers = bgNames.map((n) => parseHex(tokens[n]));
    const fgRaw = parseHex(tokens[fgName]);
    if (!fgRaw || layers.includes(null)) { fail(cssPath, `${theme}: ${fgName} or ${bgNames.join('/')} is not a hex colour`); continue; }
    const bg = layers.reduceRight((below, top) => (below ? over(top, below) : top), null);
    const ratio = contrast(over(fgRaw, bg), bg);
    const name = `${fgName} on ${bgNames.join('/')}`;
    if (ratio >= min) continue;
    if (theme === 'light' && LIGHT_KNOWN_FAILS.has(name)) { contrastReport.push(`${theme} ${name} ${ratio.toFixed(2)} (known)`); continue; }
    fail(cssPath, `${theme}: ${name} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
}
// A known failure that now passes should leave the list, so the list never hides a regression.
for (const name of LIGHT_KNOWN_FAILS) if (!contrastReport.some((r) => r.includes(` ${name} `))) fail(cssPath, `light: "${name}" passes now, remove it from LIGHT_KNOWN_FAILS`);
if (process.argv.includes('--verbose')) console.log(contrastReport.join('\n'));

if (problems.length) {
  console.error(`a11y-check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('a11y-check OK');
