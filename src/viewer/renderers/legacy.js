// Legacy binary Office formats (.doc, .ppt). No free, pure-JavaScript renderer handles these
// faithfully, so we explain that and keep Download available (always in the toolbar) so the user
// can open the file in a real Office app.

import { FORMATS } from '../../common/constants.js';

export async function renderLegacy(mount, { sniff, onFirstPaint }) {
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
    'This is a legacy binary Office format. No free, pure-JavaScript renderer can display it faithfully. Use the Download button to open it in an Office app.';
  card.append(p);

  mount.append(card);
  onFirstPaint?.(); // info card is up — drop the loading overlay
}
