// PPTX renderer entry — pptx-vanilla-viewer (OrdalieTech; HTML/CSS renderer with a broad feature
// set: animations, transitions, 3D, SmartArt). Built as its own esbuild entry, loaded lazily.

import { createPptxViewer } from 'pptx-vanilla-viewer';

// Signature mirrors the aiden0z renderer; this library manages its own scrolling/scaling, so the
// shared `{ scrollContainer }` option is accepted and ignored.
export async function render(mount, blob, _opts = {}) {
  const viewer = createPptxViewer(mount, { source: blob, editable: false });
  // The factory may be synchronous, return a promise, or expose a `ready` promise — handle each.
  if (viewer && typeof viewer.then === 'function') await viewer;
  else if (viewer && viewer.ready && typeof viewer.ready.then === 'function') await viewer.ready;
}
