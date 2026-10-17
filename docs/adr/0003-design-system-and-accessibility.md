# ADR 0003: design system (shadcn/ui) and accessibility (Section 508 / WCAG 2.2 AA)

Status: proposed (Cory 2026-10-16: "shadcn might serve us well for longer term"). Becomes accepted when the pilot passes.

## Context
The web app is Astro 7 SSR with one hand-written stylesheet (`apps/web/src/styles/rogue.css`), inline styles and vanilla-JS widgets. There is no component library. Section 508 incorporates WCAG 2.0 A/AA; buyers now ask for WCAG 2.1/2.2 AA plus an ACR (VPAT). A library does not make a site compliant; the finished pages are judged.

## Decision
- Target: WCAG 2.2 AA on all public pages and the admin area; publish an ACR.
- Design system: shadcn/ui (Radix primitives + Tailwind CSS). Radix supplies focus management, keyboard handling and ARIA for dialogs, menus, selects and tabs. Cost: React islands inside Astro (`@astrojs/react`), hydrated only where a widget needs it (`client:visible`/`client:idle`); static content stays plain Astro with Tailwind classes so pages stay fast.
- Fallback if React islands prove too heavy: Zag.js or Ark UI (framework-agnostic, same behaviours) with Tailwind.
- Migrate incrementally behind the existing class names; no big-bang rewrite.

## Consequences
Adds React, Tailwind and Radix dependencies and a build step for islands. Components are copied into the repo (`apps/web/src/components/ui`) and owned by us. Tokens (colour, spacing, type) replace the inline styles, which makes contrast fixes one-place changes.

## A4 result (2026-10-17, pilot)
- Installed per the official Astro guide: Tailwind v4 (`@tailwindcss/vite`), `@astrojs/react`, React 19, `shadcn` CLI
  (`init -t astro -b radix -p nova`, then `add card badge input textarea select dropdown-menu`). `components.json`,
  `cn` in `src/lib/utils.ts`, components in `src/components/ui/`.
- Theme: the standard shadcn variables in `styles/global.css` (`:root` light, `.dark` dark) plus `--success`,
  `--warning`, `--info`, `--destructive-foreground`. Old names (`--color-*`, `--gold` ...) are gone; `rogue.css` reads
  only shadcn variables. Light became a parchment table (the old light theme had dark pages with light cards, which
  shadcn's card-like-background model cannot express, and 3 failing pairs). All 27 pairs pass AA in both modes.
- Tailwind Preflight is off (documented split import) so hand-written pages render as before; a scoped reset
  covers the shadcn components (`[data-slot]`).
- Islands: language switch (shadcn Select; no-JS form fallback kept) and theme switch (DropdownMenu). The chat box
  stays vanilla JS (queue, aria-live, page-memory thread; porting it risked regressions).

Gzip JS per page (inline scripts + island chunks + Astro island runtime):

| Page | Before | After |
|---|---|---|
| Home | 1.2 KB | 124 KB |
| Game chat | 4.4 KB | 128 KB |

121 KB of that is one set of hashed chunks (React DOM 65 KB, Radix/lucide 36 KB) shared by every page, cached after
the first visit and loaded at `client:idle`, so it does not block first paint. CSS grew from about 2.5 KB to 7.6 KB gzip.

Verdict: **accept** the shadcn theming (variables, CLI, contrast and raw-colour checks): it costs no JS. **Accept
islands with a budget**: use them only where a widget needs Radix behaviour (menus, dialogs, comboboxes); plain
controls stay Astro. If a Lighthouse budget fails, revisit with Preact compat or native controls.
