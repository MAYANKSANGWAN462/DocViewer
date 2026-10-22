// Pure, dependency-free helpers that normalize parsed spreadsheets (ExcelJS / SheetJS / CSV)
// into one plain-data model the grid renderer consumes. "Plain data" matters: the parse worker
// posts this across a structured-clone boundary, so no class instances or methods survive.
//
// This module is deliberately free of browser/worker globals so it can be unit-tested in Node.
//
// Model shape:
//   { kind:'spreadsheet', activeSheet:number, sheets: Sheet[] }
//   Sheet = {
//     name, rowCount, colCount,
//     cells:   { "r,c": { text:string, style?:Style } },   // sparse, 0-based
//     merges:  [{ top, left, bottom, right }],             // 0-based, inclusive
//     colWidths:{ [c]: px }, rowHeights:{ [r]: px },        // sparse
//     frozen:  { rows, cols },
//   }
//   Style = { bold?, italic?, underline?, color?, bg?, halign?, valign?, wrap?, fontSize?(pt),
//             fontName?, borders?: { top?|right?|bottom?|left?: { style, color } } }

export const DEFAULT_COL_PX = 64;
export const DEFAULT_ROW_PX = 20;

/** 0-based column index → spreadsheet letter (0→A, 25→Z, 26→AA). */
export function colName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel column width (characters) → pixels (Calibri-11 approximation). */
export function colWidthToPx(width) {
  return Math.round(width * 7) + 5;
}

/**
 * Visible-row window for virtualized sheets (fixed row height). Pure; unit-tested.
 * @returns {{start:number, end:number, topPad:number, bottomPad:number}} end is exclusive.
 */
export function computeWindow(scrollTop, viewportH, rowH, rowCount, overscan = 6) {
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const visible = Math.ceil(viewportH / rowH);
  const end = Math.min(rowCount, start + visible + overscan * 2);
  return { start, end, topPad: start * rowH, bottomPad: Math.max(0, (rowCount - end) * rowH) };
}

/** Points → pixels. */
function ptToPx(pt) {
  return Math.round((pt * 4) / 3);
}

/** ExcelJS color object → CSS color, or undefined for theme/indexed colors (Phase 1 caveat). */
export function argbToCss(color) {
  if (!color || typeof color !== 'object' || typeof color.argb !== 'string') return undefined;
  const argb = color.argb.padStart(8, 'F');
  const a = parseInt(argb.slice(0, 2), 16) / 255;
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return undefined;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/** JS Date (treated as UTC, as ExcelJS stores it) → Excel serial number. */
function dateToSerial(d) {
  return d.getTime() / 86400000 + 25569;
}

function extractExcelJsStyle(cell) {
  const style = {};
  const f = cell.font;
  if (f) {
    if (f.bold) style.bold = 1;
    if (f.italic) style.italic = 1;
    if (f.underline) style.underline = 1;
    if (f.size) style.fontSize = f.size;
    if (f.name) style.fontName = f.name;
    const c = argbToCss(f.color);
    if (c) style.color = c;
  }
  const fill = cell.fill;
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argbToCss(fill.fgColor);
    if (bg) style.bg = bg;
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal) style.halign = a.horizontal;
    if (a.vertical) style.valign = a.vertical;
    if (a.wrapText) style.wrap = 1;
  }
  const b = cell.border;
  if (b) {
    const borders = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (b[side] && b[side].style) {
        borders[side] = { style: b[side].style, color: argbToCss(b[side].color) || 'rgb(0, 0, 0)' };
      }
    }
    if (Object.keys(borders).length) style.borders = borders;
  }
  return Object.keys(style).length ? style : undefined;
}

/** Display text for an ExcelJS cell, applying number formats via the injected SSF formatter. */
function excelJsCellText(cell, ssfFormat) {
  const v = cell.value;
  if (v == null) return '';
  const fmt = (num) => {
    if (typeof num === 'number' && cell.numFmt && ssfFormat) {
      try {
        return ssfFormat(cell.numFmt, num);
      } catch {
        /* fall through */
      }
    }
    return num == null ? '' : String(num);
  };
  if (v instanceof Date) {
    if (cell.numFmt && ssfFormat) {
      try {
        return ssfFormat(cell.numFmt, dateToSerial(v));
      } catch {
        /* fall through */
      }
    }
    return v.toLocaleString();
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return fmt(v.result);
    if ('error' in v) return String(v.error);
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink);
    return String(v);
  }
  return fmt(v);
}

