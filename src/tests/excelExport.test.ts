/**
 * Legend-sheet tests for the Excel export (Part A of covariate-key-fragility).
 *
 * The legend must read covariate values from structured metadata (not by
 * splitting the key), classify QC by the sample's real QC status (not by the
 * key's part count), and render a covariate cell blank only when the value is
 * genuinely missing (a present "na" is rendered literally).
 */

import ExcelJS from 'exceljs';
import { buildLayoutWorkbook } from '../utils/excelExport';
import { buildProcessedSearches } from '../utils/utils';
import { SearchData, CovariateColorInfo, CovariateConfig } from '../utils/types';

const TREATMENT_COVARIATES = ['Treatment', 'Dose'];
const QC_COLUMN = 'QC';
const SELECTED_QC_VALUES = ['Ref'];

const color = (): CovariateColorInfo => ({
  color: '#ff0000',
  useOutline: false,
  useStripes: false,
  textColor: '#000',
});

const mk = (metadata: { [k: string]: string }): SearchData => ({ name: 'sample', metadata });

function buildLegendSheet(samples: SearchData[]): ExcelJS.Worksheet {
  const config: CovariateConfig = {
    selectedCovariates: TREATMENT_COVARIATES,
    qcColumn: QC_COLUMN,
    selectedQcValues: SELECTED_QC_VALUES,
  };
  // Sets covariateKey (escape-encoded) and isQC on each sample, as the app does.
  buildProcessedSearches(samples, config);

  const covariateColors: { [key: string]: CovariateColorInfo } = {};
  samples.forEach(s => { covariateColors[s.covariateKey!] = color(); });

  const plate = [samples]; // one row holding all samples
  const workbook = buildLayoutWorkbook({
    searches: samples,
    randomizedPlates: [plate],
    covariateColors,
    treatmentCovariates: TREATMENT_COVARIATES,
    exportCovariates: TREATMENT_COVARIATES,
    numRows: 1,
    numColumns: samples.length,
    qcColumn: QC_COLUMN,
  });
  return workbook.getWorksheet('Legend')!;
}

// Parse the legend into an array of { header -> cell text } rows, locating the
// header row by its known 'Color' label rather than a hardcoded row number.
function readLegendRows(sheet: ExcelJS.Worksheet): Array<{ [header: string]: string }> {
  const MAX_COL = 20;
  let headerRowNum = -1;
  for (let r = 1; r <= sheet.rowCount && headerRowNum < 0; r++) {
    for (let c = 1; c <= MAX_COL; c++) {
      if (sheet.getCell(r, c).value === 'Color') { headerRowNum = r; break; }
    }
  }
  expect(headerRowNum).toBeGreaterThan(0);

  const headers: string[] = [];
  for (let c = 1; c <= MAX_COL; c++) {
    const v = sheet.getCell(headerRowNum, c).value;
    headers[c] = v == null ? '' : String(v);
  }

  const rows: Array<{ [header: string]: string }> = [];
  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row: { [header: string]: string } = {};
    let hasContent = false;
    for (let c = 1; c <= MAX_COL; c++) {
      const header = headers[c];
      if (!header) continue;
      const v = sheet.getCell(r, c).value;
      row[header] = v == null ? '' : String(v);
      if (row[header] !== '') hasContent = true;
    }
    if (hasContent) rows.push(row);
  }
  return rows;
}

describe('Excel legend structured decode and flag-based QC', () => {
  it('reads values from metadata, classifies QC by status, and blanks only missing', () => {
    const withPipe = mk({ Treatment: 'Drug|Hi', Dose: '10', QC: '' }); // non-QC, value has delimiter
    const qcNa = mk({ Treatment: 'na', Dose: '5', QC: 'Ref' });        // real QC, present 'na' value
    const missing = mk({ Treatment: 'Ctrl', Dose: '', QC: '' });       // non-QC, genuinely missing Dose

    const sheet = buildLegendSheet([withPipe, qcNa, missing]);
    const rows = readLegendRows(sheet);

    // Delimiter value stays intact and is NOT filed under the QC column.
    const a = rows.find(r => r['Dose'] === '10');
    expect(a).toBeDefined();
    expect(a!['Treatment']).toBe('Drug|Hi');
    expect(a!['QC']).toBe('');

    // A real QC sample is placed under the QC column; a present 'na' is literal.
    const b = rows.find(r => r['Dose'] === '5');
    expect(b).toBeDefined();
    expect(b!['QC']).toBe('Ref');
    expect(b!['Treatment']).toBe('na');

    // A genuinely missing value renders blank (not 'N/A').
    const c = rows.find(r => r['Treatment'] === 'Ctrl');
    expect(c).toBeDefined();
    expect(c!['Dose']).toBe('');
    expect(c!['QC']).toBe('');
  });
});
