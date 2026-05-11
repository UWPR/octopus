/**
 * Pure utility functions for injection sequence export.
 * No side effects except downloadSequenceCSV (browser download trigger).
 */

import { SearchData } from './types';
import {
  SlotColor,
  SampleCategoryConfig,
  SystemSuitabilityConfig,
  SlotAssignment,
  PathsMethodsConfig,
  FileNamingConfig,
  FilenameField,
  SeparatorChar,
  SequenceRow,
  GeneratedSequence,
  IdMapping,
  DEFAULT_CATEGORY_SETTINGS,
  UNSAFE_FILENAME_CHARS,
} from './sequenceExportTypes';

// ─── Sequence Generation ─────────────────────────────────────────────────────

export interface GenerateSequenceInput {
  plates: (SearchData | undefined)[][][];
  sampleCategories: SampleCategoryConfig;
  ssConfig: SystemSuitabilityConfig;
  slotAssignment: SlotAssignment;
  pathsConfig: PathsMethodsConfig;
  fileNamingConfig: FileNamingConfig;
}

/**
 * True if any System Suitability runs are configured (start, end, or during).
 * Single source of truth — call this instead of repeating the run-count check inline.
 */
export function isSSActive(
  ssConfig: { runsAtStart: number; runsAtEnd: number; runsDuring: number }
): boolean {
  return ssConfig.runsAtStart > 0 || ssConfig.runsAtEnd > 0 || ssConfig.runsDuring > 0;
}

/**
 * Compute the total expected run count and filled well count for a given plate/SS configuration.
 * Used for zero-padding width in filenames and serial ID generation.
 * Shared between preview and export to prevent drift.
 */
export function computeTotalRuns(
  plates: (SearchData | undefined)[][][],
  ssConfig: { runsAtStart: number; runsAtEnd: number; runsDuring: number; insertionInterval: number }
): { totalRuns: number; totalFilledWells: number } {
  let totalFilledWells = 0;
  for (const plate of plates) {
    for (const row of plate) {
      for (const cell of row) {
        if (cell !== undefined) totalFilledWells++;
      }
    }
  }
  let totalRuns = totalFilledWells;
  if (isSSActive(ssConfig)) {
    totalRuns += ssConfig.runsAtStart + ssConfig.runsAtEnd;
    // SS insertions trigger when sampleCounter > 0 && sampleCounter % interval == 0.
    // The first sample (sampleCounter=0) never triggers, so max triggers = floor((count-1)/interval).
    // The > 1 guard ensures we don't compute floor(0/interval) = 0 needlessly for single-sample plates.
    if (ssConfig.runsDuring > 0 && ssConfig.insertionInterval > 0 && totalFilledWells > 1) {
      totalRuns += Math.floor((totalFilledWells - 1) / ssConfig.insertionInterval) * ssConfig.runsDuring;
    }
  }
  return { totalRuns, totalFilledWells };
}

/**
 * Generate the complete injection sequence from configuration and plate data.
 * Pure function — no side effects.
 */
