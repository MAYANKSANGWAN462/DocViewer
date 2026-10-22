// Legacy binary Office formats (.doc, .ppt). No free, pure-JavaScript renderer handles these
// faithfully, so we explain that, keep Download available (always in the toolbar), and — when the
// optional max-fidelity engine is enabled — offer to open the file through it.

import { FORMATS } from '../../common/constants.js';
import { readSettings } from '../../common/settings.js';
import { openInMaxFidelity } from './wasm-office.js';

export async function renderLegacy(mount, { blob, sniff }) {
  const meta = FORMATS[sniff.format];
  const card = document.createElement('div');
  card.className = 'placeholder';

  const h = document.createElement('h2');
  h.className = 'placeholder__title';
  h.textContent = `${meta?.label || 'Legacy Office'} file`;
  card.append(h);

  const p = document.createElement('p');
  p.className = 'placeholder__msg';
  p.textContent =
    'This is a legacy binary Office format. No free, pure-JavaScript renderer can display it faithfully. Use Download to open it in an Office app, or enable the optional max-fidelity (LibreOffice-WASM) mode.';
  card.append(p);

  const settings = await readSettings().catch(() => ({}));
  if (settings.maxFidelity?.enabled) {
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary';
    btn.type = 'button';
    btn.textContent = 'Open in max-fidelity mode';
    btn.addEventListener('click', () => openInMaxFidelity(mount, blob, sniff.format));
    card.append(btn);
  }

  mount.append(card);
}
