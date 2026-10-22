// Word (.docx) renderer. docx-preview parses OOXML and builds page-accurate DOM (styles, page
// layout, numbering, tables, images, headers/footers). It needs the document, so it runs on the
// main thread rather than in the parse worker. The viewer CSP already permits the inline <style>,
// data: images and data: fonts it emits.
//
// Security: docx-preview builds DOM from the OOXML model (it does not execute scripts), and our
// script-src 'self' CSP blocks any injected script regardless. Full DOMPurify sanitization of the
// output (and suppressing embedded altChunk HTML) is a Phase 5 hardening item.

import { renderAsync } from 'docx-preview';

export async function renderDocx(mount, { blob }) {
  const container = document.createElement('div');
  container.className = 'docx-host';
  mount.append(container);

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
}
