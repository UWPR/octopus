import * as fc from 'fast-check';
import { renderHook, act } from '@testing-library/react';
import { SearchData } from '../utils/types';
import {
  generateSequence,
  GenerateSequenceInput,
  formatWellPosition,
  generateFilename,
  generateSerialId,
  formatThermoCSV,
  generateMappingCSV,
  autoDetectCategories,
} from '../utils/sequenceExport';
import {
  SlotColor,
  SystemSuitabilityConfig,
  SlotAssignment,
  SampleCategoryConfig,
  PathsMethodsConfig,
  FileNamingConfig,
  FilenameField,
  GeneratedSequence,
} from '../utils/sequenceExportTypes';
import { useSequenceExportWizard, UseSequenceExportWizardProps } from '../hooks/useSequenceExportWizard';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeSample(name: string, metadata: Record<string, string> = {}, isQC = false): SearchData {
  return { name, metadata, isQC };
}

function makePlate(samples: (string | undefined)[][]): (SearchData | undefined)[][] {
  return samples.map(row =>
    row.map(name => (name ? makeSample(name) : undefined))
  );
}

function makeDefaultInput(overrides: Partial<GenerateSequenceInput> = {}): GenerateSequenceInput {
  const plates = overrides.plates || [
    makePlate([['S1', 'S2', 'S3'], ['S4', 'S5', 'S6']]),
  ];
  const sampleCategories: SampleCategoryConfig = overrides.sampleCategories || {
    assignments: { S1: 'Experimental', S2: 'Experimental', S3: 'Experimental', S4: 'Experimental', S5: 'Experimental', S6: 'Experimental' },
    categories: ['Experimental'],
  };
  const ssConfig: SystemSuitabilityConfig = overrides.ssConfig || {
    enabled: true,
    runsAtStart: 0,
    runsAtEnd: 0,
    runsDuring: 0,
    insertionInterval: 12,
    path: '',
    instrumentMethod: '',
    injectionVolume: 3,
    sampleIdentifier: 'SS',
  };
  const slotAssignment: SlotAssignment = overrides.slotAssignment || {
    ssSlot: null,
    ssWell: 'A1',
    plateSlots: { 0: 'B' as SlotColor },
  };
  const pathsConfig: PathsMethodsConfig = overrides.pathsConfig || {
    categorySettings: {
      Experimental: { path: 'D:\\Data', instrumentMethod: 'C:\\method.meth', injectionVolume: 3 },
      'System Suitability': { path: 'D:\\QC', instrumentMethod: 'C:\\ss.meth', injectionVolume: 4 },
    },
  };
  const fileNamingConfig: FileNamingConfig = overrides.fileNamingConfig || {
    selectedFields: [{ id: 'sampleId', label: 'Sample Identifier' }],
    separator: '_',
    sampleIdMode: 'original',
    serialIdConfig: { prefix: '', startNumber: 1 },
    generateMappingFile: false,
  };
  return { plates, sampleCategories, ssConfig, slotAssignment, pathsConfig, fileNamingConfig };
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('sequenceExport - unit tests', () => {
  describe('formatWellPosition', () => {
    it('formats (0, 0, B) as B:A1', () => {
      expect(formatWellPosition(0, 0, 'B')).toBe('B:A1');
    });

    it('formats (7, 11, G) as G:H12', () => {
      expect(formatWellPosition(7, 11, 'G')).toBe('G:H12');
    });

    it('formats (2, 5, Y) as Y:C6', () => {
      expect(formatWellPosition(2, 5, 'Y')).toBe('Y:C6');
    });
  });

  describe('generateSerialId', () => {
    it('generates LTC001, LTC002, LTC003 for prefix=LTC, start=1', () => {
      expect(generateSerialId('LTC', 1, 3, 1)).toBe('LTC001');
      expect(generateSerialId('LTC', 2, 3, 1)).toBe('LTC002');
      expect(generateSerialId('LTC', 3, 3, 1)).toBe('LTC003');
    });

    it('generates 001, 002, 003 for empty prefix', () => {
      expect(generateSerialId('', 1, 3, 1)).toBe('001');
      expect(generateSerialId('', 2, 3, 1)).toBe('002');
      expect(generateSerialId('', 3, 3, 1)).toBe('003');
    });

    it('pads to 4 digits when total exceeds 999', () => {
      expect(generateSerialId('X', 1, 1500, 1)).toBe('X0001');
      expect(generateSerialId('X', 1500, 1500, 1)).toBe('X1500');
    });
  });

  describe('generateFilename', () => {
    it('joins fields with separator and appends run counter', () => {
      const fields: FilenameField[] = [
        { id: 'instrumentName', label: 'Instrument Name', value: 'Astral' },
        { id: 'projectName', label: 'Project Name', value: 'Proj' },
      ];
      const result = generateFilename(fields, '_', 1, 100, {
        category: 'Experimental',
        sampleId: 'Sample1',
        plateWell: 'A01',
        plateNumber: 'Plate1',
      });
      expect(result).toBe('Astral_Proj_001');
    });

    it('skips empty field values without extra separators', () => {
      const fields: FilenameField[] = [
        { id: 'instrumentName', label: 'Instrument Name', value: 'Astral' },
        { id: 'sampleId', label: 'Sample Identifier' },
        { id: 'plateWell', label: 'Plate Well' },
      ];
      // SS row: sampleId and plateWell are empty
      const result = generateFilename(fields, '_', 5, 100, {
        category: 'System Suitability',
        sampleId: '',
        plateWell: '',
        plateNumber: '',
      });
      expect(result).toBe('Astral_005');
    });

    it('uses hyphen separator correctly', () => {
      const fields: FilenameField[] = [
        { id: 'year', label: 'Year' },
        { id: 'sampleId', label: 'Sample Identifier' },
      ];
      const result = generateFilename(fields, '-', 42, 100, {
        category: 'Experimental',
        sampleId: 'ABC',
        plateWell: 'B03',
        plateNumber: 'Plate2',
      });
      // Year is dynamic, so check structure
      const parts = result.split('-');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe(new Date().getFullYear().toString());
      expect(parts[1]).toBe('ABC');
      expect(parts[2]).toBe('042');
    });

    it('pads run counter to 3 digits for totals under 1000', () => {
      const fields: FilenameField[] = [{ id: 'sampleId', label: 'Sample Identifier' }];
      const result = generateFilename(fields, '_', 1, 999, {
        category: 'Experimental', sampleId: 'X', plateWell: '', plateNumber: '',
      });
      expect(result).toBe('X_001');
    });

    it('pads run counter to 4 digits for totals of 1000+', () => {
      const fields: FilenameField[] = [{ id: 'sampleId', label: 'Sample Identifier' }];
      const result = generateFilename(fields, '_', 1, 1000, {
        category: 'Experimental', sampleId: 'X', plateWell: '', plateNumber: '',
      });
      expect(result).toBe('X_0001');
    });
  });

  describe('formatThermoCSV', () => {
    it('produces correct header lines and field count', () => {
      const sequence: GeneratedSequence = {
        rows: [
          { fileName: 'file1', path: 'D:\\Data', instrumentMethod: 'C:\\m.meth', position: 'B:A1', injectionVolume: 3, category: 'Experimental', runNumber: 1, originalSampleId: 'S1', plateNumber: 1, wellPosition: 'A01' },
          { fileName: 'file2', path: 'D:\\Data', instrumentMethod: 'C:\\m.meth', position: 'B:A2', injectionVolume: 3, category: 'Experimental', runNumber: 2, originalSampleId: 'S2', plateNumber: 1, wellPosition: 'A02' },
        ],
        categoryCounts: { Experimental: 2 },
        totalRuns: 2,
        totalSampleCount: 2,
      };
      const csv = formatThermoCSV(sequence);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Bracket Type=4,,,,');
      expect(lines[1]).toBe('File Name,Path,Instrument Method,Position,Inj Vol');
      expect(lines[2]).toBe('file1,D:\\Data,C:\\m.meth,B:A1,3');
      expect(lines[3]).toBe('file2,D:\\Data,C:\\m.meth,B:A2,3');
      expect(lines.length).toBe(4);
      // Every data row has exactly 5 fields
      for (let i = 2; i < lines.length; i++) {
        expect(lines[i].split(',').length).toBe(5);
      }
    });

    it('quotes fields containing commas', () => {
      const sequence: GeneratedSequence = {
        rows: [
          { fileName: 'a,b', path: 'c,d', instrumentMethod: 'e', position: 'B:A1', injectionVolume: 3, category: 'Experimental', runNumber: 1, originalSampleId: 'S1', plateNumber: 1, wellPosition: 'A01' },
        ],
        categoryCounts: { Experimental: 1 },
        totalRuns: 1,
        totalSampleCount: 1,
      };
      const csv = formatThermoCSV(sequence);
      const lines = csv.split('\n');
      expect(lines[2]).toBe('"a,b","c,d",e,B:A1,3');
    });

    it('quotes fields containing bare double-quotes', () => {
      const sequence: GeneratedSequence = {
        rows: [
          { fileName: 'file"name', path: 'D:\\Data', instrumentMethod: 'C:\\m.meth', position: 'B:A1', injectionVolume: 3, category: 'Experimental', runNumber: 1, originalSampleId: 'S1', plateNumber: 1, wellPosition: 'A01' },
        ],
        categoryCounts: { Experimental: 1 },
        totalRuns: 1,
        totalSampleCount: 1,
      };
      const csv = formatThermoCSV(sequence);
      const lines = csv.split('\n');
      expect(lines[2]).toBe('"file""name",D:\\Data,C:\\m.meth,B:A1,3');
    });

    it('quotes fields containing newlines', () => {
      const sequence: GeneratedSequence = {
        rows: [
          { fileName: 'line1\nline2', path: 'D:\\Data', instrumentMethod: 'C:\\m.meth', position: 'B:A1', injectionVolume: 3, category: 'Experimental', runNumber: 1, originalSampleId: 'S1', plateNumber: 1, wellPosition: 'A01' },
        ],
        categoryCounts: { Experimental: 1 },
        totalRuns: 1,
        totalSampleCount: 1,
      };
      const csv = formatThermoCSV(sequence);
      const lines = csv.split('\n');
      // The quoted field spans the newline, so splitting on \n gives us the first part
      expect(csv).toContain('"line1\nline2"');
    });

    it('derives Bracket Type header from column count', () => {
      const sequence: GeneratedSequence = {
        rows: [],
        categoryCounts: {},
        totalRuns: 0,
        totalSampleCount: 0,
      };
      const csv = formatThermoCSV(sequence);
      const firstLine = csv.split('\n')[0];
      // 5 columns → "Bracket Type=4" + 4 commas
      expect(firstLine).toBe('Bracket Type=4,,,,');
    });
  });

  describe('generateMappingCSV', () => {
    it('produces correct headers and row content', () => {
      const csv = generateMappingCSV([
        { serialId: 'LTC001', originalSampleId: 'Sample_A', plateNumber: 1, wellPosition: 'A01' },
        { serialId: 'LTC002', originalSampleId: 'Sample_B', plateNumber: 1, wellPosition: 'A02' },
      ]);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Serial ID,Original Sample ID,Plate Number,Well Position');
      expect(lines[1]).toBe('LTC001,Sample_A,1,A01');
      expect(lines[2]).toBe('LTC002,Sample_B,1,A02');
      expect(lines.length).toBe(3);
    });
  });

  describe('autoDetectCategories', () => {
    it('assigns Experimental to all samples when no QC column configured', () => {
      const plates = [makePlate([['S1', 'S2'], ['S3', undefined]])];
      const result = autoDetectCategories(plates, undefined, undefined);
      expect(result.categories).toEqual(['Experimental']);
      expect(result.assignments).toEqual({ S1: 'Experimental', S2: 'Experimental', S3: 'Experimental' });
    });

    it('assigns QC column values as categories for QC samples', () => {
      const s1 = makeSample('S1', { Condition: 'BatchQC' }, true);
      const s2 = makeSample('S2', { Condition: 'BatchRef' }, true);
      const s3 = makeSample('S3', { Condition: 'Treatment' }, false);
      const plates: (SearchData | undefined)[][][] = [[[s1, s2], [s3, undefined]]];
      const result = autoDetectCategories(plates, 'Condition', ['BatchQC', 'BatchRef']);
      expect(result.categories.sort()).toEqual(['BatchQC', 'BatchRef', 'Experimental'].sort());
      expect(result.assignments['S1']).toBe('BatchQC');
      expect(result.assignments['S2']).toBe('BatchRef');
      expect(result.assignments['S3']).toBe('Experimental');
    });
  });

  describe('generateSequence', () => {
    it('skips undefined wells', () => {
      const plates = [makePlate([['S1', undefined, 'S2'], [undefined, 'S3', undefined]])];
      const input = makeDefaultInput({
        plates,
        sampleCategories: {
          assignments: { S1: 'Experimental', S2: 'Experimental', S3: 'Experimental' },
          categories: ['Experimental'],
        },
      });
      const result = generateSequence(input);
      expect(result.totalRuns).toBe(3);
      expect(result.rows.map(r => r.runNumber)).toEqual([1, 2, 3]);
    });

    it('generates SS rows at start and end', () => {
      const input = makeDefaultInput({
        ssConfig: {
          enabled: true, runsAtStart: 2, runsAtEnd: 3, runsDuring: 0,
          insertionInterval: 12, path: '', instrumentMethod: '', injectionVolume: 3, sampleIdentifier: 'SS',
        },
        slotAssignment: { ssSlot: 'Y', ssWell: 'A1', plateSlots: { 0: 'B' } },
      });
      const result = generateSequence(input);
      // 2 SS at start + 6 experimental + 3 SS at end = 11
      expect(result.totalRuns).toBe(11);
      expect(result.rows.slice(0, 2).every(r => r.category === 'System Suitability')).toBe(true);
      expect(result.rows.slice(8).every(r => r.category === 'System Suitability')).toBe(true);
      expect(result.rows.slice(2, 8).every(r => r.category === 'Experimental')).toBe(true);
    });

    it('inserts SS runs during experiment at correct intervals', () => {
      const input = makeDefaultInput({
        ssConfig: {
          enabled: true, runsAtStart: 0, runsAtEnd: 0, runsDuring: 1,
          insertionInterval: 3, path: '', instrumentMethod: '', injectionVolume: 3, sampleIdentifier: 'SS',
        },
        slotAssignment: { ssSlot: 'Y', ssWell: 'A1', plateSlots: { 0: 'B' } },
      });
      const result = generateSequence(input);
      // 6 samples, SS after every 3: after sample 3 (1 SS) = 7 total
      // Samples at positions: 1,2,3, SS, 4,5,6, SS would be wrong
      // Actually: sample0, sample1, sample2, then sampleCounter=3 triggers SS before sample3
      // So: S1, S2, S3, SS, S4, S5, S6, SS? No — SS triggers when sampleCounter>0 and sampleCounter%3==0
      // sampleCounter starts at 0, increments after push
      // sample0(S1), sample1(S2), sample2(S3), check: 3%3==0 → SS, sample3(S4), sample4(S5), sample5(S6)
      // Wait: check happens BEFORE push. So at sampleCounter=3, SS fires before S4.
      // At sampleCounter=6, SS would fire but there's no more sample. So no second SS.
      // Actually sampleCounter=6 never triggers because loop ends.
      // Total: 6 samples + 1 SS = 7
      expect(result.totalRuns).toBe(7);
      expect(result.rows[3].category).toBe('System Suitability');
    });

    it('assigns correct slot-based position prefixes for multi-plate sequences', () => {
      const plates = [
        makePlate([['P1S1', 'P1S2']]),
        makePlate([['P2S1', 'P2S2']]),
      ];
      const input = makeDefaultInput({
        plates,
        sampleCategories: {
          assignments: { P1S1: 'Experimental', P1S2: 'Experimental', P2S1: 'Experimental', P2S2: 'Experimental' },
          categories: ['Experimental'],
        },
        slotAssignment: { ssSlot: null, ssWell: 'A1', plateSlots: { 0: 'R', 1: 'B' } },
      });
      const result = generateSequence(input);
      expect(result.rows[0].position).toBe('R:A1');
      expect(result.rows[1].position).toBe('R:A2');
      expect(result.rows[2].position).toBe('B:A1');
      expect(result.rows[3].position).toBe('B:A2');
    });

    it('uses configured SS well position in SS rows', () => {
      const input = makeDefaultInput({
        ssConfig: {
          enabled: true, runsAtStart: 1, runsAtEnd: 0, runsDuring: 0,
          insertionInterval: 12, position: '', path: '', instrumentMethod: '', injectionVolume: 3, sampleIdentifier: 'SS',
        },
        slotAssignment: { ssSlot: 'G', ssWell: 'C5', plateSlots: { 0: 'B' } },
      });
      const result = generateSequence(input);
      // First row is SS — should use G:C5
      expect(result.rows[0].category).toBe('System Suitability');
      expect(result.rows[0].position).toBe('G:C5');
    });
  });

  describe('autoDetectCategories - edge cases', () => {
    it('assigns Experimental when QC cell metadata value is not in selectedQcValues', () => {
      const s1 = makeSample('S1', { Condition: 'UnknownQC' }, true);
      const s2 = makeSample('S2', { Condition: 'BatchQC' }, true);
      const plates: (SearchData | undefined)[][][] = [[[s1, s2]]];
      // Only "BatchQC" is in selectedQcValues, not "UnknownQC"
      const result = autoDetectCategories(plates, 'Condition', ['BatchQC']);
      expect(result.assignments['S1']).toBe('Experimental');
      expect(result.assignments['S2']).toBe('BatchQC');
      expect(result.categories.sort()).toEqual(['BatchQC', 'Experimental'].sort());
    });

    it('handles empty plates gracefully', () => {
      const plates: (SearchData | undefined)[][][] = [[[undefined, undefined], [undefined, undefined]]];
      const result = autoDetectCategories(plates, 'Condition', ['BatchQC']);
      expect(result.assignments).toEqual({});
      expect(result.categories).toEqual(['Experimental']);
    });
  });
});


// ─── Property-Based Tests ────────────────────────────────────────────────────

describe('sequenceExport - property-based tests', () => {
  // Helper: generate a random plate with known samples
  function arbPlate(rows: number, cols: number) {
    return fc.gen().map(gen => {
      const plate: (SearchData | undefined)[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: (SearchData | undefined)[] = [];
        for (let c = 0; c < cols; c++) {
          const filled = gen(fc.boolean);
          if (filled) {
            row.push(makeSample(`P_R${r}C${c}`, {}, false));
          } else {
            row.push(undefined);
          }
        }
        plate.push(row);
      }
      return plate;
    });
  }

  // Helper: build a valid GenerateSequenceInput from arbitrary params
  function buildInput(
    plates: (SearchData | undefined)[][][],
    ssConfig: Partial<SystemSuitabilityConfig> = {},
  ): GenerateSequenceInput {
    const allSamples: string[] = [];
    for (const plate of plates) {
      for (const row of plate) {
        for (const cell of row) {
          if (cell) allSamples.push(cell.name);
        }
      }
    }
    const assignments: Record<string, string> = {};
    for (const name of allSamples) {
      assignments[name] = 'Experimental';
    }
    const plateSlots: Record<number, SlotColor> = {};
    const slots: SlotColor[] = ['B', 'R', 'G', 'Y'];
    for (let i = 0; i < plates.length; i++) {
      plateSlots[i] = slots[i % slots.length];
    }
    return {
      plates,
      sampleCategories: { assignments, categories: ['Experimental'] },
      ssConfig: {
        enabled: true,
        runsAtStart: 0,
        runsAtEnd: 0,
        runsDuring: 0,
        insertionInterval: 12,
        position: '',
        path: '',
        instrumentMethod: '',
        injectionVolume: 3,
        sampleIdentifier: 'SS',
        ...ssConfig,
      },
      slotAssignment: { ssSlot: ssConfig.runsAtStart || ssConfig.runsAtEnd || ssConfig.runsDuring ? 'Y' : null, ssWell: 'A1', plateSlots },
      pathsConfig: {
        categorySettings: {
          Experimental: { path: 'D:\\Data', instrumentMethod: 'C:\\m.meth', injectionVolume: 3 },
          'System Suitability': { path: 'D:\\QC', instrumentMethod: 'C:\\ss.meth', injectionVolume: 4 },
        },
      },
      fileNamingConfig: {
        selectedFields: [{ id: 'sampleId', label: 'Sample Identifier' }],
        separator: '_',
        sampleIdMode: 'original',
        serialIdConfig: { prefix: '', startNumber: 1 },
        generateMappingFile: false,
      },
    };
  }

  describe('Property: SS run placement', () => {
    it('places exact SS counts at start, during, and end', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 6 }),
          (runsAtStart, runsAtEnd, runsDuring, insertionInterval, numRows, numCols) => {
            // Build a plate with all cells filled
            const plate: (SearchData | undefined)[][] = [];
            for (let r = 0; r < numRows; r++) {
              const row: (SearchData | undefined)[] = [];
              for (let c = 0; c < numCols; c++) {
                row.push(makeSample(`S_R${r}C${c}`));
              }
              plate.push(row);
            }
            const totalSamples = numRows * numCols;

            const input = buildInput([plate], { runsAtStart, runsAtEnd, runsDuring, insertionInterval });
            const result = generateSequence(input);

            const ssRows = result.rows.filter(r => r.category === 'System Suitability');
            const expRows = result.rows.filter(r => r.category === 'Experimental');

            // Verify experimental count
            expect(expRows.length).toBe(totalSamples);

            // Verify SS at start
            for (let i = 0; i < runsAtStart; i++) {
              expect(result.rows[i].category).toBe('System Suitability');
            }

            // Verify SS at end
            for (let i = 0; i < runsAtEnd; i++) {
              expect(result.rows[result.rows.length - 1 - i].category).toBe('System Suitability');
            }

            // Verify SS during count
            const ssActive = runsAtStart > 0 || runsAtEnd > 0 || runsDuring > 0;
            if (ssActive && runsDuring > 0 && insertionInterval > 0 && totalSamples > 1) {
              // SS triggers at sampleCounter values: interval, 2*interval, ...
              // sampleCounter is checked at values 0..totalSamples-1 (before each sample)
              // Triggers when sampleCounter > 0 && sampleCounter % interval == 0
              const insertionCount = Math.floor((totalSamples - 1) / insertionInterval);
              const expectedSSDuring = insertionCount * runsDuring;
              const totalExpectedSS = runsAtStart + runsAtEnd + expectedSSDuring;
              expect(ssRows.length).toBe(totalExpectedSS);
            } else {
              expect(ssRows.length).toBe(runsAtStart + runsAtEnd);
            }

            // All SS rows use the SS position (derived from ssSlot Y:A1)
            for (const row of ssRows) {
              expect(row.position).toBe('Y:A1');
            }

            // Independent check: totalRuns must equal actual row count
            // (catches prediction/reality divergence in zero-padding)
            expect(result.totalRuns).toBe(result.rows.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Filename field ordering and separator', () => {
    it('joins non-empty fields in order with separator, run counter last', () => {
      const fieldPool: FilenameField[] = [
        { id: 'instrumentName', label: 'Instrument', value: 'Astral' },
        { id: 'projectName', label: 'Project', value: 'MyProj' },
        { id: 'experimentName', label: 'Experiment', value: 'Exp1' },
        { id: 'sampleId', label: 'Sample ID' },
        { id: 'plateNumber', label: 'Plate Number' },
      ];

      fc.assert(
        fc.property(
          fc.shuffledSubarray(fieldPool, { minLength: 1, maxLength: 5 }),
          fc.constantFrom('_', '-', '.'),
          fc.integer({ min: 1, max: 500 }),
          fc.integer({ min: 1, max: 2000 }),
          (fields, separator, runNumber, totalRuns) => {
            const context = {
              category: 'Experimental',
              sampleId: 'TestSample',
              plateWell: 'A01',
              plateNumber: 'Plate1',
            };

            const result = generateFilename(fields, separator, runNumber, totalRuns, context);

            // Run counter is always the last segment
            const parts = result.split(separator);
            const lastPart = parts[parts.length - 1];
            const padWidth = Math.max(3, totalRuns.toString().length);
            const expectedPaddedRun = runNumber.toString().padStart(padWidth, '0');
            expect(lastPart).toBe(expectedPaddedRun);

            // No empty segments (no double separators)
            for (const part of parts) {
              expect(part.length > 0).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Serial ID generation pattern', () => {
    it('generates sequential IDs with correct padding', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 5, unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) }),
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 1, max: 500 }),
          (prefix, startNumber, totalSamples) => {
            const maxNumber = startNumber + totalSamples - 1;
            const padWidth = Math.max(3, maxNumber.toString().length);

            for (let i = 0; i < Math.min(totalSamples, 10); i++) {
              const current = startNumber + i;
              const id = generateSerialId(prefix, current, totalSamples, startNumber);
              const expectedNum = current.toString().padStart(padWidth, '0');
              expect(id).toBe(`${prefix}${expectedNum}`);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Global run counter is consecutive', () => {
    it('produces consecutive 1..N with no gaps', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 2 }),
          fc.integer({ min: 1, max: 8 }),
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 1, max: 4 }),
          (runsAtStart, runsAtEnd, runsDuring, insertionInterval, numRows, numCols) => {
            const plate: (SearchData | undefined)[][] = [];
            for (let r = 0; r < numRows; r++) {
              const row: (SearchData | undefined)[] = [];
              for (let c = 0; c < numCols; c++) {
                row.push(makeSample(`S_R${r}C${c}`));
              }
              plate.push(row);
            }

            const input = buildInput([plate], { runsAtStart, runsAtEnd, runsDuring, insertionInterval });
            const result = generateSequence(input);

            // Run numbers must be consecutive 1..N
            for (let i = 0; i < result.rows.length; i++) {
              expect(result.rows[i].runNumber).toBe(i + 1);
            }
            expect(result.totalRuns).toBe(result.rows.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Plate-first row-major ordering', () => {
    it('orders experimental samples plate-by-plate in row-major order', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 3 }),
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 1, max: 4 }),
          (numPlates, numRows, numCols) => {
            const plates: (SearchData | undefined)[][][] = [];
            for (let p = 0; p < numPlates; p++) {
              const plate: (SearchData | undefined)[][] = [];
              for (let r = 0; r < numRows; r++) {
                const row: (SearchData | undefined)[] = [];
                for (let c = 0; c < numCols; c++) {
                  row.push(makeSample(`P${p}_R${r}C${c}`));
                }
                plate.push(row);
              }
              plates.push(plate);
            }

            const input = buildInput(plates);
            const result = generateSequence(input);
            const expRows = result.rows.filter(r => r.category === 'Experimental');

            // Extract plate index from sample name
            let lastPlateIdx = 0;
            let lastRowIdx = 0;
            let lastColIdx = 0;
            let isFirst = true;

            for (const row of expRows) {
              // Parse P{plate}_R{row}C{col} from fileName which contains the sampleId
              const match = row.fileName.match(/P(\d+)_R(\d+)C(\d+)/);
              expect(match).not.toBeNull();
              const plateIdx = parseInt(match![1]);
              const rowIdx = parseInt(match![2]);
              const colIdx = parseInt(match![3]);

              if (isFirst) {
                isFirst = false;
              } else {
                // Plate index must be non-decreasing
                expect(plateIdx >= lastPlateIdx).toBe(true);
                // Within same plate, row-major order
                if (plateIdx === lastPlateIdx) {
                  const currentPos = rowIdx * numCols + colIdx;
                  const lastPos = lastRowIdx * numCols + lastColIdx;
                  expect(currentPos > lastPos).toBe(true);
                }
              }
              lastPlateIdx = plateIdx;
              lastRowIdx = rowIdx;
              lastColIdx = colIdx;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Category counts sum to total', () => {
    it('sum of categoryCounts equals totalRuns', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 2 }),
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 1, max: 4 }),
          (runsAtStart, runsAtEnd, runsDuring, insertionInterval, numRows, numCols) => {
            const plate: (SearchData | undefined)[][] = [];
            for (let r = 0; r < numRows; r++) {
              const row: (SearchData | undefined)[] = [];
              for (let c = 0; c < numCols; c++) {
                row.push(makeSample(`S_R${r}C${c}`));
              }
              plate.push(row);
            }

            const input = buildInput([plate], { runsAtStart, runsAtEnd, runsDuring, insertionInterval });
            const result = generateSequence(input);

            const sum = Object.values(result.categoryCounts).reduce((a, b) => a + b, 0);
            expect(sum).toBe(result.totalRuns);
            expect(sum).toBe(result.rows.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ─── Hook Tests ──────────────────────────────────────────────────────────────

describe('useSequenceExportWizard hook', () => {
  function makeHookProps(overrides: Partial<UseSequenceExportWizardProps> = {}): UseSequenceExportWizardProps {
    const plates = overrides.plates || [
      [[makeSample('S1'), makeSample('S2')], [makeSample('S3'), makeSample('S4')]],
    ];
    return {
      plates,
      searches: [makeSample('S1'), makeSample('S2'), makeSample('S3'), makeSample('S4')],
      idColumn: 'name',
      plateRows: 2,
      plateCols: 2,
      ...overrides,
    };
  }

  describe('goToStep validation', () => {
    it('does not allow jumping forward past current step', () => {
      const { result } = renderHook(() => useSequenceExportWizard(makeHookProps()));

      // Start at step 1
      expect(result.current.currentStep).toBe(1);

      // Try to jump to step 4 — should be blocked
      act(() => { result.current.goToStep(4); });
      expect(result.current.currentStep).toBe(1);

      // Try to jump to step 6 — should be blocked
      act(() => { result.current.goToStep(6); });
      expect(result.current.currentStep).toBe(1);
    });

    it('allows navigating back to a completed step', () => {
      const { result } = renderHook(() => useSequenceExportWizard(makeHookProps()));

      // Advance to step 2
      act(() => { result.current.nextStep(); });
      expect(result.current.currentStep).toBe(2);

      // Advance to step 3
      act(() => { result.current.nextStep(); });
      expect(result.current.currentStep).toBe(3);

      // Go back to step 1 — should work
      act(() => { result.current.goToStep(1); });
      expect(result.current.currentStep).toBe(1);
    });
  });

  describe('exportMappingCSV', () => {
    it('generates mapping with correct serial IDs and sample data', () => {
      const { result } = renderHook(() => useSequenceExportWizard(makeHookProps()));

      // Configure serial ID mode
      act(() => {
        result.current.updateFileNaming({
          selectedFields: [{ id: 'sampleId', label: 'Sample Identifier' }],
          sampleIdMode: 'serial',
          serialIdConfig: { prefix: 'TEST', startNumber: 1 },
          generateMappingFile: true,
        });
      });

      // The generatedSequence should have 4 experimental rows
      const expRows = result.current.generatedSequence.rows.filter(r => r.category !== 'System Suitability');
      expect(expRows.length).toBe(4);

      // Verify each row has correct originalSampleId and plateNumber
      expect(expRows[0].originalSampleId).toBe('S1');
      expect(expRows[0].plateNumber).toBe(1);
      expect(expRows[0].wellPosition).toBe('A01');
      expect(expRows[1].originalSampleId).toBe('S2');
      expect(expRows[1].wellPosition).toBe('A02');
      expect(expRows[2].originalSampleId).toBe('S3');
      expect(expRows[2].wellPosition).toBe('B01');
      expect(expRows[3].originalSampleId).toBe('S4');
      expect(expRows[3].wellPosition).toBe('B02');
    });
  });
});
