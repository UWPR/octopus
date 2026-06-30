import ExcelJS from 'exceljs';
import { SearchData, CovariateColorInfo } from './types';
import { getCovariateKey } from './utils';

interface ExcelExportOptions {
  searches: SearchData[];
  randomizedPlates: (SearchData | undefined)[][][];
  covariateColors: { [key: string]: CovariateColorInfo };
  treatmentCovariates: string[]; // Covariates used for randomization (for color lookup)
  exportCovariates: string[]; // Covariates to display in plate cells of Excel export
  numRows: number;
  numColumns: number;
  inputFileName?: string;
  qcColumn?: string; // QC/Reference column name (for legend display when not in treatmentCovariates)
}

// Style constants
const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'thin' };

const THIN_BLACK_BORDERS: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' }
};

const THICK_BORDER_STYLE: ExcelJS.BorderStyle = 'thick';

const WHITE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' }
};

const createThickColoredBorder = (argbColor: string): Partial<ExcelJS.Borders> => ({
  top: { style: THICK_BORDER_STYLE, color: { argb: argbColor } },
  left: { style: THICK_BORDER_STYLE, color: { argb: argbColor } },
  bottom: { style: THICK_BORDER_STYLE, color: { argb: argbColor } },
  right: { style: THICK_BORDER_STYLE, color: { argb: argbColor } }
});

const createStripedFill = (argbColor: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'darkUp',
  fgColor: { argb: argbColor },
  bgColor: { argb: 'FFFFFFFF' }
});

const createSolidFill = (argbColor: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: argbColor }
});

/**
 * Build the plate-randomization workbook (plate sheets, legend, sample details) in memory.
 * Pure and DOM-free, so it is reusable and unit-testable; exportToExcel adds the download.
 */
export function buildLayoutWorkbook(options: ExcelExportOptions): ExcelJS.Workbook {
  const { searches, randomizedPlates, covariateColors, treatmentCovariates, exportCovariates, numRows, numColumns, qcColumn } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Octopus';
  workbook.created = new Date();

  // Calculate optimal column width once for all plates
  const columnWidth = calculateOptimalColumnWidth(searches, exportCovariates);

  // Create a sheet for each plate
  randomizedPlates.forEach((plate, plateIndex) => {
    createPlateSheet(workbook, plate, plateIndex, covariateColors, treatmentCovariates, exportCovariates, numRows, numColumns, columnWidth);
  });

  // Create legend sheet (always uses treatment covariates for color grouping)
  createLegendSheet(workbook, searches, covariateColors, treatmentCovariates, randomizedPlates, qcColumn);

  // Create sample details sheet (uses treatment covariates for color lookup)
  createSampleDetailsSheet(workbook, searches, treatmentCovariates, randomizedPlates, covariateColors);

  return workbook;
}

/**
 * Export plate layouts to Excel with colored cells and formatting
 */
export async function exportToExcel(options: ExcelExportOptions): Promise<void> {
  const workbook = buildLayoutWorkbook(options);

  // Generate output filename based on input filename
  let outputFileName = 'plate-randomization_octopus.xlsx';
  if (options.inputFileName) {
    const baseName = options.inputFileName.replace(/\.[^/.]+$/, ''); // Remove extension
    outputFileName = `${baseName}_octopus.xlsx`;
  }

  // Generate and download the file
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = outputFileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Calculate optimal column width based on all sample content
 * Returns a single width to be used for all columns on all plates
 */
function calculateOptimalColumnWidth(
  searches: SearchData[],
  selectedCovariates: string[]
): number {
  const CHAR_WIDTH = 0.9; // Approximate character width in Excel units
  const MIN_WIDTH = 10;
  const MAX_WIDTH = 20;

  let maxLength = 0;

  // Check all samples
  searches.forEach(sample => {
    // Check sample name length
    maxLength = Math.max(maxLength, sample.name.length);

    // Check covariate value lengths (format: "covariate: value")
    selectedCovariates.forEach(cov => {
      const covariateText = `${cov}: ${sample.metadata[cov] || 'N/A'}`;
      maxLength = Math.max(maxLength, covariateText.length);
    });
  });

  // Calculate width based on max length, with min and max constraints
  const calculatedWidth = maxLength * CHAR_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, calculatedWidth));
}

