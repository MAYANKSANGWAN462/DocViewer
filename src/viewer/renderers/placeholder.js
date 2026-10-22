// Fallback renderer for formats whose real renderer hasn't landed yet. Shows the detected
// metadata and which phase will implement the format. All dynamic values go through textContent.

import { FORMATS } from '../../common/constants.js';

function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export async function renderPlaceholder(mount, { blob, filename, sniff }) {
  const meta = FORMATS[sniff.format];

  const card = document.createElement('div');
  card.className = 'placeholder';

  const title = document.createElement('h2');
  title.className = 'placeholder__title';
  title.textContent = 'Preview not available yet';
  card.append(title);

  const rows = [
    ['File', filename || '(untitled)'],
    ['Detected format', meta ? `${meta.label} (.${sniff.format})` : sniff.format || 'unknown'],
    ['Container', sniff.container],
    ['Size', formatBytes(blob?.size)],
  ];
  if (sniff.mismatch) rows.push(['⚠ Warning', 'File extension does not match its contents.']);

  const dl = document.createElement('dl');
  dl.className = 'placeholder__meta';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  card.append(dl);

  const msg = document.createElement('p');
  msg.className = 'placeholder__msg';
  msg.textContent = meta?.phase
    ? `A faithful renderer for ${meta.label} files arrives in Phase ${meta.phase}. For now, use the Download button to get the original.`
    : 'This file type isn’t supported for in-tab preview. Use the Download button to get the original.';
  card.append(msg);

  mount.append(card);
}
