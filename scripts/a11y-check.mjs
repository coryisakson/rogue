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

// 6. Theme colours (roadmap A3/A4): the shadcn variables in global.css meet WCAG 2.2 AA (4.5:1 text, 3:1 UI parts and
// focus ring) in both light (:root) and dark (.dark). Read from the CSS, so a pasted theme is checked without a browser.
const cssPath = join(WEB, 'styles/global.css');
const globalCss = readFileSync(cssPath, 'utf8');
// The body of the first `selector {` rule (variable blocks hold no nested braces).
function varBlock(selector) {
  const m = globalCss.match(new RegExp(`(?:^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  if (!m) { fail(cssPath, `variable block ${selector} not found`); return {}; }
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}
const themes = { light: varBlock(':root'), dark: varBlock('.dark') };

// oklch(L C h [/ alpha]) or #hex -> sRGB { r, g, b } in 0..255 plus a in 0..1 (CSS Color 4 maths, clipped to sRGB).
function parseColour(value) {
  const v = String(value ?? '').trim();
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = [0, 2, 4, 6].map((i) => (h.length > i ? parseInt(h.slice(i, i + 2), 16) : 255));
    return { r: n[0], g: n[1], b: n[2], a: n[3] / 255 };
  }
  const m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i);
  if (!m) return null;
  const L = Number(m[1]) / (m[2] ? 100 : 1), C = Number(m[3]), hue = (Number(m[4]) * Math.PI) / 180;
  const alpha = m[5] === undefined ? 1 : Number(m[5]) / (m[6] ? 100 : 1);
  const a = C * Math.cos(hue), b = C * Math.sin(hue);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const [r, g, bl] = lin.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  });
  return { r, g, b: bl, a: alpha };
}
// A see-through colour is judged as it looks: painted over what is below it.
const over = (top, below) => ({ r: top.r * top.a + below.r * (1 - top.a), g: top.g * top.a + below.g * (1 - top.a), b: top.b * top.a + below.b * (1 - top.a), a: 1 });
function luminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// [foreground, background, minimum ratio]. No exceptions list: every pair must pass in both modes.
const TEXT = 4.5, UI = 3;
const PAIRS = [
  ['--foreground', '--background', TEXT],
  ['--card-foreground', '--card', TEXT],
  ['--popover-foreground', '--popover', TEXT],
  ['--primary-foreground', '--primary', TEXT], // buttons
  ['--primary', '--background', TEXT], // links on the page
  ['--primary', '--card', TEXT], // links on cards
  ['--secondary-foreground', '--secondary', TEXT],
  ['--muted-foreground', '--background', TEXT],
  ['--muted-foreground', '--card', TEXT],
  ['--muted-foreground', '--muted', TEXT],
  ['--accent-foreground', '--accent', TEXT], // menu item hover
  ['--destructive-foreground', '--destructive', TEXT],
  ['--destructive', '--background', TEXT], // error text
  ['--destructive', '--card', TEXT],
  ['--sidebar-foreground', '--sidebar', TEXT], // site header
  ['--sidebar-primary-foreground', '--sidebar-primary', TEXT],
  ['--sidebar-accent-foreground', '--sidebar-accent', TEXT],
  ['--success-foreground', '--success', TEXT],
  ['--warning-foreground', '--warning', TEXT],
  ['--info-foreground', '--info', TEXT],
  ['--border', '--background', UI], // also the unselected rating star
  ['--border', '--card', UI],
  ['--input', '--background', UI],
  ['--input', '--card', UI],
  ['--ring', '--background', UI], // focus ring
  ['--ring', '--card', UI],
  ['--sidebar-ring', '--sidebar', UI], // focus ring in the header
];
const contrastReport = [];
for (const [theme, vars] of Object.entries(themes)) {
  for (const [fgName, bgName, min] of PAIRS) {
    const fgRaw = parseColour(vars[fgName]);
    const bgRaw = parseColour(vars[bgName]);
    if (!fgRaw || !bgRaw) { fail(cssPath, `${theme}: ${fgName} or ${bgName} is missing or not an oklch()/#hex colour`); continue; }
    // A see-through background is shown over the page background.
    const page = parseColour(vars['--background']) ?? { r: 255, g: 255, b: 255, a: 1 };
    const bg = bgRaw.a < 1 ? over(bgRaw, over(page, { r: 255, g: 255, b: 255, a: 1 })) : bgRaw;
    const ratio = contrast(over(fgRaw, bg), bg);
    contrastReport.push(`${theme} ${fgName} on ${bgName} ${ratio.toFixed(2)}`);
    if (ratio < min) fail(cssPath, `${theme}: ${fgName} on ${bgName} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
}
if (process.argv.includes('--verbose')) console.log(contrastReport.join('\n'));

// 7. No raw colours outside the variable blocks: components and pages use the variables (var(--card), bg-primary ...).
// Allowed: global.css's :root/.dark blocks, @media print blocks (paper is white), and .svg brand assets (not scanned).
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(astro|ts|tsx|css)$/.test(p) ? [p] : [];
  });
}
// Removes every `@media print { ... }` block (with its nested rules) so its colours are not reported.
function withoutPrintBlocks(src) {
  let out = src;
  for (let i = out.indexOf('@media print'); i !== -1; i = out.indexOf('@media print')) {
    let depth = 0, j = out.indexOf('{', i);
    for (; j < out.length; j++) {
      if (out[j] === '{') depth++;
      else if (out[j] === '}' && --depth === 0) break;
    }
    out = out.slice(0, i) + out.slice(j + 1);
  }
  return out;
}
const RAW_COLOUR = [
  /(?<=[\s:(,])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b(?![\w-])/gi, // #hex in a CSS value
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi, // colour functions
  /\b(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke)\s*:\s*[^;"'}]*?\b(?:white|black|gr[ae]y|red|green|blue|yellow|orange|silver)\b/gi, // named colours
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|accent|caret)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g, // Tailwind palette classes
  /-\[#[0-9a-f]{3,8}\]/gi, // Tailwind arbitrary colours, e.g. bg-[#fff]
];
for (const file of sourceFiles(WEB)) {
  let src = withoutPrintBlocks(readFileSync(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  if (file === cssPath) src = src.replace(/(?:^|\n)\s*(?::root|\.dark)\s*\{[^}]*\}/g, ''); // the variable blocks
  for (const re of RAW_COLOUR) {
    const hit = src.match(re);
    if (hit) fail(file, `raw colour "${hit[0]}": use a theme variable from global.css (docs/THEMING.md)`);
  }
}

if (problems.length) {
  console.error(`a11y-check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('a11y-check OK');
