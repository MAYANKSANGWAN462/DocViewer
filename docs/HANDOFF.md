# DocViewer — Session Handoff Log

This file carries context between separate Claude sessions. **Every session must read this first**,
then read `.claude/plans/login-spicy-minsky.md` (the master plan), then the files it names.
**At the end of every session, append a new entry below** describing what changed, what was verified
(and how), what is still open, and what the next session should pick up. Make a git commit too.

## Project snapshot
- Chrome MV3 extension that previews Office files (xlsx, xls, csv, docx, pptx) in-tab.
- Build: `npm run build` → outputs to `dist/` (Chrome loads **`dist/`**, not `src/` — always rebuild).
- Tests: `npm test`.
- Decisions locked (see plan): PPTX default engine → **Ordalie** (accurate) with a **Fast** toggle +
  large-deck auto-fallback; **remove** the Max-fidelity LibreOffice-WASM engine; visual redesign with
  **light + dark (auto)**; work split into **3 larger sessions**.

## Known root causes to fix (from planning)
1. Infinite re-render loop + missing PPTX icons/shapes: default aiden0z PPTX engine runs windowed
   (`windowed:true`, `lazySlides`, `fitMode:'contain'`) → IntersectionObserver mount/unmount loop.
   Fix by defaulting to Ordalie (renders whole deck once).
2. Spreadsheet virtualization `paint()` loop in `grid.js:159-188` (dedupe only on start/end; double
   initial paint).
3. Per-renderer `onFirstPaint()` not guaranteed if a library throws after partial paint.

---

## Session log

### (template — copy for each session)
- **Session:** <1 / 2 / 3 — title>
- **Date:**
- **Changed:** <files + what>
- **Verified:** <commands run, what was observed in Chrome>
- **Still open / risks:**
- **Next session should:**
- **Commit / branch:**

---

### Session 1 — Core rendering reliability + PPTX engine
- **Date:** 2026-11-23
- **Changed:**
  - `src/common/constants.js` — `DEFAULT_SETTINGS.pptxRenderer` now `'ordalie'` (was `'aiden0z'`);
    **removed** the `maxFidelity` setting; added `PPTX_FAST_FALLBACK_BYTES` (25 MB).
  - `src/viewer/renderers/pptx.js` (dispatcher) — default engine is now `'ordalie'`; a `?renderer=`
    override is honored verbatim (bake-off stays deterministic); for a non-override `'ordalie'` choice
    on a deck larger than `PPTX_FAST_FALLBACK_BYTES`, auto-falls back to the fast windowed `'aiden0z'`
    engine so a huge deck can't pin the tab.
  - `src/viewer/renderers/pptx-ordalie.js` — idempotent, once-only first-paint signal; `onFirstPaint`
    now also fires from a `finally` backstop if slides are on screen but the load promise settled
    oddly; replaced the `setFitMode()` shim with an authoritative `fitToWidth()` (calls Ordalie's
    `zoomToFit()`); `setZoom` made null-safe.
  - `src/viewer/viewer.js` — `fitToWidth` toolbar handler now prefers a controller's own
    `fitToWidth()` (Ordalie) and only falls back to `setFitMode('contain') + setZoom(100)` for
    aiden0z (whose effective scale = fitScale × zoomPercent/100). **This fixed a real fit bug:** the
    old path called `setFitMode` then immediately `setZoom(100)`, clobbering Ordalie's fit back to
    100%. Removed all WASM/max-fidelity wiring (import, `btnMaxFidelity` ref, `MAX_FIDELITY_FORMATS`,
    `maybeShowMaxFidelity`, its call + reset line, the click listener, the now-unused `readSettings`
    import).
  - `src/viewer/renderers/pptx-aiden.js` — the first-paint race wrapped in try/finally: a backstop
    fires `onFirstPaint` if slides reached the DOM but `onSlideRendered` never fired (a failure
    before any paint leaves the mount empty, so the error still propagates).
  - `src/viewer/renderers/docx.js` — render wrapped in try/catch/finally: a late throw *after* pages
    painted keeps the partial content (only a zero-DOM failure propagates); `onFirstPaint` fires from
    `finally` whenever any content exists.
  - `src/viewer/renderers/grid.js` — virtualization dedupe guard now includes `topPad`/`bottomPad`
    (not just start/end), so the initial paint and its post-layout rAF correction no longer each
    rebuild the body (layout thrash); `renderSheet()` wrapped so `onFirstPaint` fires from `finally`.
  - `src/viewer/renderers/legacy.js` — dropped the WASM import + "Open in max-fidelity" button and
    the WASM mention in the copy; the `.doc`/`.ppt` info card is unchanged.
  - `src/popup/popup.html` + `popup.js` — removed the "Exact rendering engine" toggle and its wiring;
    renderer `<select>` now lists **High quality (recommended)** first, then **Fast**; default value
    falls back to `'ordalie'`.
  - `src/viewer/viewer.html` — removed the "Exact render" toolbar button.
  - **Deleted** `src/viewer/renderers/wasm-office.js`.
  - Added `test/fixtures/` — `sample.csv`, generated `sample.xlsx` (tabs + merge + bold header),
    and a README noting that `.docx`/`.pptx` samples must be added by hand for a full Chrome pass.
  - The PPTX **compare/bake-off** tool and the legacy `.doc`/`.ppt` info card were intentionally
    **kept** (per the plan).
