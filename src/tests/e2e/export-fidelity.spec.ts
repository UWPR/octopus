import { test, expect } from '@playwright/test';
import path from 'path';
import ExcelJS from 'exceljs';
import fs from 'fs';
import {
  uploadConfigureAndRandomize,
  NUM_PLATES,
  NUM_ROWS,
  NUM_COLUMNS,
  TOTAL_SAMPLES,
  EXPECTED_GROUPS,
} from './helpers';

/**
 * Export Fidelity Tests
 *
 * Verifies that exported Excel files accurately match the browser display:
 * 1. Sample positions (plate, row, column) match between browser and Excel
 * 2. Cell colors match between browser and Excel
 * 3. Legend sheet has correct covariate groups with exact sample counts
 */

// --- Color helpers ---

function argbToRgb(argb: string): string {
  if (!argb) return '';
  const rgb = argb.length === 8 ? argb.substring(2) : argb;
  return `#${rgb.toLowerCase()}`;
}

function normalizeColor(color: string): string {
  if (!color) return '';
  if (color.startsWith('#')) return color.toLowerCase();
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color.toLowerCase();
}

// --- Excel export helper ---

async function exportAndSaveExcel(page: import('@playwright/test').Page, filename: string): Promise<string> {
  await page.getByRole('button', { name: 'Download Excel' }).click();
  await expect(page.getByText('Select Covariates for Excel Export')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export.*selected/ }).click();
  const download = await downloadPromise;

  const downloadPath = path.join(__dirname, filename);
  await download.saveAs(downloadPath);
  return downloadPath;
}

function cleanupFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// --- Tests ---

