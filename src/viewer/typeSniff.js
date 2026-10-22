// Format detection by file extension + magic bytes.
import { FORMATS } from '../common/constants.js';

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06]; // empty archive
const ZIP_SPAN = [0x50, 0x4b, 0x07, 0x08]; // spanned archive
const OLE_CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // OLE2 / CFB (legacy Office)
const PDF = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

/** @param {Uint8Array} bytes @param {number[]} sig */
function startsWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/** Extract a lowercase extension from a filename or URL path (ignoring query/hash). */
export function extensionOf(filename = '') {
  const clean = String(filename).split(/[?#]/)[0];
  const m = /\.([a-z0-9]+)$/i.exec(clean);
  return m ? m[1].toLowerCase() : '';
}

/** @param {Uint8Array} head */
function detectContainer(head) {
  if (startsWith(head, ZIP_LOCAL) || startsWith(head, ZIP_EMPTY) || startsWith(head, ZIP_SPAN)) {
    return 'zip';
  }
  if (startsWith(head, OLE_CFB)) return 'ole';
  if (startsWith(head, PDF)) return 'pdf';
  return 'text';
}

/**
 * Determine the document format.
 *
 * The file extension selects the OOXML/OLE *subtype* (docx/xlsx/pptx share a ZIP container,
 * so bytes alone cannot distinguish them); magic bytes validate the physical container and
 * surface mismatches. Content-based subtype disambiguation (reading `[Content_Types].xml`)
 * requires unzip and is handled later by the parse worker.
 *
 * @param {Uint8Array} head First ~16 bytes of the file.
 * @param {string} filename
 * @returns {{format:string, container:string, ext:string, mismatch:boolean, isPdf:boolean}}
 */
export function sniffType(head, filename) {
  const container = detectContainer(head);
  const ext = extensionOf(filename);

  if (container === 'pdf' || ext === 'pdf') {
    return { format: 'pdf', container: 'pdf', ext, mismatch: false, isPdf: true };
  }

  let format = FORMATS[ext] ? ext : 'unknown';

  // CSV/plain text carries no signature — trust the extension, else assume CSV for text bytes.
  if (format === 'unknown' && container === 'text') format = 'csv';

  const expected = FORMATS[format]?.container;
  const mismatch = Boolean(expected) && expected !== 'text' && expected !== container;

  return { format, container, ext, mismatch, isPdf: false };
}
