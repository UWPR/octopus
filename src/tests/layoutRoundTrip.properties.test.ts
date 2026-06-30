/**
 * Property-based round-trip tests for the Save/Load layout file.
 *
 * These generate RANDOM but valid inputs - every setting field, every covariate
 * color and fill style, and an arbitrary placement of samples across plates - then
 * assert that serialize -> parse -> buildPlatesFromRows reproduces:
 *   1. every setting exactly (deep equality of LayoutSettings),
 *   2. every covariate color and style exactly (deep equality of the color map),
 *   3. the sample in every single well exactly (name + metadata, cell by cell),
 *   4. the per-plate assignment order.
 *
 * They complement the hand-picked example tests in `layoutIO.test.ts`, surfacing
 * combinations those fixed fixtures cannot reach. Run with `--forceExit` per the
 * testing guidelines so Jest does not hang on fast-check's async handles.
 */

import * as fc from 'fast-check';
import {
  serializeLayout,
  parseLayout,
  buildPlatesFromRows,
  LayoutSettings,
  CovariateColorMap,
} from '../utils/layoutIO';
import { getTextColorForBackground, buildPlacementCsv } from '../utils/utils';
import { SearchData, RandomizationAlgorithm, GroupingConstraint } from '../utils/types';

// Pool of metadata column names. Excludes the reserved 'plate'/'well' and the ID column.
const COLUMN_POOL = ['Treatment', 'Dose', 'Site', 'Batch', 'Timepoint'];
const ID_COLUMN = 'Sample ID';
const QC_VALUE_POOL = ['BatchQC', 'BatchRef', 'Pool', 'Blank'];
const COLOR_KEY_POOL = ['Drug|0', 'Placebo|0', 'Drug|10', 'A|B', 'solo', 'k5'];

type Fill = 'solid' | 'outline' | 'diagonal';

interface ScenarioBase {
  metadataColumns: string[];
  algorithm: RandomizationAlgorithm;
  keepEmptyInLastPlate: boolean;
  plateRows: number;
  plateColumns: number;
  maxPlates: number;
  subjectColumn: string;
  groupingConstraint: GroupingConstraint;
  qcValues: string[];
  colorKeys: string[];
}

interface ScenarioInput {
  base: ScenarioBase;
  covariates: string[];
  qcColumn: string;
  cellIndices: number[];
  colorSpecs: Array<{ rgb: number; fill: Fill }>;
}

function fillToFlags(fill: Fill): { useOutline: boolean; useStripes: boolean } {
  if (fill === 'outline') return { useOutline: true, useStripes: false };
  if (fill === 'diagonal') return { useOutline: false, useStripes: true };
  return { useOutline: false, useStripes: false };
}

function hexFromInt(rgb: number): string {
  return '#' + rgb.toString(16).padStart(6, '0').toUpperCase();
}

/**
 * One generated scenario: settings, colors, the searches list, and the plates grid,
 * plus a record of where each sample was placed for cell-by-cell assertions.
 */
const scenarioArb: fc.Arbitrary<ScenarioInput> = fc
  .record({
    metadataColumns: fc.uniqueArray(fc.constantFrom(...COLUMN_POOL), { minLength: 1, maxLength: 4 }),
    algorithm: fc.constantFrom<RandomizationAlgorithm>('balanced', 'greedy'),
    keepEmptyInLastPlate: fc.boolean(),
    plateRows: fc.integer({ min: 1, max: 8 }),
    plateColumns: fc.integer({ min: 1, max: 12 }),
    maxPlates: fc.integer({ min: 1, max: 3 }),
    subjectColumn: fc.constantFrom('', 'SubjectID'),
    groupingConstraint: fc.constantFrom<GroupingConstraint>('none', 'same-plate', 'same-row'),
    qcValues: fc.uniqueArray(fc.constantFrom(...QC_VALUE_POOL), { maxLength: 3 }),
    colorKeys: fc.uniqueArray(fc.constantFrom(...COLOR_KEY_POOL), { minLength: 1, maxLength: 6 }),
  })
  .chain((base) => {
    const capacity = base.maxPlates * base.plateRows * base.plateColumns;
    return fc.record({
      base: fc.constant(base),
      covariates: fc.subarray(base.metadataColumns, { minLength: 1 }),
      qcColumn: fc.constantFrom('', ...base.metadataColumns),
      // Distinct occupied cells (global plate-major index), at least one.
      cellIndices: fc.uniqueArray(fc.integer({ min: 0, max: capacity - 1 }), {
        minLength: 1,
        maxLength: Math.min(capacity, 30),
      }),
      // One color spec per color key.
      colorSpecs: fc.array(
        fc.record({ rgb: fc.integer({ min: 0, max: 0xffffff }), fill: fc.constantFrom<Fill>('solid', 'outline', 'diagonal') }),
        { minLength: base.colorKeys.length, maxLength: base.colorKeys.length }
      ),
    });
  });

