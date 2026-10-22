// Round-trip test for the spreadsheet model builder: write a styled workbook with ExcelJS,
// read it back, normalize it, and assert values / number formats / styles / merges survive.
// Run: npm test
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { buildModelFromExcelJS, rowsToModel, colName, computeWindow } from '../src/viewer/model/spreadsheet.js';

const ssfFormat = (fmt, value) => XLSX.SSF.format(fmt, value);
let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`✓ ${name}`);
};

// ---- colName ----
check('colName', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(27), 'AB');
});

// ---- computeWindow (virtualization) ----
check('computeWindow', () => {
  const w = computeWindow(0, 200, 20, 1000, 0); // 200px / 20px = 10 visible rows
  assert.equal(w.start, 0);
  assert.equal(w.end, 10);
  assert.equal(w.topPad, 0);
  assert.equal(w.bottomPad, (1000 - 10) * 20);

  const w2 = computeWindow(1000, 200, 20, 1000, 2); // scrollTop 1000 → row 50, overscan 2
  assert.equal(w2.start, 48);
  assert.equal(w2.topPad, 48 * 20);
  assert.ok(w2.end <= 1000 && w2.end >= 60);
});

// ---- rowsToModel (CSV path) ----
check('rowsToModel', () => {
  const model = rowsToModel([['a', 'b'], ['c']], 'CSV');
  const s = model.sheets[0];
  assert.equal(model.kind, 'spreadsheet');
  assert.equal(s.colCount, 2);
  assert.equal(s.rowCount, 2);
  assert.equal(s.cells['0,0'].text, 'a');
  assert.equal(s.cells['0,1'].text, 'b');
  assert.equal(s.cells['1,0'].text, 'c');
  assert.equal(s.cells['1,1'], undefined);
});

// ---- ExcelJS round-trip ----
const model = await (async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getColumn(1).width = 20;

  ws.getCell('A1').value = 'Name';
  ws.getCell('A1').font = { bold: true };
  ws.getCell('B1').value = 'Amount';

  ws.getCell('A2').value = 'Widget';
  const amount = ws.getCell('B2');
  amount.value = 1234.5;
  amount.numFmt = '#,##0.00';

  const merged = ws.getCell('A3');
  merged.value = 'Merged';
  merged.alignment = { horizontal: 'center' };
  merged.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.mergeCells('A3:B3');

  ws.getCell('A4').value = new Date(Date.UTC(2020, 0, 15));
  ws.getCell('A4').numFmt = 'yyyy-mm-dd';

  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  return buildModelFromExcelJS(wb2, { ssfFormat });
})();

const sheet = model.sheets[0];

check('sheet metadata', () => {
  assert.equal(model.sheets.length, 1);
  assert.equal(sheet.name, 'Data');
  assert.ok(sheet.colWidths[0] > 0, 'column A width captured');
});

check('values + bold', () => {
  assert.equal(sheet.cells['0,0'].text, 'Name');
  assert.equal(sheet.cells['0,0'].style.bold, 1);
  assert.equal(sheet.cells['1,0'].text, 'Widget');
});

check('number format applied', () => {
  assert.equal(sheet.cells['1,1'].text, '1,234.50');
});

check('merge + fill + align', () => {
  assert.ok(
    sheet.merges.some((m) => m.top === 2 && m.left === 0 && m.bottom === 2 && m.right === 1),
    'A3:B3 merge captured',
  );
  assert.equal(sheet.cells['2,0'].text, 'Merged');
  assert.equal(sheet.cells['2,0'].style.halign, 'center');
  assert.ok(sheet.cells['2,0'].style.bg, 'fill color captured');
});

check('date format', () => {
  assert.match(sheet.cells['3,0'].text, /2020-01-1[45]/);
});

console.log(`\n${passed} checks passed`);
