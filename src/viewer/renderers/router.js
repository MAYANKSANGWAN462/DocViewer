// Maps a detected format to its renderer. Formats without a renderer yet fall back to the
// placeholder, which shows metadata and the phase that will implement them.

import { renderSpreadsheet } from './grid.js';
import { renderDocx } from './docx.js';
import { renderPptx } from './pptx.js';
import { renderLegacy } from './legacy.js';
import { renderPlaceholder } from './placeholder.js';

const RENDERERS = {
  csv: renderSpreadsheet,
  xls: renderSpreadsheet,
  xlsx: renderSpreadsheet,
  docx: renderDocx,
  pptx: renderPptx,
  doc: renderLegacy,
  ppt: renderLegacy,
};

/**
 * @param {string} format
 * @returns {(mount: HTMLElement, ctx: object) => Promise<void>}
 */
export function getRenderer(format) {
  return RENDERERS[format] || renderPlaceholder;
}
