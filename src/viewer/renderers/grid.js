// Spreadsheet grid renderer: turns the plain-data model from the parse worker into a styled,
// Excel-like grid (column letters, row numbers, merged cells, column widths, sheet tabs).
//
// Two paths:
//   • Normal sheets (≤ FULL_RENDER_MAX_ROWS) → full table with merges + per-row heights.
//   • Large sheets → virtualized rows (fixed height, merges shown unmerged) so millions of rows
//     stay responsive. The windowing math (computeWindow) lives in the model module and is tested.

import { colName, DEFAULT_COL_PX, DEFAULT_ROW_PX, computeWindow } from '../model/spreadsheet.js';

const FULL_RENDER_MAX_ROWS = 500;
const MAX_COLS = 1024;
const VIRTUAL_ROW_PX = DEFAULT_ROW_PX;

function mapVAlign(v) {
  if (v === 'middle' || v === 'center') return 'middle';
  if (v === 'top') return 'top';
  return 'bottom'; // Excel default
}

function borderCss(b) {
  const width = b.style === 'thick' ? '3px' : b.style === 'medium' ? '2px' : '1px';
  const kind = /dash/i.test(b.style)
    ? 'dashed'
    : /dot/i.test(b.style)
      ? 'dotted'
      : b.style === 'double'
        ? 'double'
        : 'solid';
  return `${width} ${kind} ${b.color}`;
}

function applyStyle(td, style) {
  if (!style) return;
  const s = td.style;
  if (style.bold) s.fontWeight = '600';
  if (style.italic) s.fontStyle = 'italic';
  if (style.underline) s.textDecoration = 'underline';
  if (style.color) s.color = style.color;
  if (style.bg) s.backgroundColor = style.bg;
  if (style.halign) s.textAlign = style.halign;
  if (style.valign) s.verticalAlign = mapVAlign(style.valign);
  if (style.wrap) s.whiteSpace = 'normal';
  if (style.fontSize) s.fontSize = `${style.fontSize}pt`;
  if (style.fontName) s.fontFamily = `"${style.fontName}", system-ui, sans-serif`;
  if (style.borders) {
    if (style.borders.top) s.borderTop = borderCss(style.borders.top);
    if (style.borders.right) s.borderRight = borderCss(style.borders.right);
    if (style.borders.bottom) s.borderBottom = borderCss(style.borders.bottom);
    if (style.borders.left) s.borderLeft = borderCss(style.borders.left);
  }
}

function buildColgroup(sheet, colCount) {
  const colgroup = document.createElement('colgroup');
  const gutter = document.createElement('col');
  gutter.className = 'grid-table__gutter-col';
  colgroup.append(gutter);
  for (let c = 0; c < colCount; c++) {
    const col = document.createElement('col');
    col.style.width = `${sheet.colWidths?.[c] || DEFAULT_COL_PX}px`;
    colgroup.append(col);
  }
  return colgroup;
}

function buildHeader(colCount) {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'grid-table__corner';
  tr.append(corner);
  for (let c = 0; c < colCount; c++) {
    const th = document.createElement('th');
    th.className = 'grid-table__colhead';
    th.textContent = colName(c);
    tr.append(th);
  }
  thead.append(tr);
  return thead;
}

function renderRow(sheet, r, colCount, { covered, spanAt, fixedHeight } = {}) {
  const tr = document.createElement('tr');
  tr.style.height = `${fixedHeight || sheet.rowHeights?.[r] || DEFAULT_ROW_PX}px`;
  const rowHead = document.createElement('th');
  rowHead.className = 'grid-table__rowhead';
  rowHead.textContent = String(r + 1);
  tr.append(rowHead);
  for (let c = 0; c < colCount; c++) {
    const key = `${r},${c}`;
    if (covered && covered.has(key)) continue;
    const td = document.createElement('td');
    const cell = sheet.cells?.[key];
    if (cell) {
      td.textContent = cell.text;
      applyStyle(td, cell.style);
    }
    const span = spanAt && spanAt.get(key);
    if (span) {
      if (span.rowspan > 1) td.rowSpan = span.rowspan;
      if (span.colspan > 1) td.colSpan = span.colspan;
    }
    tr.append(td);
  }
  return tr;
}

