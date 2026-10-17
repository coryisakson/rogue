# Accessibility Conformance Report (VPAT 2.5, WCAG edition)

Product: Rogue public web pages. Standard: WCAG 2.2 A and AA. Method: self assessment from automated axe-core audits (see A1-audit.md and the contrast tests in the build) plus code review. **No manual screen-reader or keyboard pass yet (A7), so "Supports" below means "no known failure", not independently verified.**

| Criterion area | Level | Status | Notes |
|---|---|---|---|
| 1.1.1 Non-text content | A | Partially supports | Pages are mostly text; cut-out sheet duplicates hidden from AT. Alt-text review of every image pending. |
| 1.3.1 Info and relationships | A | Supports | Landmarks, headings, label pairing checked by tests. |
| 1.3.2 Meaningful sequence | A | Partially supports | Setup sheet reading order not yet manually reviewed. |
| 1.4.3 Contrast (minimum) | AA | Supports | A1 failures fixed in A2/A3; colour test in build. |
| 1.4.11 Non-text contrast | AA | Partially supports | Not separately measured. |
| 1.4.4 / 1.4.10 Resize and reflow | AA | Not evaluated | Mobile zoom pass pending. |
| 2.1.1 Keyboard | A | Not evaluated | Manual pass pending (A7). |
| 2.4.1 Bypass blocks | A | Supports | Skip link / main landmark. |
| 2.4.7 Focus visible | AA | Not evaluated | Manual pass pending. |
| 3.1.1 / 3.1.2 Language | A / AA | Supports | html lang follows the chosen language; non-English labels are machine-translated. |
| 3.3.2 Labels or instructions | A | Supports | Settings page label pairing tested. |
| 4.1.2 Name, role, value | A | Partially supports | Automated checks clean on audited pages; admin pages not fully audited. |

Print: high-contrast option for setup sheet and player aid (`?contrast=high`).
Contact: cory@isaksonfamily.net. Statement page: /accessibility.