- **Verified:**
  - `npm run build` → clean, `dist/` rebuilt fresh; `viewer.js` shrank (WASM gone).
  - `npm test` → 8 + 3 checks pass. `npm run check` → 21 JS + 2 JSON OK.
  - `rg` over `src/` and `dist/` for `wasm-office|maxFidelity|docviewer-engine|btn-max-fidelity|
    toggle-maxfidelity` → **no matches** (removal is complete, including the built bundle).
  - Confirmed against the installed type defs that Ordalie exposes `getZoom/setZoom/zoomToFit/
    getSlideCount/destroy` and fires `onLoad`/`onError`, and that aiden0z's scale model is
    `fitScale × zoomPercent/100` — which is why the two engines need different fit paths.
  - **NOT run:** the live Chrome end-to-end pass (loading `dist/`, opening real `.pptx`/`.docx`,
    watching DevTools Performance for a layout loop, eyeballing icons/shapes). This environment has
    no browser. See "Next session should".
- **Still open / risks:**
  - The master plan `.claude/plans/login-spicy-minsky.md` referenced by this handoff **does not
    exist** in the repo — worked from the HANDOFF snapshot + the Session 1 task brief instead. If the
    plan exists elsewhere, drop it in so later sessions have the full decision log.
  - Fast-engine fallback keys on **file size** (available pre-parse in the dispatcher), not slide
    count. A small-but-slide-heavy deck won't trip it; revisit with a slide-count threshold if the
    heavy engine stalls on such decks (Ordalie's `onLoad` reports `slideCount`).
  - The aiden0z "Fast" engine still renders windowed (IntersectionObserver). It's no longer the
    default, so the re-render loop shouldn't surface normally, but it's only sidestepped, not
    rewritten — large decks in Fast mode should be spot-checked.
  - No automated test covers the renderer dispatch / fallback logic (tests are parser-only).
- **Next session should:**
  - Do the Chrome pass: load `dist/` (chrome://extensions → Load unpacked → `dist/`), open a
    `.pptx` (shapes/SmartArt/WordArt/charts/icons present? spinner clears? DevTools Performance shows
    no repeating layout loop / runaway CPU?), plus `.xlsx`, `.docx`, `.csv`. Add real `.docx`/`.pptx`
    fixtures under `test/fixtures/`.
  - Verify the >25 MB fast-engine fallback and the zoom/**Fit** controls on both engines.
  - Pick up Session 2 (visual redesign — light + dark/auto).
- **Commit / branch:** **Left uncommitted at the user's request** — the user will review and commit
  themselves. All Session 1 edits are in the working tree (and rebuilt into `dist/`).

---

### Session 2 — Format fidelity & cleanup (continued)
- **Date:** 2026-11-23
- **Hard constraint:** this environment has **no browser**, so the headline Session 2 ask — the live
  Chrome pass (open real `.pptx`/`.xlsx`/`.docx`/`.csv`, eyeball icons/shapes/SmartArt, watch DevTools
  Performance for a layout loop) — **still could not be run here**, same as Session 1. Work this session
  was limited to code paths I can reason about and cover with the Node unit tests. The visual pass
  remains the top open item for whoever has a browser.
- **Reviewed (no change needed):**
  - `pptx-ordalie.js` vs the installed `pptx-vanilla-viewer@3.43` type defs: confirmed the options we
    pass (`source`, `editable:false`, `showToolbar:false`, `showThumbnails:false`,
    `showCompatibilityToasts:false`, `onLoad`/`onError`) and the controller methods we call
    (`getZoom`/`setZoom`(1=100%)/`zoomToFit`/`destroy`) all exist and match our usage. Fidelity knobs
    (`maxFitScale`, `fitPadding`, `smartArt3D`, `*Chart3D`) exist but the flat-SVG defaults are the
    right call for a lean preview; embedded/theme fonts and non-Latin glyphs are handled inside the
    library (nothing for us to wire). The compare/bake-off `?renderer=` override path in `pptx.js` is
    intact. **No code change** — the Ordalie path is sound on paper; it still needs the visual pass.
  - Dispatcher fallback (`pptx.js`) + thresholds: the >25 MB (`PPTX_FAST_FALLBACK_BYTES`) auto-drop to
    the fast engine, the 40 MB warn / 300 MB hard cap, and the worker/render timeouts are internally
    consistent. Note for the record: the 30 s `RENDER_HARD_TIMEOUT_MS` only covers the **render** step;
    the worker parse has its own 120 s budget (`WORKER_PARSE_TIMEOUT_MS`), and it runs *before* the
    render race — so a legitimately slow large-sheet parse is not killed at 30 s, while a stuck render
    still is. The 12 s slow-render notice surfaces a Download hatch in the meantime. No stuck-state gap
    found.
- **Changed:**
  - `src/viewer/model/spreadsheet.js` — reworked ExcelJS cell-text extraction into a single recursive
    `scalarToText(value, numFmt, ssfFormat)`:
    - **Booleans** now render `TRUE`/`FALSE` (Excel's convention), not JS's `true`/`false`.
    - **Formula cells** format their cached `result` through the *same* path, so a formula returning a
      number/date/error now honors the cell's number format (previously the result went through a
      number-only branch — a formula returning a date showed the raw `Date.toString()`).
    - Added `isoDateTime()`: a date carrying **no** explicit number format now renders a deterministic
      UTC `YYYY-MM-DD[ HH:MM:SS]` instead of `toLocaleString()` (which drifted with host
      locale/timezone — the same cell could read differently on different machines). In practice
      ExcelJS auto-applies a date format on write, so this only catches computed/unformatted dates.
  - `test/spreadsheet.test.mjs` — added three round-trip checks (boolean → TRUE/FALSE; formula result
    honors `#,##0.00`; unformatted date is deterministic). Suite is now **11** spreadsheet checks.
- **Verified:**
  - `npm test` → **11 + 3** checks pass. `npm run build` → clean, `dist/` rebuilt. `npm run check` →
    21 JS + 2 JSON OK.
  - **NOT run:** the live Chrome end-to-end / visual-fidelity pass (no browser here).
- **Still open / risks:**
  - **The visual pass is still owed** — load `dist/` in Chrome and eyeball a real `.pptx` (shapes,
    SmartArt, WordArt, charts, icons, embedded fonts, non-Latin text), `.xlsx`, `.docx`, `.csv`;
    confirm the spinner always clears and DevTools Performance shows no repeating layout loop.
  - **Frozen panes are parsed but not rendered.** `spreadsheet.js` captures `frozen:{rows,cols}` but
    `grid.js` ignores it — the grid only has sticky column-letter / row-number headers, not sticky
    *data* panes. This is the biggest remaining Excel fidelity gap; left unimplemented on purpose
    because getting sticky split panes right in a CSS table needs visual iteration I can't do here.
  - **Column virtualization / cap:** wide sheets are capped at `MAX_COLS = 1024` and columns past that
    are silently dropped (only the row count is called out in the large-sheet banner).
  - Legacy `.xls` (SheetJS path) still has minimal styling — unchanged, as documented.
  - Real `.docx`/`.pptx` fixtures under `test/fixtures/` still need to be added by hand for a full
    Chrome pass (only `.csv`/`.xlsx` are generated).
- **Next session should:** do the browser visual pass above; if the grid needs frozen-pane fidelity,
  implement sticky split panes in `grid.js` using the already-parsed `frozen` data and verify visually;
  consider a slide-count-based PPTX fallback (not just file size) if the heavy engine stalls on small-
  but-slide-heavy decks.
- **Commit / branch:** **Left uncommitted — per the user, all git (branch/commit/push) is done by the
  user, not this session.** All Session 2 edits are in the working tree and rebuilt into `dist/`.