/**
 * Create a sheet for a single plate with 3-row cells
 */
function createPlateSheet(
  workbook: ExcelJS.Workbook,
  plate: (SearchData | undefined)[][],
  plateIndex: number,
  covariateColors: { [key: string]: CovariateColorInfo },
  treatmentCovariates: string[],
  exportCovariates: string[],
  numRows: number,
  numColumns: number,
  columnWidth: number
): void {
  const sheet = workbook.addWorksheet(`Plate ${plateIndex + 1}`);

  // Apply the pre-calculated column width to all columns
  sheet.columns = [
    { width: 5 }, // Row label column
    ...Array(numColumns).fill({ width: columnWidth })
  ];

  // Add title
  const titleRow = sheet.addRow([`Plate ${plateIndex + 1}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, numColumns + 1);

  // Add column headers (01, 02, 03... 12)
  const headerRow = sheet.addRow(['', ...Array.from({ length: numColumns }, (_, i) => (i + 1).toString().padStart(2, '0'))]);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

  // Add each row of wells (each well = 3 rows)
  for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
    const rowLabel = String.fromCharCode(65 + rowIndex); // A, B, C...

    for (let subRow = 0; subRow < 3; subRow++) {
      const excelRow = sheet.addRow(['']);

      // Set row label only on first sub-row
      if (subRow === 0) {
        excelRow.getCell(1).value = rowLabel;
        excelRow.getCell(1).font = { bold: true };
        excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      }

      // Process each column
      for (let colIndex = 0; colIndex < numColumns; colIndex++) {
        const sample = plate[rowIndex]?.[colIndex];
        const cell = excelRow.getCell(colIndex + 2); // +2 because column 1 is row label

        // Add default thin border to all cells first
        cell.border = THIN_BLACK_BORDERS;

        if (sample) {
          // Use covariateKey for color lookup
          const colorInfo = covariateColors[getCovariateKey(sample)];

          if (subRow === 0) {
            // Row 1: Color indicator (this will override the border if needed)
            formatColorIndicatorCell(cell, colorInfo);
          } else if (subRow === 1) {
            // Row 2: Sample name
            cell.value = sample.name;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.font = { bold: true };
          } else {
            // Row 3: Covariate values
            const covariateText = exportCovariates
              .map(cov => `${cov}: ${sample.metadata[cov] || 'N/A'}`)
              .join('\n');
            cell.value = covariateText;
            cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
            cell.font = { size: 9 };
          }
        } else {
          // Empty well - white background
          cell.fill = WHITE_FILL;
        }
      }

      // Set row height
      if (subRow === 0) {
        excelRow.height = 20; // Color indicator row
      } else if (subRow === 1) {
        excelRow.height = 20; // Sample name row
      } else {
        // Covariate values row - calculate height based on number of covariates
        // Each covariate line needs approximately 15-18 pixels, plus some padding
        const lineHeight = 16;
        const padding = 8;
        const calculatedHeight = (exportCovariates.length * lineHeight) + padding;
        excelRow.height = Math.max(30, calculatedHeight); // Minimum 30, scales with covariates
      }
    }
  }
}

/**
 * Format the color indicator cell (row 1 of each well)
 */
function formatColorIndicatorCell(cell: ExcelJS.Cell, colorInfo: CovariateColorInfo): void {
  const argbColor = hexToArgb(colorInfo.color);

  if (colorInfo.useStripes) {
    // Striped pattern: diagonal stripes with color and white background
    cell.fill = createStripedFill(argbColor);
  } else if (colorInfo.useOutline) {
    // Outline: thick colored border with white background
    cell.fill = WHITE_FILL;
    cell.border = createThickColoredBorder(argbColor);
    // Add a space to ensure the cell is not completely empty
    cell.value = ' ';
  } else {
    // Solid fill
    cell.fill = createSolidFill(argbColor);
  }
}

/**
 * Create legend sheet with color key and sample counts
 */
function createLegendSheet(
  workbook: ExcelJS.Workbook,
  searches: SearchData[],
  covariateColors: { [key: string]: CovariateColorInfo },
  treatmentCovariates: string[],
  randomizedPlates: (SearchData | undefined)[][][],
  qcColumn?: string
): void {
  const sheet = workbook.addWorksheet('Legend');

  // Determine if QC column needs its own header column
  const qcColumnInCovariates = qcColumn ? treatmentCovariates.includes(qcColumn) : true;
  const showQcColumn = qcColumn && !qcColumnInCovariates;

  // Build the legend column headers: Color | [QC Column] | ...treatmentCovariates | Total | Plate 1 | ...
  const legendCovHeaders = showQcColumn
    ? [qcColumn, ...treatmentCovariates]
    : [...treatmentCovariates];

  // Title
  const titleRow = sheet.addRow(['Color Legend']);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, 4);

  // Count samples by covariate combination (total) - use treatment covariates
  const combinationCounts = new Map<string, number>();
  searches.forEach(search => {
    const key = getCovariateKey(search);
    combinationCounts.set(key, (combinationCounts.get(key) || 0) + 1);
  });

  // Count samples by covariate combination per plate - use treatment covariates
  const plateCounts = new Map<string, Map<number, number>>(); // combination -> plate -> count
  randomizedPlates.forEach((plate, plateIndex) => {
    plate.forEach(row => {
      row.forEach(sample => {
        if (sample) {
          const key = getCovariateKey(sample);
          if (!plateCounts.has(key)) {
            plateCounts.set(key, new Map());
          }
          const plateMap = plateCounts.get(key)!;
          plateMap.set(plateIndex, (plateMap.get(plateIndex) || 0) + 1);
        }
      });
    });
  });

  // Headers
  sheet.addRow([]);
  const plateHeaders = randomizedPlates.map((_, i) => `Plate ${i + 1}`);
  const headerRow = sheet.addRow(['Color', ...legendCovHeaders, 'Total', ...plateHeaders]);
  headerRow.font = { bold: true };

  // Sort by count (descending)
  const sortedCombinations = Array.from(combinationCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  // Add each covariate combination
  sortedCombinations.forEach(([combination, count]) => {
    const colorInfo = covariateColors[combination];
    if (!colorInfo) return;

    const values = combination.split('|');

    // Build display values aligned to legendCovHeaders
    let displayValues: string[];
    if (showQcColumn && values.length > treatmentCovariates.length) {
      // QC group: key is "QcType|na|na|..." — first value is QC type, rest are placeholders
      const qcType = values[0];
      const covValues = values.slice(1).map(v => {
        const lower = v.toLowerCase();
        return (lower === 'na' || lower === 'n/a') ? '' : v;
      });
      // Pad to match treatmentCovariates length if needed
      while (covValues.length < treatmentCovariates.length) covValues.push('');
      displayValues = [qcType, ...covValues.slice(0, treatmentCovariates.length)];
    } else if (showQcColumn) {
      // Non-QC group: no QC column value, just treatment covariate values
      displayValues = ['', ...values];
      // Pad to match legendCovHeaders length
      while (displayValues.length < legendCovHeaders.length) displayValues.push('');
      displayValues = displayValues.slice(0, legendCovHeaders.length);
    } else {
      displayValues = values;
    }

    // Get per-plate counts for this combination
    const plateCountsForCombination = plateCounts.get(combination) || new Map();
    const perPlateCounts = randomizedPlates.map((_, plateIndex) =>
      plateCountsForCombination.get(plateIndex) || 0
    );

    const row = sheet.addRow(['', ...displayValues, count, ...perPlateCounts]);

    // Color the first cell
    const colorCell = row.getCell(1);
    const argbColor = hexToArgb(colorInfo.color);

    if (colorInfo.useStripes) {
      // Striped pattern: diagonal stripes with color and white background
      colorCell.fill = createStripedFill(argbColor);
      colorCell.border = THIN_BLACK_BORDERS;
    } else if (colorInfo.useOutline) {
      // Outline: thick colored border with white background
      colorCell.fill = WHITE_FILL;
      colorCell.border = createThickColoredBorder(argbColor);
    } else {
      // Solid fill
      colorCell.fill = createSolidFill(argbColor);
      colorCell.border = THIN_BLACK_BORDERS;
    }
  });

  // Set column widths
  sheet.getColumn(1).width = 10; // Color
  legendCovHeaders.forEach((_, index) => {
    sheet.getColumn(index + 2).width = 15; // Covariate columns
  });
  sheet.getColumn(legendCovHeaders.length + 2).width = 10; // Total count
  // Plate columns
  randomizedPlates.forEach((_, index) => {
    sheet.getColumn(legendCovHeaders.length + 3 + index).width = 10;
  });
}

/**
 * Create sample details sheet with full data table including plate and well assignments
 */
function createSampleDetailsSheet(
  workbook: ExcelJS.Workbook,
  searches: SearchData[],
  treatmentCovariates: string[],
  randomizedPlates: (SearchData | undefined)[][][],
  covariateColors: { [key: string]: CovariateColorInfo }
): void {
  const sheet = workbook.addWorksheet('Sample Details');

  // Create a map of sample name to plate/well location
  const sampleLocations = new Map<string, { plate: number; well: string }>();

  randomizedPlates.forEach((plate, plateIndex) => {
    plate.forEach((row, rowIndex) => {
      row.forEach((sample, colIndex) => {
        if (sample) {
          const rowLabel = String.fromCharCode(65 + rowIndex); // A, B, C...
          const colLabel = (colIndex + 1).toString().padStart(2, '0'); // 01, 02, 03...
          const well = `${rowLabel}${colLabel}`;
          sampleLocations.set(sample.name, { plate: plateIndex + 1, well });
        }
      });
    });
  });

  // Get all covariates (not just treatment ones)
  const allCovariates = Array.from(new Set(searches.flatMap(s => Object.keys(s.metadata))));

  // Separate treatment covariates and other covariates
  const otherCovariates = allCovariates.filter(cov => !treatmentCovariates.includes(cov));

  // Headers: Sample Name, Plate, Well, Color, [Treatment Covariates], [Other Covariates]
  const headerRow = sheet.addRow(['Sample Name', 'Plate', 'Well', 'Color', ...treatmentCovariates, ...otherCovariates]);
  headerRow.font = { bold: true };

  // Add each sample
  searches.forEach(search => {
    const location = sampleLocations.get(search.name);
    const colorInfo = covariateColors[getCovariateKey(search)];

    const rowData = [
      search.name,
      location?.plate || '',
      location?.well || '',
      '' // Color cell (will be formatted below)
    ];

    // Add treatment covariate values
    treatmentCovariates.forEach(cov => {
      rowData.push(search.metadata[cov] || '');
    });

    // Add other covariate values
    otherCovariates.forEach(cov => {
      rowData.push(search.metadata[cov] || '');
    });

    const row = sheet.addRow(rowData);

    // Format the color cell (column 4)
    if (colorInfo) {
      const colorCell = row.getCell(4);
      const argbColor = hexToArgb(colorInfo.color);

      if (colorInfo.useStripes) {
        colorCell.fill = createStripedFill(argbColor);
        colorCell.border = THIN_BLACK_BORDERS;
      } else if (colorInfo.useOutline) {
        colorCell.fill = WHITE_FILL;
        colorCell.border = createThickColoredBorder(argbColor);
      } else {
        colorCell.fill = createSolidFill(argbColor);
        colorCell.border = THIN_BLACK_BORDERS;
      }
    }
  });

  // Set column widths
  sheet.getColumn(1).width = 20; // Sample Name
  sheet.getColumn(2).width = 8;  // Plate
  sheet.getColumn(3).width = 8;  // Well
  sheet.getColumn(4).width = 10; // Color
  treatmentCovariates.forEach((_, index) => {
    sheet.getColumn(index + 5).width = 15; // Treatment covariates
  });
  otherCovariates.forEach((_, index) => {
    sheet.getColumn(treatmentCovariates.length + 5 + index).width = 15; // Other covariates
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
}

/**
 * Convert hex color to ARGB format for Excel
 */
function hexToArgb(hex: string): string {
  const cleanHex = hex.replace('#', '');
  return 'FF' + cleanHex.toUpperCase();
}
