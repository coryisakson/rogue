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