interface BuiltScenario {
  settings: LayoutSettings;
  colors: CovariateColorMap;
  searches: SearchData[];
  plates: (SearchData | undefined)[][][];
  placements: Array<{ sample: SearchData; plate: number; row: number; col: number }>;
}

function buildScenario(input: ScenarioInput): BuiltScenario {
  const { base, covariates, qcColumn, cellIndices, colorSpecs } = input;
  const R = base.plateRows;
  const C = base.plateColumns;
  const perPlate = R * C;

  // Occupy cells in ascending global order so file order == reading order.
  const cells = [...cellIndices].sort((a, b) => a - b);
  const maxPlateUsed = Math.floor(cells[cells.length - 1] / perPlate);
  const numPlates = maxPlateUsed + 1;

  const plates: (SearchData | undefined)[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: R }, () => Array.from({ length: C }, () => undefined as SearchData | undefined))
  );

  const searches: SearchData[] = [];
  const placements: BuiltScenario['placements'] = [];
  cells.forEach((idx, i) => {
    const plate = Math.floor(idx / perPlate);
    const rem = idx % perPlate;
    const row = Math.floor(rem / C);
    const col = rem % C;
    // Metadata keyed in metadataColumns order so it matches the rebuilt order.
    const metadata: { [key: string]: string } = {};
    base.metadataColumns.forEach((m) => {
      metadata[m] = `${m}-${i}`;
    });
    const sample: SearchData = { name: `S${i}`, metadata };
    plates[plate][row][col] = sample;
    searches.push(sample);
    placements.push({ sample, plate, row, col });
  });

  const settings: LayoutSettings = {
    selectedIdColumn: ID_COLUMN,
    selectedCovariates: covariates,
    qcColumn,
    selectedQcValues: qcColumn === '' ? [] : base.qcValues,
    selectedAlgorithm: base.algorithm,
    keepEmptyInLastPlate: base.keepEmptyInLastPlate,
    plateRows: R,
    plateColumns: C,
    subjectColumn: base.subjectColumn,
    groupingConstraint: base.groupingConstraint,
    metadataColumns: base.metadataColumns,
  };

  const colors: CovariateColorMap = {};
  base.colorKeys.forEach((key, i) => {
    const color = hexFromInt(colorSpecs[i].rgb);
    colors[key] = {
      color,
      ...fillToFlags(colorSpecs[i].fill),
      textColor: getTextColorForBackground(color),
    };
  });

  return { settings, colors, searches, plates, placements };
}

describe('layout round-trip (property-based)', () => {
  it('reproduces every setting, color, style, and well across random scenarios', () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const { settings, colors, searches, plates, placements } = buildScenario(input);

        const text = serializeLayout({ searches, randomizedPlates: plates, settings, covariateColors: colors });
        const parsed = parseLayout(text);

        // 1. Settings: every field preserved.
        expect(parsed.headerMissing).toBe(false);
        expect(parsed.settings).toEqual(settings);

        // 2. Colors and styles: every entry preserved (text color recomputed identically).
        expect(parsed.covariateColors).toEqual(colors);

        const built = buildPlatesFromRows(parsed.rows, parsed.settings!);

        // 3. Whole grid identical (sample name + metadata in every cell, empties preserved).
        expect(built.plates).toEqual(plates);

        // 3b. Explicit cell-by-cell: each saved sample is back in its exact well.
        placements.forEach(({ sample, plate, row, col }) => {
          const cell = built.plates[plate][row][col];
          expect(cell?.name).toBe(sample.name);
          expect(cell?.metadata).toEqual(sample.metadata);
        });

        // 4. Per-plate assignment order matches reading order.
        for (let p = 0; p < plates.length; p++) {
          const expectedNames = placements.filter((x) => x.plate === p).map((x) => x.sample.name);
          const gotNames = (built.plateAssignments.get(p) ?? []).map((s) => s.name);
          expect(gotNames).toEqual(expectedNames);
        }

        // 5. Re-exporting the placement CSV after the round trip is byte-identical.
        const csvBefore = buildPlacementCsv(searches, plates, settings.selectedIdColumn);
        const csvAfter = buildPlacementCsv(built.samples, built.plates, settings.selectedIdColumn);
        expect(csvAfter).toBe(csvBefore);
      }),
      { numRuns: 200 }
    );
  });
});