function mergeRangesFromExcelJs(ws) {
  const ranges = ws?.model?.merges;
  if (Array.isArray(ranges)) return ranges;
  // Fallback to the internal merge map if the serialized model isn't populated.
  const internal = ws?._merges;
  if (internal) {
    return Object.values(internal)
      .map((m) => m?.range || m?.model?.range)
      .filter(Boolean);
  }
  return [];
}

/** "A1:B2" (1-based) → { top, left, bottom, right } (0-based, inclusive). */
export function rangeToBox(ref, decodeCell) {
  const [a, b] = ref.split(':');
  const s = decodeCell(a);
  const e = decodeCell(b || a);
  return {
    top: Math.min(s.r, e.r),
    left: Math.min(s.c, e.c),
    bottom: Math.max(s.r, e.r),
    right: Math.max(s.c, e.c),
  };
}

// Minimal A1 decoder so this module needs no SheetJS dependency for ExcelJS ranges.
function decodeA1(a1) {
  const m = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!m) return { r: 0, c: 0 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

/** Build the model from an ExcelJS Workbook (used for .xlsx). */
export function buildModelFromExcelJS(workbook, { ssfFormat } = {}) {
  const sheets = [];
  workbook.eachSheet((ws) => {
    const cells = {};
    const colWidths = {};
    const rowHeights = {};
    let maxCol = 0;

    ws.eachRow({ includeEmpty: false }, (row, rNum) => {
      if (row.height) rowHeights[rNum - 1] = ptToPx(row.height);
      row.eachCell({ includeEmpty: false }, (cell, cNum) => {
        const text = excelJsCellText(cell, ssfFormat);
        const style = extractExcelJsStyle(cell);
        if (text !== '' || style) cells[`${rNum - 1},${cNum - 1}`] = style ? { text, style } : { text };
        if (cNum > maxCol) maxCol = cNum;
      });
    });

    (ws.columns || []).forEach((col, i) => {
      if (col && col.width) colWidths[i] = colWidthToPx(col.width);
    });

    const merges = mergeRangesFromExcelJs(ws).map((ref) => rangeToBox(ref, decodeA1));

    const view = (ws.views || [])[0];
    const frozen =
      view && view.state === 'frozen'
        ? { rows: view.ySplit || 0, cols: view.xSplit || 0 }
        : { rows: 0, cols: 0 };

    sheets.push({
      name: ws.name || `Sheet${sheets.length + 1}`,
      rowCount: ws.rowCount || 0,
      colCount: Math.max(ws.columnCount || 0, maxCol),
      cells,
      merges,
      colWidths,
      rowHeights,
      frozen,
    });
  });
  return { kind: 'spreadsheet', activeSheet: 0, sheets };
}

/** Build the model from a SheetJS workbook (used for legacy .xls; styling is minimal). */
export function buildModelFromSheetJS(wb, XLSX) {
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    const cells = {};
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        const text = cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : '';
        if (text !== '') cells[`${R - range.s.r},${C - range.s.c}`] = { text };
      }
    }
    const merges = (ws['!merges'] || []).map((m) => ({
      top: m.s.r - range.s.r,
      left: m.s.c - range.s.c,
      bottom: m.e.r - range.s.r,
      right: m.e.c - range.s.c,
    }));
    const colWidths = {};
    (ws['!cols'] || []).forEach((c, i) => {
      if (c && c.wpx) colWidths[i] = Math.round(c.wpx);
      else if (c && c.wch) colWidths[i] = colWidthToPx(c.wch);
    });
    return {
      name,
      rowCount: range.e.r - range.s.r + 1,
      colCount: range.e.c - range.s.c + 1,
      cells,
      merges,
      colWidths,
      rowHeights: {},
      frozen: { rows: 0, cols: 0 },
    };
  });
  return { kind: 'spreadsheet', activeSheet: 0, sheets };
}

/** Build the model from rows of strings (used for CSV via PapaParse). */
export function rowsToModel(rows, name = 'Sheet1') {
  const cells = {};
  let colCount = 0;
  rows.forEach((row, R) => {
    if (row.length > colCount) colCount = row.length;
    row.forEach((val, C) => {
      const text = val == null ? '' : String(val);
      if (text !== '') cells[`${R},${C}`] = { text };
    });
  });
  return {
    kind: 'spreadsheet',
    activeSheet: 0,
    sheets: [{ name, rowCount: rows.length, colCount, cells, merges: [], colWidths: {}, rowHeights: {}, frozen: { rows: 0, cols: 0 } }],
  };
}
