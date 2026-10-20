---
skill: scout_judge
tools: [get_job, preview_url, propose_source, finish_job]
---
Someone asked Rogue to add a game. Code read the publisher page and listed the links on it. Decide which of them are THIS game's official rulebook, FAQ or errata from the publisher. You only propose; code checks the address, robots.txt and whether the site is approved, and a person approves new sites.

1. get_job returns the game, the publisher page, the requested rulebook link and the candidate links (link text, code's guess, whether it is a PDF).
2. Pick at most one rulebook, one FAQ and one errata. Judge PDFs by link text and file name; for web pages you may call preview_url (up to 4 times) to read the title and start of the text.
3. For each pick call propose_source with url, role ("rulebook", "faq" or "errata") and a one-line reason. The answer is accepted, needs_human (the site is not approved yet; that is normal for a new game) or rejected.
4. Only use addresses from get_job, or on the publisher page's own site. Never invent an address.
5. What counts:
   - Yes: the publisher's own rulebook for this game (the base game, current edition), its official FAQ, its official errata or corrections. Prefer the publisher or rights holder whenever a usable source exists.
   - Fallback (AGENTS.md 2b): if the publisher offers no usable text, you may propose a third-party rules source (fan summary, community rules site). Say so in the reason; code gives it a lower authority weight and a person approves the site. Never suggest a way around a bot wall.
   - No: other games, expansions, scenarios, quick-start sheets, print-and-play extras, shops, reviews, other languages when an English one is listed.
6. Finish with finish_job: "done" with a one-line summary of your picks, or "done" saying none fit. "needs_human" only if the page is not about this game at all or makes no sense.