export function generateSequence(input: GenerateSequenceInput): GeneratedSequence {
  const { plates, sampleCategories, ssConfig, slotAssignment, pathsConfig, fileNamingConfig } = input;

  const rows: SequenceRow[] = [];
  const categoryCounts: Record<string, number> = {};
  let runCounter = 1;

  const ssEnabled = isSSActive(ssConfig);

  // Use shared helper for total run count and filled well count
  const { totalRuns: totalExpectedRuns, totalFilledWells: totalFilledWellCount } = computeTotalRuns(plates, ssConfig);

  // Serial ID counter for filename generation
  let serialIdCounter = fileNamingConfig.serialIdConfig.startNumber;

  const incrementCategory = (category: string) => {
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  };

  const makeSSRow = (): SequenceRow => {
    const category = 'System Suitability';
    const ssSettings = pathsConfig.categorySettings[category] || {
      path: ssConfig.path,
      instrumentMethod: ssConfig.instrumentMethod,
      injectionVolume: ssConfig.injectionVolume,
    };
    // SS position is derived from the SS slot assignment and well (e.g., "Y:A1")
    const ssPosition = slotAssignment.ssSlot ? `${slotAssignment.ssSlot}:${slotAssignment.ssWell || 'A1'}` : '';
    const fileName = generateFilename(
      fileNamingConfig.selectedFields,
      fileNamingConfig.separator,
      runCounter,
      totalExpectedRuns,
      { category, sampleId: ssConfig.sampleIdentifier || 'SS', plateWell: '', plateNumber: '' }
    );
    const row: SequenceRow = {
      fileName,
      path: ssSettings.path,
      instrumentMethod: ssSettings.instrumentMethod,
      position: ssPosition,
      injectionVolume: ssSettings.injectionVolume,
      category,
      runNumber: runCounter,
      originalSampleId: '',
      plateNumber: null,
      wellPosition: '',
    };
    runCounter++;
    incrementCategory(category);
    return row;
  };

  // 1. SS runs at start
  if (ssEnabled) {
    for (let i = 0; i < ssConfig.runsAtStart; i++) {
      rows.push(makeSSRow());
    }
  }

  // 2. Experimental samples — plate-first, row-major order
  let sampleCounter = 0;
  for (let plateIdx = 0; plateIdx < plates.length; plateIdx++) {
    const plate = plates[plateIdx];
    const plateSlot = slotAssignment.plateSlots[plateIdx];

    for (let rowIdx = 0; rowIdx < plate.length; rowIdx++) {
      const row = plate[rowIdx];
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const sample = row[colIdx];
        if (sample === undefined) continue;

        // Check if SS insertion needed before this sample
        if (ssEnabled && ssConfig.runsDuring > 0 && ssConfig.insertionInterval > 0) {
          if (sampleCounter > 0 && sampleCounter % ssConfig.insertionInterval === 0) {
            for (let i = 0; i < ssConfig.runsDuring; i++) {
              rows.push(makeSSRow());
            }
          }
        }

        const category = sampleCategories.assignments[sample.name] || 'Experimental';
        const position = formatWellPosition(rowIdx, colIdx, plateSlot);
        const plateWellFormatted = `${String.fromCharCode(65 + rowIdx)}${(colIdx + 1).toString().padStart(2, '0')}`;

        // Determine sample ID for filename
        let sampleId: string;
        if (fileNamingConfig.sampleIdMode === 'serial') {
          sampleId = generateSerialId(fileNamingConfig.serialIdConfig.prefix, serialIdCounter, totalFilledWellCount, fileNamingConfig.serialIdConfig.startNumber);
          serialIdCounter++;
        } else {
          sampleId = sample.name;
        }

        const fileName = generateFilename(
          fileNamingConfig.selectedFields,
          fileNamingConfig.separator,
          runCounter,
          totalExpectedRuns,
          {
            category,
            sampleId,
            plateWell: plateWellFormatted,
            plateNumber: `Plate${plateIdx + 1}`,
          }
        );

        const categorySettings = pathsConfig.categorySettings[category] || DEFAULT_CATEGORY_SETTINGS;

        const seqRow: SequenceRow = {
          fileName,
          path: categorySettings.path,
          instrumentMethod: categorySettings.instrumentMethod,
          position,
          injectionVolume: categorySettings.injectionVolume,
          category,
          runNumber: runCounter,
          originalSampleId: sample.name,
          plateNumber: plateIdx + 1,
          wellPosition: plateWellFormatted,
        };

        rows.push(seqRow);
        runCounter++;
        incrementCategory(category);
        sampleCounter++;
      }
    }
  }

  // 3. SS runs at end
  if (ssEnabled) {
    for (let i = 0; i < ssConfig.runsAtEnd; i++) {
      rows.push(makeSSRow());
    }
  }

  return {
    rows,
    categoryCounts,
    totalRuns: rows.length,
    totalSampleCount: totalFilledWellCount,
  };
}


// ─── Well Position Formatting ────────────────────────────────────────────────

/**
 * Convert (rowIdx, colIdx, slotColor) → "{SlotColor}:{RowLetter}{ColNumber}"
 * e.g., (0, 0, 'B') → "B:A1", (7, 11, 'G') → "G:H12"
 */
export function formatWellPosition(rowIdx: number, colIdx: number, slotColor: SlotColor): string {
  const rowLetter = String.fromCharCode(65 + rowIdx);
  const colNumber = colIdx + 1;
  return `${slotColor}:${rowLetter}${colNumber}`;
}

// ─── Filename Generation ─────────────────────────────────────────────────────

interface FilenameContext {
  category: string;
  sampleId: string;
  plateWell: string;
  plateNumber: string;
}

/**
 * Build a filename from ordered selected fields joined by separator.
 * Always appends run counter as the final segment.
 * Zero-pads run counter to 3 digits (or more if totalRuns > 999).
 */
export function generateFilename(
  selectedFields: FilenameField[],
  separator: SeparatorChar,
  runNumber: number,
  totalRuns: number,
  context: FilenameContext
): string {
  const padWidth = Math.max(3, totalRuns.toString().length);
  const paddedRun = runNumber.toString().padStart(padWidth, '0');

  const fieldValues = selectedFields
    .filter(field => field.id !== 'runNumber') // run number is always appended last
    .map(field => sanitizeFilenameSegment(resolveFieldValue(field, context)))
    .filter(value => value !== ''); // skip empty values to avoid extra separators

  // Always append run counter as final segment.
  // Separator is validated upstream (canProceed step 3 rejects unsafe chars),
  // so it is safe to use as-is here.
  const parts = [...fieldValues, paddedRun];
  return parts.join(separator);
}

// Global-flag version of UNSAFE_FILENAME_CHARS for use with replace().
const UNSAFE_FILENAME_CHARS_GLOBAL = new RegExp(UNSAFE_FILENAME_CHARS.source, 'g');

