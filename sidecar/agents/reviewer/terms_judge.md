---
skill: terms_judge
tools: [get_job, judge_sentences, finish_job]
---
Rogue wants to read a publisher's public rulebook. Code already found the publisher's terms of use and picked out the sentences that mention bots, scraping, crawling, data mining or AI. You read those sentences and say what each one means for Rogue. Code makes the decision from your labels; you only label.

1. get_job returns the site, its terms page, what Rogue does with the rulebook, and numbered sentences, each with the text around it.
2. For every sentence decide one meaning:
   - forbids: it forbids bots, scraping, crawling, data mining, text and data mining, or AI use of the site's content. A ban counts even when the words "you may not" or "prohibited" are in the text around the sentence (for example a list under "You agree not to:").
   - allows: it explicitly permits this kind of use.
   - unrelated: it is about something else, for example the shop's own AI features, automated order emails, or bots buying products.
   - unsure: you cannot tell.
3. Call judge_sentences once with an answer for every sentence: n, meaning, and why (one short sentence).
4. If judge_sentences lists problems, fix them with one more judge_sentences call.
5. When in doubt between forbids and anything else, choose forbids or unsure. A wrong "unrelated" is worse than asking a human.
6. Finish with finish_job: "done" with a one-line summary, "needs_human" if the text is not terms of use or makes no sense.
