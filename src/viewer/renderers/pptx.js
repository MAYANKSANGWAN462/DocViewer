// PowerPoint dispatcher (small; lives in viewer.js). Chooses the active renderer and lazily
// imports its standalone bundle. Precedence: ?renderer= override (used by the bake-off harness,
// honored exactly — no fallback) → settings.pptxRenderer → default ('ordalie', high-fidelity).
//
// Auto-fallback: for a non-override choice of the heavy Ordalie engine, a very large deck
// (> PPTX_FAST_FALLBACK_BYTES) falls back to the fast windowed 'aiden0z' engine so it can't pin
// the tab rendering every slide at once.

import { readSettings } from '../../common/settings.js';
import { PPTX_FAST_FALLBACK_BYTES } from '../../common/constants.js';

const ENTRY = {
  aiden0z: 'viewer/renderers/pptx-aiden.js',
  ordalie: 'viewer/renderers/pptx-ordalie.js',
};

const DEFAULT_RENDERER = 'ordalie';

export async function renderPptx(mount, { blob, scrollContainer, onFirstPaint }) {
  const override = new URLSearchParams(location.search).get('renderer');
  let choice;
  if (override && ENTRY[override]) {
    // Explicit override (bake-off): use it verbatim so the comparison reflects the real code path.
    choice = override;
  } else {
    try {
      choice = (await readSettings()).pptxRenderer;
    } catch {
      /* fall back to default below */
    }
    if (!ENTRY[choice]) choice = DEFAULT_RENDERER;
    // Safety net: a huge deck on the heavy engine would render every slide at once. Drop to the
    // fast windowed engine instead. Only for non-override choices (bake-off stays deterministic).
    if (choice === 'ordalie' && blob && blob.size > PPTX_FAST_FALLBACK_BYTES) {
      console.info(
        `[DocViewer] PPTX is ${(blob.size / (1024 * 1024)).toFixed(0)} MB — using the fast engine to keep the tab responsive.`,
      );
      choice = 'aiden0z';
    }
  }

  const slides = document.createElement('div');
  slides.className = 'pptx-slides';
  mount.append(slides);

  // Dynamic import of a runtime-built URL: esbuild leaves this as a lazy runtime import.
  const mod = await import(chrome.runtime.getURL(ENTRY[choice]));
  // The renderer needs the actual scroll ancestor (not `mount`, which is inside it) so its
  // windowed list mode observes visibility against the right element. Return whatever control
  // handle the renderer produces (both viewers expose zoom/fit) up to the orchestrator.
  return mod.render(slides, blob, {
    scrollContainer: scrollContainer || mount.closest('.stage') || undefined,
    onFirstPaint,
  });
}
