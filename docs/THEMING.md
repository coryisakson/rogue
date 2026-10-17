# Theming (shadcn/ui)

Rogue uses the standard shadcn/ui theme system: Tailwind v4 + CSS variables, dark mode = `.dark` on `<html>`.

## Where colours live
`apps/web/src/styles/global.css`, and only there:
- `:root` = light, `.dark` = dark (inside `@media screen`, so print is always light).
- Standard variables (`--background`, `--primary`, `--card`, `--sidebar-*` ...) plus Rogue's extras:
  `--success`, `--warning`, `--info` (+ `-foreground`) and `--destructive-foreground`.
- `@theme inline` maps them to Tailwind classes (`bg-primary`, `text-muted-foreground`).
- `rogue.css` holds the hand-written classes (`.btn`, `.card`, `.pill` ...), which read these variables only.

## Switch to another theme
1. Pick one from shadcn themes or tweakcn and copy its CSS.
2. Replace the values inside `:root { }` and `.dark { }`. Keep Rogue's extras and `color-scheme`.
3. Run `node scripts/a11y-check.mjs --verbose`. It checks every main pair in both modes (4.5:1 text, 3:1 borders and
   focus ring) and lists the ratios. Adjust until it says OK.

## Add a component
From `apps/web`: `npx shadcn@latest add button` (or `add @registry/name`). Files land in `src/components/ui/`
and are ours to edit. Use it in an `.astro` page as a React island: `<MyThing client:idle />`, only where it needs
JavaScript. Static content stays plain Astro.

## Rules
- No raw colours in components, pages or styles: no `#hex`, `rgb()`, `oklch()`, `white`, `bg-red-500`.
  Use `var(--card)` or `bg-card`. `npm run check` fails on raw colours outside the variable blocks
  (`@media print` blocks and `.svg` files are allowed).
- A new colour role goes into `:root`, `.dark` and `@theme inline` together, plus a pair in the a11y check.