test.describe('Export Fidelity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus Plate Designer' })).toBeVisible();
  });

  test('Excel export matches browser plate layout', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Switch to full-size view to read sample names from DOM
    await page.getByRole('button', { name: 'Full Size View' }).click();
    await page.waitForTimeout(1000);

    // Scrape sample data from browser
    const browserData = await page.evaluate(() => {
      const samples: { sampleId: string; plateIndex: number; rowIndex: number; colIndex: number; backgroundColor: string }[] = [];

      const allDraggables = Array.from(document.querySelectorAll('[draggable="true"]'));

      allDraggables.forEach(card => {
        const h3 = card.querySelector('h3');
        if (!h3) return;
        const sampleId = h3.textContent?.trim() || '';
        if (!sampleId) return;

        // Get background color from the header div.
        // For solid fills, backgroundColor has the color directly.
        // For striped/gradient fills (QC samples), the `background` shorthand
        // overrides backgroundColor to transparent — extract the color from
        // the backgroundImage gradient string instead.
        // For outline fills, the color is in the border.
        const headerDiv = card.querySelector('div');
        let backgroundColor = '';
        if (headerDiv) {
          const computed = window.getComputedStyle(headerDiv);
          const bg = computed.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            backgroundColor = bg;
          } else {
            // Gradient case: backgroundImage looks like
            // "repeating-linear-gradient(45deg, rgb(128, 0, 128), rgb(128, 0, 128) 3px, ...)"
            const gradientMatch = computed.backgroundImage?.match(/rgb\(\d+,\s*\d+,\s*\d+\)/);
            if (gradientMatch) {
              backgroundColor = gradientMatch[0];
            } else {
              // Outline case: color is in the border
              const border = computed.borderColor;
              if (border && border !== 'rgb(0, 0, 0)') {
                backgroundColor = border;
              }
            }
          }
        }

        // Find plate index by walking up to find "Plate N" heading
        let plateIndex = -1;
        let element: Element | null = card;
        while (element) {
          const allHeadings = Array.from(element.querySelectorAll('div'));
          for (const h of allHeadings) {
            const match = h.textContent?.match(/^Plate (\d+)$/);
            if (match) {
              plateIndex = parseInt(match[1]) - 1;
              break;
            }
          }
          if (plateIndex >= 0) break;
          element = element.parentElement;
        }

        // Get row/column from grid position
        const cellContainer = card.parentElement;
        if (!cellContainer) return;
        const row = cellContainer.parentElement;
        if (!row) return;
        const cells = Array.from(row.children);
        const colIndex = cells.indexOf(cellContainer) - 1; // -1 for row label
        const grid = row.parentElement;
        if (!grid) return;
        const rows = Array.from(grid.children);
        const rowIndex = rows.indexOf(row) - 1; // -1 for column header row

        if (colIndex >= 0 && rowIndex >= 0) {
          samples.push({ sampleId, plateIndex, rowIndex, colIndex, backgroundColor });
        }
      });

      return samples;
    });

    expect(browserData.length).toBe(TOTAL_SAMPLES);

    // Export to Excel
    const downloadPath = await exportAndSaveExcel(page, 'temp-export.xlsx');

    // Parse Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(downloadPath);

    const excelData: { sampleId: string; plateIndex: number; rowIndex: number; colIndex: number; fillColor: string }[] = [];

    for (let plateIndex = 0; plateIndex < NUM_PLATES; plateIndex++) {
      const sheet = workbook.getWorksheet(`Plate ${plateIndex + 1}`);
      expect(sheet).toBeTruthy();
      if (!sheet) continue;

      for (let rowIndex = 0; rowIndex < NUM_ROWS; rowIndex++) {
        for (let colIndex = 0; colIndex < NUM_COLUMNS; colIndex++) {
          // Sample name is in 2nd sub-row: Excel row = 3 + (rowIndex * 3) + 1
          const sampleNameRow = 3 + (rowIndex * 3) + 1;
          const sampleNameCell = sheet.getCell(sampleNameRow, colIndex + 2);
          const sampleId = sampleNameCell.value?.toString()?.trim();
          if (!sampleId) continue;

          // Color is in 1st sub-row: Excel row = 3 + (rowIndex * 3)
          const colorRow = 3 + (rowIndex * 3);
          const colorCell = sheet.getCell(colorRow, colIndex + 2);
          let fillColor = '';
          const fill = colorCell.fill;
          if (fill && fill.type === 'pattern') {
            const patternFill = fill as ExcelJS.FillPattern;
            if (patternFill.fgColor?.argb) {
              fillColor = argbToRgb(patternFill.fgColor.argb);
            }
          }
          // Outline case: color is in the border, not the fill
          if (!fillColor && colorCell.border) {
            const borderColor = (colorCell.border.top as any)?.color?.argb;
            if (borderColor) {
              fillColor = argbToRgb(borderColor);
            }
          }

          excelData.push({ sampleId, plateIndex, rowIndex, colIndex, fillColor });
        }
      }
    }

    expect(excelData.length).toBe(TOTAL_SAMPLES);

    // Compare: every sample must match position exactly
    const browserBySampleId = new Map(browserData.map(s => [s.sampleId, s]));
    const excelBySampleId = new Map(excelData.map(s => [s.sampleId, s]));

    // All browser samples must exist in Excel with matching positions and colors
    const missingSamples: string[] = [];
    const positionMismatches: string[] = [];
    const colorMismatches: string[] = [];
    const missingBrowserColor: string[] = [];
    const missingExcelColor: string[] = [];

    for (const sampleId of Array.from(browserBySampleId.keys())) {
      const browser = browserBySampleId.get(sampleId)!;
      const excel = excelBySampleId.get(sampleId);

      if (!excel) {
        missingSamples.push(sampleId);
        continue;
      }

      if (browser.plateIndex !== excel.plateIndex ||
          browser.rowIndex !== excel.rowIndex ||
          browser.colIndex !== excel.colIndex) {
        positionMismatches.push(
          `${sampleId}: browser(P${browser.plateIndex + 1},R${browser.rowIndex},C${browser.colIndex}) vs excel(P${excel.plateIndex + 1},R${excel.rowIndex},C${excel.colIndex})`
        );
      }

      const browserColor = normalizeColor(browser.backgroundColor);
      const excelColor = normalizeColor(excel.fillColor);

      // Every sample must have a color in both browser and Excel
      if (!browserColor) missingBrowserColor.push(sampleId);
      if (!excelColor) missingExcelColor.push(sampleId);

      if (browserColor && excelColor && browserColor !== excelColor) {
        colorMismatches.push(`${sampleId}: browser(${browserColor}) vs excel(${excelColor})`);
      }
    }

    // Zero tolerance on all checks
    expect(missingSamples).toEqual([]);
    expect(positionMismatches).toEqual([]);
    expect(missingBrowserColor).toEqual([]);
    expect(missingExcelColor).toEqual([]);
    expect(colorMismatches).toEqual([]);

    cleanupFile(downloadPath);
  });

  test('Excel legend sheet has correct covariate groups and counts', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    const downloadPath = await exportAndSaveExcel(page, 'temp-legend-export.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(downloadPath);

    const legendSheet = workbook.getWorksheet('Legend');
    expect(legendSheet).toBeTruthy();
    if (!legendSheet) return;

    // Find the header row dynamically (contains "Condition" in some cell)
    // Use columnCount instead of cellCount — cellCount can be unreliable after merges
    const maxCol = legendSheet.columnCount || 20;
    let headerRowNum = -1;
    for (let r = 1; r <= legendSheet.rowCount; r++) {
      for (let c = 1; c <= maxCol; c++) {
        if (legendSheet.getCell(r, c).value === 'Condition') {
          headerRowNum = r;
          break;
        }
      }
      if (headerRowNum > 0) break;
    }
    expect(headerRowNum).toBeGreaterThan(0);

    // Determine column indices from the header row
    const colIndex: Record<string, number> = {};
    for (let c = 1; c <= maxCol; c++) {
      const val = legendSheet.getCell(headerRowNum, c).value?.toString();
      if (val) colIndex[val] = c;
    }

    // Verify exact header columns exist
    expect(colIndex['Condition']).toBeDefined();
    expect(colIndex['Radiaion Dose_cGy']).toBeDefined();
    expect(colIndex['Focus Area']).toBeDefined();
    expect(colIndex['Total']).toBeDefined();
    expect(colIndex['Plate 1']).toBeDefined();
    expect(colIndex['Plate 2']).toBeDefined();
    expect(colIndex['Plate 3']).toBeDefined();

    // Parse data rows and verify exact covariate key → count mapping
    const actualGroups: Record<string, number> = {};
    const perPlateGroups: Record<string, number[]> = {};

    for (let rowNum = headerRowNum + 1; rowNum <= legendSheet.rowCount; rowNum++) {
      const row = legendSheet.getRow(rowNum);
      const total = row.getCell(colIndex['Total']).value;
      if (!total || typeof total !== 'number') continue;

      const condition = row.getCell(colIndex['Condition']).value?.toString() || '';
      const dose = row.getCell(colIndex['Radiaion Dose_cGy']).value?.toString() || '';
      const focusArea = row.getCell(colIndex['Focus Area']).value?.toString() || '';
      const key = `${condition}|${dose}|${focusArea}`;

      actualGroups[key] = total;

      // Collect per-plate counts
      const plateCounts: number[] = [];
      for (let p = 0; p < NUM_PLATES; p++) {
        const plateCount = row.getCell(colIndex[`Plate ${p + 1}`]).value;
        plateCounts.push(typeof plateCount === 'number' ? plateCount : 0);
      }
      perPlateGroups[key] = plateCounts;
    }

    // Verify exact group counts match expected
    expect(actualGroups).toEqual(EXPECTED_GROUPS);

    // Verify per-plate counts sum to total for each group
    for (const [key, total] of Object.entries(actualGroups)) {
      const plateCounts = perPlateGroups[key];
      const plateSum = plateCounts.reduce((sum, c) => sum + c, 0);
      expect(plateSum).toBe(total);
    }

    // Verify overall total
    const grandTotal = Object.values(actualGroups).reduce((sum, c) => sum + c, 0);
    expect(grandTotal).toBe(TOTAL_SAMPLES);

    cleanupFile(downloadPath);
  });

  test('Excel has correct sheet structure', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    const downloadPath = await exportAndSaveExcel(page, 'temp-structure-export.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(downloadPath);

    // Verify exact sheet names
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toEqual(['Plate 1', 'Plate 2', 'Plate 3', 'Legend', 'Sample Details']);

    // Verify each plate sheet has correct structure
    for (let i = 0; i < NUM_PLATES; i++) {
      const sheet = workbook.getWorksheet(`Plate ${i + 1}`);
      expect(sheet).toBeTruthy();
      if (!sheet) continue;

      // Row 1: Title
      expect(sheet.getCell(1, 1).value).toBe(`Plate ${i + 1}`);

      // Row 2: Column headers (01 through 12)
      for (let col = 0; col < NUM_COLUMNS; col++) {
        expect(sheet.getCell(2, col + 2).value).toBe((col + 1).toString().padStart(2, '0'));
      }

      // Row labels (A through H) in first column of each well's first sub-row
      for (let row = 0; row < NUM_ROWS; row++) {
        const excelRow = 3 + (row * 3); // First sub-row of each well
        expect(sheet.getCell(excelRow, 1).value).toBe(String.fromCharCode(65 + row));
      }
    }

    // Verify Sample Details sheet has correct headers and all 288 samples
    const detailsSheet = workbook.getWorksheet('Sample Details');
    expect(detailsSheet).toBeTruthy();
    if (detailsSheet) {
      // Verify header row has the expected columns
      // Headers: Sample Name, Plate, Well, Color, then treatment covariates, then other covariates
      expect(detailsSheet.getCell(1, 1).value).toBe('Sample Name');
      expect(detailsSheet.getCell(1, 2).value).toBe('Plate');
      expect(detailsSheet.getCell(1, 3).value).toBe('Well');
      expect(detailsSheet.getCell(1, 4).value).toBe('Color');

      // Count data rows (skip header row)
      let sampleCount = 0;
      for (let rowNum = 2; rowNum <= detailsSheet.rowCount; rowNum++) {
        const row = detailsSheet.getRow(rowNum);
        if (row.getCell(1).value) sampleCount++;
      }
      expect(sampleCount).toBe(TOTAL_SAMPLES);

      // Verify every sample has a Plate number (1-3) and a Well position (e.g. A01)
      const invalidPlates: string[] = [];
      const invalidWells: string[] = [];
      for (let rowNum = 2; rowNum <= detailsSheet.rowCount; rowNum++) {
        const row = detailsSheet.getRow(rowNum);
        const sampleName = row.getCell(1).value?.toString();
        if (!sampleName) continue;

        const plate = row.getCell(2).value;
        if (typeof plate !== 'number' || plate < 1 || plate > NUM_PLATES) {
          invalidPlates.push(`${sampleName}: plate=${plate}`);
        }

        const well = row.getCell(3).value?.toString() || '';
        if (!/^[A-H](0[1-9]|1[0-2])$/.test(well)) {
          invalidWells.push(`${sampleName}: well=${well}`);
        }
      }
      expect(invalidPlates).toEqual([]);
      expect(invalidWells).toEqual([]);
    }

    // Verify Legend sheet has "Color Legend" title
    const legendSheet = workbook.getWorksheet('Legend');
    expect(legendSheet).toBeTruthy();
    if (legendSheet) {
      expect(legendSheet.getCell(1, 1).value).toBe('Color Legend');
    }

    cleanupFile(downloadPath);
  });
});
