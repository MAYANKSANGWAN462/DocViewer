// PPTX renderer entry — pptx-vanilla-viewer (OrdalieTech). A full OOXML renderer with faithful
// shapes, SmartArt (flat SVG), charts, WordArt/symbols and theme fonts — the high-fidelity option.
// Built as its own esbuild entry, loaded lazily by the dispatcher.
//
// We mount it *chromeless* (no ribbon, toolbar or thumbnail rail) so only the slides show inside
// DocViewer's own frame; inject its stylesheet once (the package ships its CSS as a string via
// getViewerCss — no bundler CSS loader needed); resolve on first paint via the `onLoad` callback so
// the loading overlay clears the moment the deck is on screen; surface load failures through
// `onError`; and expose a small zoom/fit controller so DocViewer's toolbar can drive it.

import { createPptxViewer, getViewerCss } from 'pptx-vanilla-viewer';

let stylesInjected = false;
function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'pptx-vanilla-viewer-css';
  style.textContent = getViewerCss();
  document.head.append(style);
}

export async function render(mount, blob, { onFirstPaint } = {}) {
  injectStylesOnce();

  // Fire the first-paint signal at most once. Ordalie reports a successful, fully-rendered deck via
  // `onLoad` (there is no partial-paint state — a failed load comes through `onError` instead), so
  // onLoad is the paint signal. Guard it anyway so a stray re-entry can't clear the overlay twice.
  let paintSignalled = false;
  const signalFirstPaint = () => {
    if (paintSignalled) return;
    paintSignalled = true;
    onFirstPaint?.();
  };

  let viewer;
  try {
    await new Promise((resolve, reject) => {
      viewer = createPptxViewer(mount, {
        source: blob, // auto-loads the deck; onLoad / onError report the outcome
        editable: false, // preview only — no selection, drag/resize or inline editing
        showToolbar: false, // DocViewer supplies its own toolbar
        showThumbnails: false, // no slide rail — just the deck
        showCompatibilityToasts: false, // keep the surface clean; warnings aren't actionable here
        onLoad: () => {
          signalFirstPaint(); // deck is on screen — drop the loading overlay immediately
          resolve();
        },
        onError: (message, error) =>
          reject(error instanceof Error ? error : new Error(message || 'Could not render the presentation.')),
      });
    });
  } finally {
    // Backstop: if the deck put slides on screen but the load promise settled oddly, still clear the
    // overlay rather than stranding it over visible content. A genuine onError keeps mount empty and
    // leaves this a no-op, so the orchestrator's error path still wins.
    if (mount.childElementCount > 0) signalFirstPaint();
  }

  // Adapt Ordalie's absolute zoom API (scale, where 1 = 100%) to the controller shape DocViewer's
  // toolbar expects: a percent-based setZoom, a zoomPercent getter, fit-to-width, and destroy.
  return {
    get zoomPercent() {
      return Math.round((viewer.getZoom?.() ?? 1) * 100);
    },
    setZoom(percent) {
      viewer.setZoom?.(percent / 100);
    },
    // Authoritative fit action — Ordalie fits with a single call. (DocViewer's toolbar prefers
    // this over the generic setFitMode+setZoom path, which would clobber the fit back to 100%.)
    fitToWidth() {
      viewer.zoomToFit?.();
    },
    destroy() {
      viewer.destroy?.();
    },
  };
}
