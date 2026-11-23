// Word (.docx) renderer. docx-preview parses OOXML and builds page-accurate DOM (styles, page
// layout, numbering, tables, images, headers/footers). It needs the document, so it runs on the
// main thread rather than in the parse worker. The viewer CSP already permits the inline <style>,
// data: images and data: fonts it emits.
//
// Security: docx-preview builds DOM from the OOXML model (it does not execute scripts), and our
// script-src 'self' CSP blocks any injected script regardless. Full DOMPurify sanitization of the
// output (and suppressing embedded altChunk HTML) is a Phase 5 hardening item.

import { renderAsync } from 'docx-preview';

export async function renderDocx(mount, { blob, onFirstPaint }) {
  const container = document.createElement('div');
  container.className = 'docx-host';
  mount.append(container);

  try {
    await renderAsync(blob, container, null, {
      className: 'docx',
      inWrapper: true, // wrap pages in docx-preview's page-styled wrapper
      breakPages: true, // honor page breaks
      experimental: true, // tab stops and other experimental layout features
      useBase64URL: true, // inline images/fonts as data: URLs (CSP-friendly)
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    });
  } catch (err) {
    // docx-preview may throw partway through after already laying out pages. If any content made it
    // onto the page, keep it (partial is better than an error screen); only a total failure — no DOM
    // at all — propagates to the orchestrator's error path.
    if (container.childElementCount === 0) throw err;
    console.warn('[DocViewer] docx render incomplete; showing partial content', err);
  } finally {
    // Clear the overlay the moment any content exists, whether the render finished or threw late.
    // The orchestrator's finally is the backstop if nothing painted.
    if (container.childElementCount > 0) onFirstPaint?.();
  }
}
