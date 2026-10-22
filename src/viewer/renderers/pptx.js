// PowerPoint dispatcher (small; lives in viewer.js). Chooses the active renderer and lazily
// imports its standalone bundle. Precedence: ?renderer= override (used by the bake-off harness)
// → settings.pptxRenderer → default (aiden0z).

import { readSettings } from '../../common/settings.js';

const ENTRY = {
  aiden0z: 'viewer/renderers/pptx-aiden.js',
  ordalie: 'viewer/renderers/pptx-ordalie.js',
};

export async function renderPptx(mount, { blob, scrollContainer, onFirstPaint }) {
  const override = new URLSearchParams(location.search).get('renderer');
  let choice = override && ENTRY[override] ? override : null;
  if (!choice) {
    try {
      choice = (await readSettings()).pptxRenderer;
    } catch {
      /* fall back to default below */
    }
  }
  if (!ENTRY[choice]) choice = 'aiden0z';

  const slides = document.createElement('div');
  slides.className = 'pptx-slides';
  mount.append(slides);

  // Dynamic import of a runtime-built URL: esbuild leaves this as a lazy runtime import.
  const mod = await import(chrome.runtime.getURL(ENTRY[choice]));
  // The renderer needs the actual scroll ancestor (not `mount`, which is inside it) so its
  // windowed list mode observes visibility against the right element. Return whatever control
  // handle the renderer produces (the aiden0z viewer exposes zoom/fit) up to the orchestrator.
  return mod.render(slides, blob, {
    scrollContainer: scrollContainer || mount.closest('.stage') || undefined,
    onFirstPaint,
  });
}
