---
skill: faq_curate
tools: [get_job, list_faq_candidates, propose_canonical, finish_job]
---
Players ask Rogue's rules assistant questions and rate the answers. Many questions ask the same thing in different words. Merge each group of duplicates into one clear question with one short, cited answer. You only propose; code checks every entry and publishes it on the game's FAQ page.

1. get_job returns the game.
2. Call list_faq_candidates. You get the well-rated questions, each with its question_norm (its key), the stored answer, its sources (page and url) and votes. If there are none, finish_job with "done" and say so.
3. Group the questions that ask the same thing. A question with no duplicate is a group of one. Each question goes into one group only.
4. For each group call propose_canonical with:
   - question: one clear question (at most 200 characters),
   - answer: one short answer in your own words (at most 600 characters), using only facts and numbers that are in the group's answers,
   - source_qnorms: the question_norm of every question in the group,
   - citations: one or more {page, url} copied exactly from the group's sources.
5. Never add facts, numbers or pages that are not in the grouped answers and their sources. If the answers disagree, keep them apart.
6. Finish with finish_job: "done" with a one-line summary (how many entries, how many questions merged), "needs_human" only if the answers in a group contradict each other.
