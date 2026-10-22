// Optional max-fidelity rendering via a self-hosted LibreOffice-WASM build (e.g. ZetaOffice).
//
// SCAFFOLD — the ~100 MB engine is NOT bundled: its size and distribution license need review
// (LibreOffice core is MPL-2.0 / LGPL-3.0; verify the specific build before shipping). To enable
// it, place a build inside the extension at `engine/docviewer-engine.js` that satisfies the loader
// contract below, and turn on max-fidelity mode in the popup. Loading stays within the extension
// origin so it satisfies the strict `script-src 'self'` CSP (an external URL would be blocked).
//
// Loader contract — engine/docviewer-engine.js must export:
//   export async function renderOfficeToContainer(blob: Blob, format: string, mount: HTMLElement): Promise<void>

import { readSettings } from '../../common/settings.js';

function message(mount, title, body) {
  mount.replaceChildren();
  const card = document.createElement('div');
  card.className = 'placeholder';
  const h = document.createElement('h2');
  h.className = 'placeholder__title';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'placeholder__msg';
  p.textContent = body;
  card.append(h, p);
  mount.append(card);
}

export async function openInMaxFidelity(mount, blob, format) {
  const settings = await readSettings().catch(() => ({}));
  if (!settings.maxFidelity?.enabled) {
    message(mount, 'Max-fidelity mode is off', 'Enable the optional LibreOffice-WASM mode in the DocViewer popup to use it.');
    return;
  }
  message(mount, 'Loading max-fidelity engine…', 'This can take a while the first time while the engine downloads and caches.');
  try {
    const engine = await import(chrome.runtime.getURL('engine/docviewer-engine.js'));
    await engine.renderOfficeToContainer(blob, format, mount);
  } catch (err) {
    message(
      mount,
      'Max-fidelity engine not installed',
      `No LibreOffice-WASM build was found at engine/docviewer-engine.js. See the README “Max-fidelity mode” section to add one. (${err?.message || err})`,
    );
  }
}
