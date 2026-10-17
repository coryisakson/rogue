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

if (problems.length) {
  console.error(`a11y-check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('a11y-check OK');
