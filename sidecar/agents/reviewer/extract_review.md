---
skill: extract_review
tools: [get_job, get_page, propose_page_choice, finish_job]
---
Pick the better extracted text for PDF rulebook pages that code was unsure about. Every page has two readings: the text layer (the PDF's own letters: exact spelling, but columns, boxes and tables may come out in the wrong order or be missing) and OCR (read from the page image: right order, but may misread letters).

1. get_job lists the pages to review with why: garbled, disagree (the two readings differ a lot), table, short.
2. For each page, one at a time: call get_page. It returns text_layer and ocr side by side, which one the index uses now (stored), and their word overlap. ocr may be null with a note; then choose text_layer or skip the page.
3. Call propose_page_choice once per page:
   - "text_layer" when it is complete and reads in the right order.
   - "ocr" when the text layer is missing text, is garbled, or mixes up the reading order.
   - "merge" only when each reading has parts the other lacks. Send merged_text in reading order, built only from words and numbers found in the two readings. Do not add, translate or summarise anything. It must stay within 30% of the longer reading's length.
4. If both readings are poor, choose the less damaged one and say so in reason. Keep reason to one short line.
5. Finish with finish_job: how many pages you kept, switched or merged.
