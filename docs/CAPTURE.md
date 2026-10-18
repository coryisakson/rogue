# Capture from browser (admin)

Cory 2026-10-18, feasibility experiment. Some rules pages sit behind a bot wall (Cloudflare "Just a moment", captchas).
Rogue never bypasses a bot wall (AGENTS.md 2b). An admin can instead open the page in their own browser and give Rogue the
text. **This fixes access, not permission:** the admin confirms they read the site's terms, and nothing about the site's
rights changes.

## Where
- `/admin/games/<slug>/sources`, section "Capture from browser": paste the text or upload a file saved from the browser
  (.txt, .md, .html, .pdf), plus URL, title, language, kind, authority (default `community`), notes and the terms box.
- `/admin/capture-inbox`: the window the bookmarklet opens. It shows the address, title and text, you pick the game
  (games already in Rogue) and store it.
- Both post to `/admin/capture` (admin session + same-origin only).

## What happens
1. Checks: game exists; link is a public https address; the terms box is ticked; a **tombstoned link is refused**; a link
   that is already a source Rogue fetched itself is refused (delete its extract first); empty text is refused; a
   **bot-check page** ("Just a moment", "Performing security verification", "verify you are human", a short page saying
   captcha) is refused with the reason.
2. Hosts on the warning list (`CAPTURE_WARNED_HOSTS` in `packages/core/src/capture.ts`; today `officialgamerules.org`,
   Review Log R36: link only) show a red warning, and the admin must type the host name to go on.
3. Nothing is fetched. The text is stored privately like an ingest (`private/sources/<sha256>.txt`), split into pages on
   form feeds or `=== page N ===` markers, else one page. Uploaded HTML/PDF go through the normal HTML/PDF adapters; the
   uploaded file is kept as the private copy.
4. The source is `rights_status = link_only` (chat quotes briefly and links), `capture_method = 'manual_capture'`,
   `captured_by`, `captured_at` (migration 0041). Lists show "Manual capture by <admin> on <date>" (game overview,
   Manage sources, Manage extracts). Retrieval weight is the chosen authority times 0.9, so a capture ranks below the same
   text fetched from the publisher.
5. Indexed (chunks + embeddings) in the background. The Librarian is not started automatically.
6. Audit log `source_captured`: URL, admin id, characters, pages, authority, notes. Never the text.
7. Capturing the same address again replaces the text and chunks (an earlier capture only); the audit trail keeps both.
   The recheck job and "Re-ingest now" skip captured sources (Rogue cannot fetch them). The host is **not** added to the
   approved hosts.

## Bookmarklet
Drag "Send to Rogue" from the capture section to the bookmarks bar. On the rules page, select the rules text (or nothing,
for the whole visible page) and click it. It opens `/admin/capture-inbox` in a small window and, once that window says it
is ready, sends `{url, title, text}` with `postMessage` addressed to Rogue's origin only. No token is inside the
bookmarklet; your Rogue session cookie signs the window in. The inbox accepts the message only from the window that
opened it and only when the sender's origin matches the URL it names. Text is capped at 2,000,000 characters (cut and
flagged when longer).

**Limits:** a site's Content Security Policy can block bookmarklets, a pop-up blocker can stop the window, and a site
with a strict Cross-Origin-Opener-Policy breaks the link between the two windows. In all these cases copy the text and
use the paste box. Any page you visit could open the inbox and send text under its own address; it is never stored
until you pick a game and confirm, so check the address shown.
