# A1 accessibility audit (axe-core, WCAG 2.0/2.1/2.2 A+AA)

Run 2026-10-17 against the live site (0.0.101), headless Chrome, public pages only. Audit only, no fixes yet. Lighthouse not run; axe covers automated WCAG rules, manual keyboard/screen-reader checks still open.

| Page | Violations |
|---|---|
| / | color-contrast (serious, 6 nodes) |
| /about | color-contrast (serious, 2 nodes) |
| /games | color-contrast (serious, 2 nodes) |
| /games/pandemic | color-contrast (serious, 4 nodes) |
| /games/pandemic/setup | none |
| /games/slay-the-spire | color-contrast (serious, 4 nodes) |
| /login | color-contrast (serious, 5 nodes) |

## Example failing elements (first node per page)
- /: `a[href="/login?next=%2F"]` (Elements must meet minimum color contrast ratio thresholds)
- /about: `a[href="/login?next=%2Fabout"]` (Elements must meet minimum color contrast ratio thresholds)
- /games: `a[href="/login?next=%2Fgames"]` (Elements must meet minimum color contrast ratio thresholds)
- /games/pandemic: `span > a` (Elements must meet minimum color contrast ratio thresholds)
- /games/slay-the-spire: `span > a` (Elements must meet minimum color contrast ratio thresholds)
- /login: `a[href="/login?next=%2Flogin"]` (Elements must meet minimum color contrast ratio thresholds)

## Finding
Only colour contrast fails (2-6 elements per page). Fix in A2/A3 by adjusting muted text tokens to reach 4.5:1. Not yet audited: admin pages, chat, dark theme, keyboard order, focus visibility, mobile zoom.
