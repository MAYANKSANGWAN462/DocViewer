# Test fixtures

Small sample documents for manually exercising the viewer (load `dist/` in Chrome, then open these).

- `sample.csv` — exercises the CSV → grid path.
- `sample.xlsx` — two sheets (tabs), a bold header row and a merged cell → exercises the worker
  parse + full-table grid path. Generated with `exceljs`.

**Not checked in (add your own for a full pass):** `.docx` and `.pptx` samples. No pure-JS *writer*
for those is installed, so drop a real Word doc and a PowerPoint deck here to verify the docx-preview
and Ordalie PPTX paths (shapes, SmartArt, WordArt, charts, icons). A deck over 25 MB also exercises
the automatic fast-engine fallback.
