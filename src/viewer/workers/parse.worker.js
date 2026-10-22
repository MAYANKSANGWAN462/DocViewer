// Parse worker: unzips + parses spreadsheets off the main thread and posts back a plain-data
// model (see ../model/spreadsheet.js). Bundled by esbuild, so it imports npm libraries and the
// shared model helpers directly — keeping the viewer tab responsive during heavy parsing.

import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { buildModelFromExcelJS, buildModelFromSheetJS, rowsToModel } from '../model/spreadsheet.js';

const ssfFormat = (fmt, value) => XLSX.SSF.format(fmt, value);

async function parse(format, blob) {
  switch (format) {
    case 'xlsx': {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await blob.arrayBuffer());
      return buildModelFromExcelJS(wb, { ssfFormat });
    }
    case 'xls': {
      const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), {
        type: 'array',
        cellDates: true,
        cellNF: true,
      });
      return buildModelFromSheetJS(wb, XLSX);
    }
    case 'csv': {
      const text = await blob.text();
      const { data } = Papa.parse(text, { skipEmptyLines: false });
      return rowsToModel(data, 'CSV');
    }
    default:
      return { kind: 'none' };
  }
}

self.onmessage = async (e) => {
  const { id, blob, format } = e.data || {};
  try {
    const result = await parse(format, blob);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