function buildFullTable(sheet, colCount, rowCount) {
  const covered = new Set();
  const spanAt = new Map();
  for (const m of sheet.merges || []) {
    if (m.top >= rowCount || m.left >= colCount) continue;
    const bottom = Math.min(m.bottom, rowCount - 1);
    const right = Math.min(m.right, colCount - 1);
    spanAt.set(`${m.top},${m.left}`, { rowspan: bottom - m.top + 1, colspan: right - m.left + 1 });
    for (let r = m.top; r <= bottom; r++) {
      for (let c = m.left; c <= right; c++) {
        if (!(r === m.top && c === m.left)) covered.add(`${r},${c}`);
      }
    }
  }
  const table = document.createElement('table');
  table.className = 'grid-table';
  table.append(buildColgroup(sheet, colCount), buildHeader(colCount));
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rowCount; r++) tbody.append(renderRow(sheet, r, colCount, { covered, spanAt }));
  table.append(tbody);
  const scroller = document.createElement('div');
  scroller.className = 'grid-scroll';
  scroller.append(table);
  return scroller;
}

function buildVirtualTable(sheet, colCount, rowCount) {
  const scroller = document.createElement('div');
  scroller.className = 'grid-scroll';
  const table = document.createElement('table');
  table.className = 'grid-table';
  table.append(buildColgroup(sheet, colCount), buildHeader(colCount));
  const tbody = document.createElement('tbody');
  table.append(tbody);
  scroller.append(table);

  const makeSpacer = () => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colCount + 1;
    td.style.padding = '0';
    td.style.border = 'none';
    tr.append(td);
    return { tr, td };
  };
  const top = makeSpacer();
  const bottom = makeSpacer();

  let lastStart = -1;
  let lastEnd = -1;
  const paint = () => {
    const { start, end, topPad, bottomPad } = computeWindow(
      scroller.scrollTop,
      scroller.clientHeight || 600,
      VIRTUAL_ROW_PX,
      rowCount,
    );
    if (start === lastStart && end === lastEnd) return;
    lastStart = start;
    lastEnd = end;
    top.td.style.height = `${topPad}px`;
    bottom.td.style.height = `${bottomPad}px`;
    tbody.replaceChildren(top.tr);
    for (let r = start; r < end; r++) tbody.append(renderRow(sheet, r, colCount, { fixedHeight: VIRTUAL_ROW_PX }));
    tbody.append(bottom.tr);
  };

  let scheduled = false;
  scroller.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      paint();
    });
  });
  // clientHeight needs layout; paint now and again on the next frame once sized.
  paint();
  requestAnimationFrame(paint);
  return scroller;
}

function buildSheetTable(sheet) {
  const colCount = Math.min(Math.max(sheet.colCount, 1), MAX_COLS);
  const rowCount = Math.max(sheet.rowCount, 1);
  const frag = document.createDocumentFragment();

  if (rowCount > FULL_RENDER_MAX_ROWS) {
    const banner = document.createElement('div');
    banner.className = 'grid-banner';
    banner.textContent = `Large sheet (${rowCount.toLocaleString()} rows): rows are virtualized for performance — row heights are uniform and merged cells are shown unmerged.`;
    frag.append(banner, buildVirtualTable(sheet, colCount, rowCount));
  } else {
    frag.append(buildFullTable(sheet, colCount, rowCount));
  }
  return frag;
}

export async function renderSpreadsheet(mount, { parsed }) {
  if (!parsed || parsed.kind !== 'spreadsheet' || !Array.isArray(parsed.sheets) || !parsed.sheets.length) {
    throw new Error('Could not read the spreadsheet contents.');
  }

  const root = document.createElement('div');
  root.className = 'grid';
  mount.append(root);

  const sheetHost = document.createElement('div');
  sheetHost.className = 'grid__host';
  root.append(sheetHost);

  let active = parsed.activeSheet || 0;
  const renderSheet = () => sheetHost.replaceChildren(buildSheetTable(parsed.sheets[active]));

  if (parsed.sheets.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'grid__tabs';
    parsed.sheets.forEach((s, i) => {
      const tab = document.createElement('button');
      tab.className = 'grid__tab';
      tab.type = 'button';
      tab.textContent = s.name || `Sheet${i + 1}`;
      tab.setAttribute('aria-pressed', String(i === active));
      tab.addEventListener('click', () => {
        active = i;
        for (const child of tabs.children) child.setAttribute('aria-pressed', 'false');
        tab.setAttribute('aria-pressed', 'true');
        renderSheet();
      });
      tabs.append(tab);
    });
    root.append(tabs);
  }

  renderSheet();
}
