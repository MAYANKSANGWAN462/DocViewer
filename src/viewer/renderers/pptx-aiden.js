// PPTX renderer entry — @aiden0z/pptx-renderer. We import the package's dedicated **browser**
// build (`/browser`): deps (JSZip/ECharts) are inlined and Node-style `process.env` checks are
// pre-folded, which is what a no-bundler/extension context needs. Built as its own esbuild entry
// and loaded lazily by the dispatcher, so its multi-MB bundle only loads when a .pptx is viewed.

import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer/browser';

/**
 * Render a .pptx into `mount` and return the viewer (so the toolbar can drive zoom/fit).
 *
 * Crucially, this resolves as soon as the **first slide** is on screen — not when the whole deck
 * finishes — so the loading overlay clears in milliseconds and the UI can never get stuck behind a
 * slow or stalled later slide. Remaining slides stream in via windowed mounting.
 *
 * @param {HTMLElement} mount
 * @param {Blob} blob
 * @param {{ scrollContainer?: HTMLElement, onFirstPaint?: () => void }} [opts]
 * @returns {Promise<import('@aiden0z/pptx-renderer/browser').PptxViewer>}
 */
export async function render(mount, blob, { scrollContainer, onFirstPaint } = {}) {
  const buffer = await blob.arrayBuffer();

  let painted = false;
  let signalFirstPaint;
  const firstPaint = new Promise((resolve) => (signalFirstPaint = resolve));

  const viewer = new PptxViewer(mount, {
    zipLimits: RECOMMENDED_ZIP_LIMITS, // bound decompression for untrusted input
    fitMode: 'contain', // scale every slide to the container width — one slide fits without scrolling
    scrollContainer, // the real scroll ancestor → correct IntersectionObserver root for windowing
    lazyMedia: true, // decode embedded images on demand → faster first paint
    lazySlides: true, // parse each slide's shapes on demand → faster first paint
    pdfjs: false, // skip the optional EMF-embedded-PDF fallback (its blob worker + extra asset)
    onSlideRendered: (index) => {
      if (index === 0) {
        painted = true;
        onFirstPaint?.();
        signalFirstPaint();
      }
    },
  });

  // Kick off the full render, but don't make the UI wait on it.
  const done = viewer.open(buffer, {
    renderMode: 'list', // one vertically scrollable list of all slides
    listOptions: {
      windowed: true, // keep off-screen slides out of the DOM (perf on large decks)
      initialSlides: 3, // paint the first few immediately, then stream the rest
      batchSize: 4,
      showSlideLabels: true, // caption each slide "Slide N"
    },
  });

  // Resolve on first paint; if rendering fails *before* anything painted, surface the error.
  await Promise.race([
    firstPaint,
    done.then(
      () => undefined,
      (err) => {
        if (!painted) throw err;
      },
    ),
  ]);

  return viewer;
}
