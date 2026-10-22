// Generate DocViewer toolbar/store icons (16/32/48/128) into icons/ with zero image deps.
// Draws a simple branded glyph: a blue rounded tile with a white "document" page and text lines.
// Re-run after changing the look: `node scripts/make-icons.mjs`. The build copies icons/ into dist/.

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const SIZES = [16, 32, 48, 128];
const BRAND = [0x25, 0x63, 0xeb]; // #2563EB
const PAGE = [0xff, 0xff, 0xff];
const LINE = [0x93, 0xc5, 0xfd]; // light blue "text" lines

// CRC32 for PNG chunks.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// pixels: Uint8Array of size*size*4 (RGBA) -> PNG buffer.
function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression/filter/interlace = 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy ? pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
                : raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const radius = Math.max(2, Math.round(size * 0.18));
  const inCorner = (x, y) => {
    // rounded-corner test against the nearest corner circle
    const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
    const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };

  // Background tile (transparent outside the rounded rect).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inCorner(x, y)) set(x, y, BRAND);
    }
  }

  // White page rectangle, centered, ~56% of the tile.
  const pw = Math.round(size * 0.5);
  const ph = Math.round(size * 0.62);
  const px0 = Math.round((size - pw) / 2);
  const py0 = Math.round((size - ph) / 2);
  for (let y = py0; y < py0 + ph; y++) {
    for (let x = px0; x < px0 + pw; x++) set(x, y, PAGE);
  }

  // A few "text" lines on the page (skip for the tiniest icon).
  if (size >= 32) {
    const lineH = Math.max(1, Math.round(size * 0.06));
    const gap = Math.max(2, Math.round(size * 0.1));
    const lx0 = px0 + Math.round(pw * 0.16);
    const lx1 = px0 + pw - Math.round(pw * 0.16);
    let ly = py0 + Math.round(ph * 0.22);
    for (let n = 0; n < 3; n++) {
      const end = n === 2 ? lx0 + Math.round((lx1 - lx0) * 0.6) : lx1;
      for (let y = ly; y < ly + lineH; y++) for (let x = lx0; x < end; x++) set(x, y, LINE);
      ly += gap;
    }
  }
  return px;
}

await mkdir('icons', { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, draw(size));
  await writeFile(`icons/icon${size}.png`, png);
  console.log(`icons/icon${size}.png (${png.length} bytes)`);
}
console.log('[make-icons] done');