/**
 * Make a filename segment safe for Windows: replace unsafe characters with
 * underscore, then strip trailing dots and spaces (Windows rejects those).
 */
function sanitizeFilenameSegment(value: string): string {
  return value.replace(UNSAFE_FILENAME_CHARS_GLOBAL, '_').replace(/[. ]+$/, '');
}

/**
 * Resolve the value of a filename field given the current context.
 */
function resolveFieldValue(field: FilenameField, context: FilenameContext): string {
  switch (field.id) {
    case 'year':
      return new Date().getFullYear().toString();
    case 'month':
      return (new Date().getMonth() + 1).toString().padStart(2, '0');
    case 'projectName':
    case 'experimentName':
    case 'instrumentName':
      return field.value || '';
    case 'sampleId':
      return context.sampleId;
    case 'plateWell':
      return context.plateWell;
    case 'plateNumber':
      return context.plateNumber;
    case 'sampleCategory':
      // Use short form for System Suitability in filenames
      return context.category === 'System Suitability' ? 'SS' : context.category;
    default:
      return field.value || '';
  }
}

// ─── Serial ID Generation ────────────────────────────────────────────────────

/**
 * Generate a serial ID with prefix + zero-padded sequential number.
 * e.g., prefix="LTC", currentNumber=1, totalSamples=100 → "LTC001"
 */
export function generateSerialId(
  prefix: string,
  currentNumber: number,
  totalSamples: number,
  startNumber: number
): string {
  const maxNumber = startNumber + totalSamples - 1;
  const padWidth = Math.max(3, maxNumber.toString().length);
  return `${prefix}${currentNumber.toString().padStart(padWidth, '0')}`;
}

// ─── CSV Formatting ──────────────────────────────────────────────────────────

/**
 * Format a generated sequence as a Thermo Fisher CSV string.
 * Produces: "Bracket Type=4,,,," header, column headers, and data rows.
 */
export function formatThermoCSV(sequence: GeneratedSequence): string {
  const lines: string[] = [];

  // Thermo Fisher sequence file header — fixed format (5 columns: File Name, Path, Instrument Method, Position, Inj Vol)
  lines.push('Bracket Type=4,,,,');

  // Column headers
  lines.push('File Name,Path,Instrument Method,Position,Inj Vol');

  // Data rows
  for (const row of sequence.rows) {
    const fields = [
      quoteIfNeeded(row.fileName),
      quoteIfNeeded(row.path),
      quoteIfNeeded(row.instrumentMethod),
      quoteIfNeeded(row.position),
      row.injectionVolume.toString(),
    ];
    lines.push(fields.join(','));
  }

  return lines.join('\n');
}

/**
 * Quote a CSV field if it contains a comma, double-quote, or newline.
 */
function quoteIfNeeded(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Trigger a browser file download with the given content.
 */
export function downloadSequenceCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate a mapping CSV that maps serial IDs to original sample IDs.
 * Headers: Serial ID,Original Sample ID,Plate Number,Well Position
 */
export function generateMappingCSV(mappings: IdMapping[]): string {
  const lines: string[] = [];
  lines.push('Serial ID,Original Sample ID,Plate Number,Well Position');

  for (const mapping of mappings) {
    const fields = [
      quoteIfNeeded(mapping.serialId),
      quoteIfNeeded(mapping.originalSampleId),
      mapping.plateNumber.toString(),
      quoteIfNeeded(mapping.wellPosition),
    ];
    lines.push(fields.join(','));
  }

  return lines.join('\n');
}

// ─── Sample Category Auto-Detection ─────────────────────────────────────────

/**
 * Auto-detect sample categories from plate data and QC configuration.
 * - If QC column is configured and a sample is QC, assigns the specific QC column value as category
 * - Otherwise assigns "Experimental"
 * Returns a SampleCategoryConfig with assignments and unique categories.
 */
export function autoDetectCategories(
  plates: (SearchData | undefined)[][][],
  qcColumn: string | undefined,
  selectedQcValues: string[] | undefined
): SampleCategoryConfig {
  const assignments: Record<string, string> = {};
  const categorySet = new Set<string>();
  categorySet.add('Experimental');

  for (const plate of plates) {
    for (const row of plate) {
      for (const cell of row) {
        if (cell === undefined) continue;

        if (qcColumn && selectedQcValues && selectedQcValues.length > 0 && cell.isQC) {
          // Use the specific QC column value as the category
          const qcValue = cell.metadata[qcColumn];
          if (qcValue && selectedQcValues.includes(qcValue)) {
            assignments[cell.name] = qcValue;
            categorySet.add(qcValue);
          } else {
            assignments[cell.name] = 'Experimental';
          }
        } else {
          assignments[cell.name] = 'Experimental';
        }
      }
    }
  }

  return {
    assignments,
    categories: Array.from(categorySet),
  };
}
