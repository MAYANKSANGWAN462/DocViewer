# DocViewer — In-Tab Office Viewer (Chrome MV3)

Preview Word, Excel and PowerPoint files directly in a Chrome tab — no download, no account, no upload. PDFs are left to Chrome's native viewer.

> Status: **All 6 phases complete.** Excel/CSV, Word, and PowerPoint render in-tab; Office downloads (`.xlsx/.xls/.csv/.docx/.pptx`) are intercepted into the viewer (reversible via global + per-site toggle); large sheets are virtualized; renderer output is security-scrubbed; and an optional, self-hosted LibreOffice-WASM "max-fidelity" mode is scaffolded for the hardest decks and legacy `.doc`/`.ppt`. Builds with esbuild — load the `dist/` folder. See the full plan at `~/.claude/plans/`.
>
> Installing now prompts for broad permissions (**all sites** + **downloads**) — that's the always-on interception design.

## Build & load (dev)

```
npm install
npm run build     # bundle src/ → dist/  (npm run dev to watch)
```

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/`** folder — **not** the project root. This is a bundled extension; only `dist/` is a complete, loadable extension. Loading the repo root fails because its referenced scripts live under `dist/`.
4. Click the DocViewer toolbar icon → **Open viewer**, then drag a file in (or use **Open file…**).

> The source manifest lives at `src/manifest.json` and icons at `icons/`; both are copied into `dist/` by the build. Regenerate icons with `npm run icons`.

## Verify

```
npm run check     # node --check on sources + JSON validation
npm test          # unit tests: spreadsheet model + interception matching
npm run build     # must succeed and produce dist/
```

## Roadmap

- **Phase 0** — Scaffold & viewer shell (+ CSV). ✓
- **Phase 1** — Excel (ExcelJS/SheetJS) + robust CSV. ✓
- **Phase 2** — Word (docx-preview). ✓
- **Phase 3** — Download interception (declarativeNetRequest + downloads). ✓
- **Phase 4** — PowerPoint (renderer bake-off). ✓
- **Phase 5** — Hardening + optional LibreOffice-WASM max-fidelity mode. ✓

## Max-fidelity mode (optional, experimental)

No free pure-JavaScript renderer is pixel-perfect for every deck, and legacy binary `.doc`/`.ppt` have no good JS renderer at all. The escape hatch is **LibreOffice compiled to WebAssembly** (e.g. [ZetaOffice](https://zetaoffice.net/)), which has a real layout engine — but it's a ~100 MB download, so it is **not bundled**.

To enable it:

1. Obtain a LibreOffice-WASM build and place a loader at `engine/docviewer-engine.js` inside the extension (so it loads from the extension origin and satisfies the `script-src 'self'` CSP). It must export:
   ```js
   export async function renderOfficeToContainer(blob, format, mount) { /* … */ }
   ```
   Add `engine/` to the build's static copy list in `scripts/build.mjs`, and cache the WASM via Cache Storage so it downloads once.
2. Turn on **Max-fidelity mode** in the popup. A **Max-fidelity** button then appears in the viewer toolbar for Word/PowerPoint, and legacy `.doc`/`.ppt` offer it directly.

> ⚠️ **License:** LibreOffice core is MPL-2.0 / LGPL-3.0; verify the terms of the specific WASM distribution you ship before publishing.

## Security

- Untrusted files are parsed/rendered, never executed — macros (`vbaProject.bin`) are ignored; the strict CSP forbids remote/inline scripts; renderer output is scrubbed of `<script>`/`<object>`/`<embed>`, inline `on*` handlers, and `javascript:` URLs, and any `<iframe>` is `sandbox`ed.
- `@aiden0z/pptx-renderer` runs with recommended ZIP-decompression limits (zip-bomb protection).
- The viewer only re-fetches the exact URL the user navigated to; `blob:`/`data:` downloads are left alone.
