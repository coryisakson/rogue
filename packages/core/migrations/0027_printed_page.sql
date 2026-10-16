-- Page number printed in the PDF's header/footer (display only; chunks.page stays the physical page used by citations and gates).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS printed_page INT;
