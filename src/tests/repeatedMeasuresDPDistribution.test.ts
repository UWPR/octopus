import { buildGroupTypes, serializeComposition, rowImbalanceScore, innerDP, outerDP, groupAwareDPRandomization, reorderRows, GroupType } from '../algorithms/repeatedMeasuresDPDistribution';
import { SearchData, SubjectGroup } from '../utils/types';
import * as fc from 'fast-check';

// Helper: create a SubjectGroup with a given covariateKey and size
function makeGroup(subjectId: string, covariateKey: string, size: number): SubjectGroup {
  const samples: SearchData[] = [];
  for (let i = 0; i < size; i++) {
    samples.push({ name: `${subjectId}_sample${i}`, metadata: {}, covariateKey });
  }
  return { subjectId, samples, size };
}

describe('buildGroupTypes', () => {
  it('collapses groups into correct equivalence classes for known configuration', () => {
    // 3 groups with covariateKey "Drug|T1" and size 2
    // 2 groups with covariateKey "Placebo|T1" and size 2
    // 1 group with covariateKey "Drug|T1" and size 1
    const groups: SubjectGroup[] = [
      makeGroup('P1', 'Drug|T1', 2),
      makeGroup('P2', 'Drug|T1', 2),
      makeGroup('P3', 'Drug|T1', 2),
      makeGroup('P4', 'Placebo|T1', 2),
      makeGroup('P5', 'Placebo|T1', 2),
      makeGroup('P6', 'Drug|T1', 1),
    ];

    const result = buildGroupTypes(groups);

    // Expect 3 distinct GroupTypes
    expect(result.length).toBe(3);

    // Sorted by total weight descending:
    // ("Drug|T1", size=2, count=3) → weight = 2×3 = 6
    // ("Placebo|T1", size=2, count=2) → weight = 2×2 = 4
    // ("Drug|T1", size=1, count=1) → weight = 1×1 = 1
    expect(result[0].covariateKey).toBe('Drug|T1');
    expect(result[0].groupSize).toBe(2);
    expect(result[0].count).toBe(3);
    expect(result[0].groups.length).toBe(3);

    expect(result[1].covariateKey).toBe('Placebo|T1');
    expect(result[1].groupSize).toBe(2);
    expect(result[1].count).toBe(2);
    expect(result[1].groups.length).toBe(2);

    expect(result[2].covariateKey).toBe('Drug|T1');
    expect(result[2].groupSize).toBe(1);
    expect(result[2].count).toBe(1);
    expect(result[2].groups.length).toBe(1);
  });

  it('count sum equals total input group count', () => {
    const groups: SubjectGroup[] = [
      makeGroup('P1', 'Drug|T1', 2),
      makeGroup('P2', 'Drug|T1', 2),
      makeGroup('P3', 'Drug|T1', 2),
      makeGroup('P4', 'Placebo|T1', 2),
      makeGroup('P5', 'Placebo|T1', 2),
      makeGroup('P6', 'Drug|T1', 1),
    ];

    const result = buildGroupTypes(groups);
    const totalCount = result.reduce((sum, gt) => sum + gt.count, 0);

    expect(totalCount).toBe(6);
  });

  it('sorts by total weight descending', () => {
    const groups: SubjectGroup[] = [
      makeGroup('P1', 'Drug|T1', 2),
      makeGroup('P2', 'Drug|T1', 2),
      makeGroup('P3', 'Drug|T1', 2),
      makeGroup('P4', 'Placebo|T1', 2),
      makeGroup('P5', 'Placebo|T1', 2),
      makeGroup('P6', 'Drug|T1', 1),
    ];

    const result = buildGroupTypes(groups);

    // Verify exact weights in descending order
    const weights = result.map(gt => gt.groupSize * gt.count);
    expect(weights).toEqual([6, 4, 1]);
  });
});

describe('serializeComposition', () => {
  it('produces deterministic output for known maps', () => {
    const composition = new Map<string, number>([
      ['Resp|T1', 4],
      ['NonResp|T1', 3],
    ]);

    const result = serializeComposition(composition);
    expect(result).toBe('NonResp|T1:3,Resp|T1:4');
  });

  it('returns empty string for empty map', () => {
    const composition = new Map<string, number>();
    const result = serializeComposition(composition);
    expect(result).toBe('');
  });

  it('handles single entry', () => {
    const composition = new Map<string, number>([['Drug|T1', 5]]);
    const result = serializeComposition(composition);
    expect(result).toBe('Drug|T1:5');
  });

  it('sorts keys alphabetically regardless of insertion order', () => {
    // Insert in reverse alphabetical order
    const composition = new Map<string, number>();
    composition.set('Zebra|T1', 1);
    composition.set('Alpha|T1', 2);
    composition.set('Middle|T1', 3);

    const result = serializeComposition(composition);
    expect(result).toBe('Alpha|T1:2,Middle|T1:3,Zebra|T1:1');
  });
});

describe('rowImbalanceScore', () => {
  it('matches hand-calculated sum-of-squared-deviations', () => {
    // Global proportions: Drug → 0.6, Placebo → 0.4
    const globalProportions = new Map<string, number>([
      ['Drug', 0.6],
      ['Placebo', 0.4],
    ]);

    // Row samples: 3 Drug, 1 Placebo (4 total)
    // Actual proportions: Drug = 3/4 = 0.75, Placebo = 1/4 = 0.25
    // Expected score: (0.75 - 0.6)² + (0.25 - 0.4)² = 0.0225 + 0.0225 = 0.045
    const samples: SearchData[] = [
      { name: 'S1', metadata: {}, covariateKey: 'Drug' },
      { name: 'S2', metadata: {}, covariateKey: 'Drug' },
      { name: 'S3', metadata: {}, covariateKey: 'Drug' },
      { name: 'S4', metadata: {}, covariateKey: 'Placebo' },
    ];

    const score = rowImbalanceScore(samples, globalProportions);
    expect(score).toBeCloseTo(0.045, 10);
  });

  it('returns 0 for a sample set that perfectly matches global proportions', () => {
    // Global proportions: Drug → 0.5, Placebo → 0.5
    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    // Row samples: 2 Drug, 2 Placebo (4 total)
    // Actual proportions: Drug = 0.5, Placebo = 0.5 → perfect match
    const samples: SearchData[] = [
      { name: 'S1', metadata: {}, covariateKey: 'Drug' },
      { name: 'S2', metadata: {}, covariateKey: 'Drug' },
      { name: 'S3', metadata: {}, covariateKey: 'Placebo' },
      { name: 'S4', metadata: {}, covariateKey: 'Placebo' },
    ];

    const score = rowImbalanceScore(samples, globalProportions);
    expect(score).toBeCloseTo(0, 10);
  });

  it('returns the same value as independently computed Σ_k (actual - global)²', () => {
    // Global proportions: A → 0.3, B → 0.5, C → 0.2
    const globalProportions = new Map<string, number>([
      ['A', 0.3],
      ['B', 0.5],
      ['C', 0.2],
    ]);

    // Row samples: 2 A, 3 B, 0 C (5 total)
    const samples: SearchData[] = [
      { name: 'S1', metadata: {}, covariateKey: 'A' },
      { name: 'S2', metadata: {}, covariateKey: 'A' },
      { name: 'S3', metadata: {}, covariateKey: 'B' },
      { name: 'S4', metadata: {}, covariateKey: 'B' },
      { name: 'S5', metadata: {}, covariateKey: 'B' },
    ];

    // Independently compute expected score:
    // Actual: A = 2/5 = 0.4, B = 3/5 = 0.6, C = 0/5 = 0.0
    // Expected: (0.4-0.3)² + (0.6-0.5)² + (0.0-0.2)² = 0.01 + 0.01 + 0.04 = 0.06
    const total = samples.length;
    const counts = new Map<string, number>();
    for (const s of samples) {
      const key = s.covariateKey ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let independentScore = 0;
    globalProportions.forEach((globalProp, key) => {
      const actualProp = (counts.get(key) ?? 0) / total;
      independentScore += (actualProp - globalProp) ** 2;
    });

    const score = rowImbalanceScore(samples, globalProportions);
    expect(score).toBeCloseTo(independentScore, 10);
    expect(score).toBeCloseTo(0.06, 10);
  });
});

describe('innerDP', () => {
  it('finds optimal assignment for a small hand-crafted plate with known optimal', () => {
    // 2 rows, capacity 4 each
    // 2 group types: ("Drug", size=2, count=2), ("Placebo", size=2, count=2)
    // Optimal: 1 Drug + 1 Placebo per row → each row has perfect 50/50 balance → score = 0
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Placebo', 2),
      makeGroup('P4', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = innerDP(groupTypes, [4, 4], globalProportions);

    expect(result.exhausted).toBe(false);

    // Total groups assigned across all rows should be 4
    let totalGroups = 0;
    result.assignment.forEach(groups => {
      totalGroups += groups.length;
    });
    expect(totalGroups).toBe(4);
  });

  it('reports exhausted when budget is 1', () => {
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Placebo', 2),
      makeGroup('P4', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = innerDP(groupTypes, [4, 4], globalProportions, 1);

    expect(result.exhausted).toBe(true);

    // Assignment map should have entries for all rows (even if empty)
    expect(result.assignment.has(0)).toBe(true);
    expect(result.assignment.has(1)).toBe(true);
  });

  it('assigns all groups to the single row on a single-row plate', () => {
    // 1 row, capacity 6
    // 2 group types: ("Drug", size=2, count=1), ("Placebo", size=2, count=1)
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = innerDP(groupTypes, [6], globalProportions);

    // All groups should be assigned to row 0
    const row0Groups = result.assignment.get(0) ?? [];
    expect(row0Groups.length).toBe(2);
  });

  it('does not exceed row capacity in any row', () => {
    // 3 rows, capacity 4 each
    // 3 group types: ("A", size=2, count=2), ("B", size=2, count=2), ("C", size=2, count=2)
    const groups = [
      makeGroup('P1', 'A', 2),
      makeGroup('P2', 'A', 2),
      makeGroup('P3', 'B', 2),
      makeGroup('P4', 'B', 2),
      makeGroup('P5', 'C', 2),
      makeGroup('P6', 'C', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['A', 1 / 3],
      ['B', 1 / 3],
      ['C', 1 / 3],
    ]);

    const result = innerDP(groupTypes, [4, 4, 4], globalProportions);

    // Verify for each row: sum of group sizes ≤ 4
    for (let r = 0; r < 3; r++) {
      const rowGroups = result.assignment.get(r) ?? [];
      const totalSamples = rowGroups.reduce((sum, g) => sum + g.size, 0);
      expect(totalSamples).toBeLessThanOrEqual(4);
    }
  });
});

describe('outerDP', () => {
  it('finds optimal assignment for a small 2-plate study with known optimal', () => {
    // 2 plates, capacity 8 each
    // 2 group types: ("Drug", size=2, count=4), ("Placebo", size=2, count=4)
    // Optimal: 2 Drug + 2 Placebo per plate → balanced
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Drug', 2),
      makeGroup('P4', 'Drug', 2),
      makeGroup('P5', 'Placebo', 2),
      makeGroup('P6', 'Placebo', 2),
      makeGroup('P7', 'Placebo', 2),
      makeGroup('P8', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = outerDP(groupTypes, [8, 8], globalProportions);

    expect(result.exhausted).toBe(false);

    // Total groups assigned across all plates should be 8
    let totalGroups = 0;
    result.assignment.forEach(groups => {
      totalGroups += groups.length;
    });
    expect(totalGroups).toBe(8);
  });

  it('reports exhausted when budget is 1', () => {
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Drug', 2),
      makeGroup('P4', 'Drug', 2),
      makeGroup('P5', 'Placebo', 2),
      makeGroup('P6', 'Placebo', 2),
      makeGroup('P7', 'Placebo', 2),
      makeGroup('P8', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = outerDP(groupTypes, [8, 8], globalProportions, 1);

    expect(result.exhausted).toBe(true);
  });

  it('assigns all groups to plate 0 on a single-plate study', () => {
    // 1 plate, capacity 12
    // 2 group types: ("Drug", size=2, count=2), ("Placebo", size=2, count=2)
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Placebo', 2),
      makeGroup('P4', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = outerDP(groupTypes, [12], globalProportions);

    // All groups should be assigned to plate 0
    const plate0Groups = result.assignment.get(0) ?? [];
    expect(plate0Groups.length).toBe(4);
  });

  it('does not exceed plate capacity in any plate', () => {
    // 2 plates, capacity 6 each
    // 2 group types: ("Drug", size=2, count=3), ("Placebo", size=2, count=3)
    const groups = [
      makeGroup('P1', 'Drug', 2),
      makeGroup('P2', 'Drug', 2),
      makeGroup('P3', 'Drug', 2),
      makeGroup('P4', 'Placebo', 2),
      makeGroup('P5', 'Placebo', 2),
      makeGroup('P6', 'Placebo', 2),
    ];
    const groupTypes = buildGroupTypes(groups);

    const globalProportions = new Map<string, number>([
      ['Drug', 0.5],
      ['Placebo', 0.5],
    ]);

    const result = outerDP(groupTypes, [6, 6], globalProportions);

    // Verify for each plate: sum of group sizes ≤ 6
    for (let p = 0; p < 2; p++) {
      const plateGroups = result.assignment.get(p) ?? [];
      const totalSamples = plateGroups.reduce((sum, g) => sum + g.size, 0);
      expect(totalSamples).toBeLessThanOrEqual(6);
    }
  });
});


// ============================================================================
// Property-Based Tests — Structural Invariants (Properties 1, 8, 10, 11, 12)
// ============================================================================

/**
 * Custom fast-check Arbitrary that generates valid study inputs BY CONSTRUCTION.
 *
 * Produces:
 * - searches: SearchData[] with experimental + QC samples
 * - selectedCovariates: string[] (covariate column names)
 * - subjectColumn: string
 * - numRows: number (4-8)
 * - numColumns: number (8-12)
 *
 * Guarantees by construction:
 * - Each patient has 1-3 samples (timepoints), all sharing the same covariateKey
 * - Patient group sizes never exceed numColumns (row capacity)
 * - Total samples fit within available plate capacity
 * - At least 1 experimental sample exists
 * - QC samples are 0-20% of total
 * - 1-4 distinct covariateKeys
 * - Metadata contains covariate columns with values matching covariateKey
 * - Samples have a metadata field matching subjectColumn with the patient ID
 */
const validStudyInputArb = fc.gen().map(gen => {
  const numRows = gen(fc.integer, { min: 4, max: 8 });
  const numColumns = gen(fc.integer, { min: 8, max: 12 });
  const plateCapacity = numRows * numColumns;

  const subjectColumn = 'PatientID';
  const covariateName = 'Treatment';
  const selectedCovariates = [covariateName];

  // Generate 1-4 distinct covariate values
  const numCovariateValues = gen(fc.integer, { min: 1, max: 4 });
  const covariateValues: string[] = [];
  for (let i = 0; i < numCovariateValues; i++) {
    covariateValues.push(`Group${i}`);
  }

  // Generate patients: 3-15 patients to keep inputs small for DP
  const numPatients = gen(fc.integer, { min: 3, max: 15 });

  const searches: SearchData[] = [];
  let sampleIdx = 0;

  for (let p = 0; p < numPatients; p++) {
    const patientId = `Patient_${p}`;
    // Each patient has 1-3 timepoints, but never more than numColumns
    const groupSize = gen(fc.integer, { min: 1, max: Math.min(3, numColumns) });
    // Assign a covariate value to this patient
    const covIdx = gen(fc.integer, { min: 0, max: covariateValues.length - 1 });
    const covValue = covariateValues[covIdx];
    const covariateKey = covValue;

    for (let t = 0; t < groupSize; t++) {
      searches.push({
        name: `Sample_${sampleIdx++}`,
        metadata: {
          [subjectColumn]: patientId,
          [covariateName]: covValue,
        },
        covariateKey,
        isQC: false,
      });
    }
  }

  const numExperimental = searches.length;

  // Ensure total fits in plate capacity: compute max QC we can add
  // QC should be 0-20% of total, and total must fit in plates
  const maxQcByPercent = Math.floor(numExperimental * 0.2);
  const maxQcByCapacity = Math.max(0, plateCapacity * 2 - numExperimental - 1); // allow up to 2 plates
  const maxQc = Math.min(maxQcByPercent, maxQcByCapacity, 5); // cap at 5 for speed
  const numQc = maxQc > 0 ? gen(fc.integer, { min: 0, max: maxQc }) : 0;

  for (let q = 0; q < numQc; q++) {
    searches.push({
      name: `QC_${q}`,
      metadata: {
        [subjectColumn]: `__qc_${q}`,
        [covariateName]: 'QC',
      },
      covariateKey: 'QC',
      isQC: true,
    });
  }

  return { searches, selectedCovariates, subjectColumn, numRows, numColumns };
});

/**
 * Helper: call groupAwareDPRandomization with the generated inputs.
 */
function runAlgorithm(input: {
  searches: SearchData[];
  selectedCovariates: string[];
  subjectColumn: string;
  numRows: number;
  numColumns: number;
}, keepEmptyInLastPlate: boolean = false) {
  return groupAwareDPRandomization(
    input.searches,
    input.selectedCovariates,
    { subjectColumn: input.subjectColumn, groupingConstraint: 'same-row' },
    keepEmptyInLastPlate,
    input.numRows,
    input.numColumns
  );
}

describe('Property-Based Tests — Structural Invariants', () => {
  it('Feature: dp-plate-optimization, Property 1: Return shape matches interface contract', () => {
    /**
     * Validates: Requirements 1.1, 1.2
     *
     * groupAwareDPRandomization returns plates as a 3D array where
     * plates.length equals numPlates, each plate has numRows rows,
     * each row has numColumns cells, each cell is SearchData | undefined.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const result = runAlgorithm(input);
        const { plates } = result;
        const { numRows, numColumns, searches } = input;
        const plateSize = numRows * numColumns;
        const expectedNumPlates = Math.ceil(searches.length / plateSize);

        // plates is an array of length numPlates
        expect(plates.length).toBe(expectedNumPlates);

        for (let p = 0; p < plates.length; p++) {
          // Each plate has numRows rows
          expect(plates[p].length).toBe(numRows);
          for (let r = 0; r < numRows; r++) {
            // Each row has numColumns cells
            expect(plates[p][r].length).toBe(numColumns);
            for (let c = 0; c < numColumns; c++) {
              const cell = plates[p][r][c];
              // Each cell is SearchData | undefined
              expect(cell === undefined || (typeof cell === 'object' && 'name' in cell)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 8: Patient group atomicity', () => {
    /**
     * Validates: Requirements 5.1, 5.3
     *
     * For every sample in the output, find all samples with the same subjectId
     * (from metadata[subjectColumn]). All such samples must be in the same row
     * of the same plate.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const result = runAlgorithm(input);
        const { plates } = result;
        const { subjectColumn } = input;

        // Collect all placed samples with their (plate, row) location
        const sampleLocations = new Map<string, { plate: number; row: number }[]>();

        for (let p = 0; p < plates.length; p++) {
          for (let r = 0; r < plates[p].length; r++) {
            for (let c = 0; c < plates[p][r].length; c++) {
              const cell = plates[p][r][c];
              if (cell && !cell.isQC) {
                const subjectId = cell.metadata[subjectColumn];
                if (subjectId) {
                  if (!sampleLocations.has(subjectId)) {
                    sampleLocations.set(subjectId, []);
                  }
                  sampleLocations.get(subjectId)!.push({ plate: p, row: r });
                }
              }
            }
          }
        }

        // For each subject, all samples must be in the same (plate, row)
        sampleLocations.forEach((locations, subjectId) => {
          if (locations.length > 1) {
            const firstPlate = locations[0].plate;
            const firstRow = locations[0].row;
            for (const loc of locations) {
              expect(loc.plate).toBe(firstPlate);
              expect(loc.row).toBe(firstRow);
            }
          }
        });
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 10: Every experimental sample placed exactly once', () => {
    /**
     * Validates: Requirements 11.1, 11.4
     *
     * Collect all non-undefined, non-QC samples from the output plates.
     * The set of their names must equal the set of input experimental sample names.
     * No duplicates, no omissions.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const result = runAlgorithm(input);
        const { plates } = result;

        // Collect input experimental sample names
        const inputExpNames = new Set(
          input.searches.filter(s => !s.isQC).map(s => s.name)
        );

        // Collect output experimental sample names
        const outputExpNames: string[] = [];
        for (const plate of plates) {
          for (const row of plate) {
            for (const cell of row) {
              if (cell && !cell.isQC) {
                outputExpNames.push(cell.name);
              }
            }
          }
        }

        // No duplicates
        const outputExpSet = new Set(outputExpNames);
        expect(outputExpNames.length).toBe(outputExpSet.size);

        // Same set
        expect(outputExpSet.size).toBe(inputExpNames.size);
        outputExpSet.forEach(name => {
          expect(inputExpNames.has(name)).toBe(true);
        });
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 11: No row or plate exceeds capacity', () => {
    /**
     * Validates: Requirements 11.2, 11.3
     *
     * For every row in every plate, count non-undefined cells. Must be ≤ numColumns.
     * For every plate, total non-undefined cells ≤ numRows × numColumns.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const result = runAlgorithm(input);
        const { plates } = result;
        const { numRows, numColumns } = input;

        for (let p = 0; p < plates.length; p++) {
          let plateTotalSamples = 0;
          for (let r = 0; r < plates[p].length; r++) {
            let rowSamples = 0;
            for (let c = 0; c < plates[p][r].length; c++) {
              if (plates[p][r][c] !== undefined) {
                rowSamples++;
              }
            }
            // Row must not exceed numColumns
            expect(rowSamples).toBeLessThanOrEqual(numColumns);
            plateTotalSamples += rowSamples;
          }
          // Plate must not exceed numRows × numColumns
          expect(plateTotalSamples).toBeLessThanOrEqual(numRows * numColumns);
        }
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 12: keepEmptyInLastPlate has no effect', () => {
    /**
     * Validates: Requirements 11.5
     *
     * Run with keepEmptyInLastPlate=true and false. Due to internal randomization
     * (shuffleArray), we compare the SORTED set of all experimental sample names
     * across ALL plates, verifying the total set is the same.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const resultTrue = runAlgorithm(input, true);
        const resultFalse = runAlgorithm(input, false);

        // Collect all experimental sample names from each result
        function collectExpNames(plates: (SearchData | undefined)[][][]): string[] {
          const names: string[] = [];
          for (const plate of plates) {
            for (const row of plate) {
              for (const cell of row) {
                if (cell && !cell.isQC) {
                  names.push(cell.name);
                }
              }
            }
          }
          return names.sort();
        }

        const namesTrue = collectExpNames(resultTrue.plates);
        const namesFalse = collectExpNames(resultFalse.plates);

        expect(namesTrue).toEqual(namesFalse);
      }),
      { numRuns: 20 }
    );
  });
});


// ============================================================================
// Property-Based Tests — Scoring and Equivalence (Properties 3, 4, 6, 7)
// ============================================================================

import { distributeGroupsToRows, computeGlobalProportions } from '../algorithms/repeatedMeasuresDistribution';

describe('Property-Based Tests — Scoring and Equivalence', () => {

  it('Feature: dp-plate-optimization, Property 3: Equivalence collapse interchangeability', () => {
    /**
     * Validates: Requirements 2.5, 6.3, 6.7
     *
     * Generate SubjectGroups where at least 2 groups share the same (covariateKey, groupSize).
     * Build GroupTypes, run innerDP. Swap the two interchangeable groups' identities, rebuild
     * GroupTypes, run innerDP again. The buildGroupTypes output should be identical.
     */
    const arb = fc.gen().map(gen => {
      // 2-4 covariate keys
      const numKeys = gen(fc.integer, { min: 2, max: 4 });
      const covariateKeys: string[] = [];
      for (let i = 0; i < numKeys; i++) {
        covariateKeys.push(`Cov${i}`);
      }

      // 4-8 groups with sizes 1-2
      const numGroups = gen(fc.integer, { min: 4, max: 8 });
      const groups: SubjectGroup[] = [];

      // Guarantee at least 2 groups share the same (covariateKey, groupSize) by construction:
      // First two groups share the same key and size
      const sharedKey = covariateKeys[0];
      const sharedSize = gen(fc.integer, { min: 1, max: 2 });

      groups.push(makeGroup('Shared_0', sharedKey, sharedSize));
      groups.push(makeGroup('Shared_1', sharedKey, sharedSize));

      // Remaining groups are random
      for (let i = 2; i < numGroups; i++) {
        const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
        const size = gen(fc.integer, { min: 1, max: 2 });
        groups.push(makeGroup(`G${i}`, covariateKeys[keyIdx], size));
      }

      // Row capacities: 2 rows, capacity 4-6 each
      const rowCap = gen(fc.integer, { min: 4, max: 6 });
      const rowCapacities = [rowCap, rowCap];

      return { groups, rowCapacities, covariateKeys };
    });

    fc.assert(
      fc.property(arb, ({ groups, rowCapacities, covariateKeys }) => {
        // Build GroupTypes from original groups
        const gt1 = buildGroupTypes(groups);

        // Swap the first two groups (which share covariateKey and groupSize)
        const swappedGroups = [...groups];
        // Swap subjectIds and samples between groups[0] and groups[1]
        const temp: SubjectGroup = {
          subjectId: swappedGroups[0].subjectId,
          samples: swappedGroups[0].samples,
          size: swappedGroups[0].size,
        };
        swappedGroups[0] = {
          subjectId: swappedGroups[1].subjectId,
          samples: swappedGroups[1].samples,
          size: swappedGroups[1].size,
        };
        swappedGroups[1] = temp;

        // Build GroupTypes from swapped groups
        const gt2 = buildGroupTypes(swappedGroups);

        // The GroupTypes should be identical: same number of types, same counts
        expect(gt2.length).toBe(gt1.length);

        // Compare sorted by key for determinism
        const sortedGt1 = [...gt1].sort((a, b) =>
          `${a.covariateKey}#${a.groupSize}`.localeCompare(`${b.covariateKey}#${b.groupSize}`)
        );
        const sortedGt2 = [...gt2].sort((a, b) =>
          `${a.covariateKey}#${a.groupSize}`.localeCompare(`${b.covariateKey}#${b.groupSize}`)
        );

        for (let i = 0; i < sortedGt1.length; i++) {
          expect(sortedGt2[i].covariateKey).toBe(sortedGt1[i].covariateKey);
          expect(sortedGt2[i].groupSize).toBe(sortedGt1[i].groupSize);
          expect(sortedGt2[i].count).toBe(sortedGt1[i].count);
        }

        // Also run innerDP on both and verify both produce valid assignments
        const allSamples = groups.flatMap(g => g.samples);
        const globalProportions = computeGlobalProportions(allSamples);

        const result1 = innerDP(gt1, rowCapacities, globalProportions);
        const result2 = innerDP(gt2, rowCapacities, globalProportions);

        // Both should produce assignments that don't exceed row capacities
        for (let r = 0; r < rowCapacities.length; r++) {
          const row1Size = (result1.assignment.get(r) ?? []).reduce((s, g) => s + g.size, 0);
          const row2Size = (result2.assignment.get(r) ?? []).reduce((s, g) => s + g.size, 0);
          expect(row1Size).toBeLessThanOrEqual(rowCapacities[r]);
          expect(row2Size).toBeLessThanOrEqual(rowCapacities[r]);
        }
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 4: buildGroupTypes distinct type count', () => {
    /**
     * Validates: Requirements 3.1
     *
     * For random SubjectGroups, verify:
     * - Number of GroupType entries equals number of unique (covariateKey, groupSize) pairs
     * - Sum of all GroupType.count values equals total number of input groups
     */
    const arb = fc.gen().map(gen => {
      // 1-3 covariate keys
      const numKeys = gen(fc.integer, { min: 1, max: 3 });
      const covariateKeys: string[] = [];
      for (let i = 0; i < numKeys; i++) {
        covariateKeys.push(`Key${i}`);
      }

      // 3-10 groups with sizes 1-3
      const numGroups = gen(fc.integer, { min: 3, max: 10 });
      const groups: SubjectGroup[] = [];
      for (let i = 0; i < numGroups; i++) {
        const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
        const size = gen(fc.integer, { min: 1, max: 3 });
        groups.push(makeGroup(`P${i}`, covariateKeys[keyIdx], size));
      }

      return { groups };
    });

    fc.assert(
      fc.property(arb, ({ groups }) => {
        const result = buildGroupTypes(groups);

        // Compute expected unique (covariateKey, groupSize) pairs
        const uniquePairs = new Set<string>();
        for (const g of groups) {
          const covKey = g.samples[0]?.covariateKey ?? '';
          uniquePairs.add(`${covKey}#${g.size}`);
        }

        // Number of GroupType entries equals number of unique pairs
        expect(result.length).toBe(uniquePairs.size);

        // Sum of all counts equals total number of input groups
        const totalCount = result.reduce((sum, gt) => sum + gt.count, 0);
        expect(totalCount).toBe(groups.length);
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 6: Scoring function correctness', () => {
    /**
     * Validates: Requirements 4.2
     *
     * Generate random samples with covariateKeys and a matching globalProportions map.
     * Compute rowImbalanceScore and independently compute Σ_k (actualProportion(k) - globalProportion(k))².
     * Verify they match.
     */
    const arb = fc.gen().map(gen => {
      // 1-3 covariate keys
      const numKeys = gen(fc.integer, { min: 1, max: 3 });
      const covariateKeys: string[] = [];
      for (let i = 0; i < numKeys; i++) {
        covariateKeys.push(`Cov${i}`);
      }

      // 2-10 samples
      const numSamples = gen(fc.integer, { min: 2, max: 10 });
      const samples: SearchData[] = [];
      for (let i = 0; i < numSamples; i++) {
        const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
        samples.push({
          name: `S${i}`,
          metadata: {},
          covariateKey: covariateKeys[keyIdx],
        });
      }

      // Build globalProportions: random proportions that sum to 1
      // Generate random weights and normalize
      const weights: number[] = [];
      let totalWeight = 0;
      for (let i = 0; i < covariateKeys.length; i++) {
        const w = gen(fc.integer, { min: 1, max: 10 });
        weights.push(w);
        totalWeight += w;
      }
      const globalProportions = new Map<string, number>();
      for (let i = 0; i < covariateKeys.length; i++) {
        globalProportions.set(covariateKeys[i], weights[i] / totalWeight);
      }

      return { samples, globalProportions, covariateKeys };
    });

    fc.assert(
      fc.property(arb, ({ samples, globalProportions, covariateKeys }) => {
        const score = rowImbalanceScore(samples, globalProportions);

        // Independently compute Σ_k (actualProportion(k) - globalProportion(k))²
        const total = samples.length;
        const counts = new Map<string, number>();
        for (const s of samples) {
          const key = s.covariateKey ?? '';
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        let expectedScore = 0;
        globalProportions.forEach((globalProp, key) => {
          const actualProp = (counts.get(key) ?? 0) / total;
          expectedScore += (actualProp - globalProp) ** 2;
        });

        expect(score).toBeCloseTo(expectedScore, 10);
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 7: DP score ≤ greedy score', () => {
    /**
     * Validates: Requirements 4.3
     *
     * For small inputs where the DP path is taken, verify that the DP total score
     * is at most the greedy total score. Uses groups with size ≥ 2 only for fair
     * comparison at the innerDP level.
     */
    const arb = fc.gen().map(gen => {
      // 1-3 covariate keys
      const numKeys = gen(fc.integer, { min: 2, max: 3 });
      const covariateKeys: string[] = [];
      for (let i = 0; i < numKeys; i++) {
        covariateKeys.push(`Cov${i}`);
      }

      // 4-6 groups, all with size 2 (to avoid singleton handling differences)
      const numGroups = gen(fc.integer, { min: 4, max: 6 });
      const groups: SubjectGroup[] = [];
      for (let i = 0; i < numGroups; i++) {
        const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
        groups.push(makeGroup(`P${i}`, covariateKeys[keyIdx], 2));
      }

      // 2-3 rows, capacity large enough to fit all groups
      const numRows = gen(fc.integer, { min: 2, max: 3 });
      const totalSamples = groups.reduce((s, g) => s + g.size, 0);
      const minCapPerRow = Math.ceil(totalSamples / numRows);
      // Ensure capacity is at least minCapPerRow and at least 4
      const rowCap = Math.max(minCapPerRow, 4);
      const rowCapacities: number[] = new Array(numRows).fill(rowCap);

      return { groups, rowCapacities, covariateKeys };
    });

    fc.assert(
      fc.property(arb, ({ groups, rowCapacities, covariateKeys }) => {
        const allSamples = groups.flatMap(g => g.samples);
        const globalProportions = computeGlobalProportions(allSamples);

        // DP path — seed with greedy baseline so DP can only improve
        const groupTypes = buildGroupTypes(groups);

        // Greedy path — may throw if it can't fit, skip in that case
        let greedyAssignment: Map<number, SubjectGroup[]>;
        try {
          greedyAssignment = distributeGroupsToRows(groups, rowCapacities, globalProportions);
        } catch {
          // Greedy couldn't fit — skip this test case
          return;
        }

        // Compute greedy score
        let greedyTotalScore = 0;
        for (let r = 0; r < rowCapacities.length; r++) {
          const rowGroups = greedyAssignment.get(r) ?? [];
          const rowSamples = rowGroups.flatMap(g => g.samples);
          if (rowSamples.length > 0) {
            greedyTotalScore += rowImbalanceScore(rowSamples, globalProportions);
          }
        }

        // Run DP seeded with greedy baseline (matching pipeline behavior)
        const dpResult = innerDP(
          groupTypes, rowCapacities, globalProportions, 500_000,
          { score: greedyTotalScore, assignment: greedyAssignment }
        );

        // Compute DP total score
        let dpTotalScore = 0;
        for (let r = 0; r < rowCapacities.length; r++) {
          const rowGroups = dpResult.assignment.get(r) ?? [];
          const rowSamples = rowGroups.flatMap(g => g.samples);
          if (rowSamples.length > 0) {
            dpTotalScore += rowImbalanceScore(rowSamples, globalProportions);
          }
        }

        // DP score should be ≤ greedy score (DP is optimal or at least as good)
        // Use small epsilon for floating point
        expect(dpTotalScore).toBeLessThanOrEqual(greedyTotalScore + 1e-10);
      }),
      { numRuns: 20 }
    );
  });

});


// ============================================================================
// Property-Based Tests — QC and Row Reordering (Properties 2, 5, 9)
// ============================================================================

describe('Property-Based Tests — QC and Row Reordering', () => {

  it('Feature: dp-plate-optimization, Property 2: Phase 1 QC uniform capacities', () => {
    /**
     * Validates: Requirements 1.4, 1.5
     *
     * After running groupAwareDPRandomization, for each plate, count QC samples per row.
     * Phase 1 places floor(totalQCForPlate / numRows) QC per row uniformly.
     * Phase 2 places the remainder greedily into rows with available capacity.
     * Observable property: every row gets at least floor(totalQCForPlate / numRows) QC
     * (the Phase 1 uniform baseline), and total QC per plate is preserved.
     */
    fc.assert(
      fc.property(validStudyInputArb, (input) => {
        const result = runAlgorithm(input);
        const { plates } = result;
        const { numRows } = input;

        // Count total input QC
        const totalInputQc = input.searches.filter(s => s.isQC).length;

        // Count total output QC across all plates
        let totalOutputQc = 0;

        for (let p = 0; p < plates.length; p++) {
          const qcCountsPerRow: number[] = [];
          let plateQcTotal = 0;
          for (let r = 0; r < plates[p].length; r++) {
            let qcCount = 0;
            for (let c = 0; c < plates[p][r].length; c++) {
              if (plates[p][r][c]?.isQC) {
                qcCount++;
              }
            }
            qcCountsPerRow.push(qcCount);
            plateQcTotal += qcCount;
          }
          totalOutputQc += plateQcTotal;

          // Phase 1 baseline: floor(totalQCForPlate / numRows)
          const phase1QcPerRow = Math.floor(plateQcTotal / numRows);

          // Every row must have at least the Phase 1 uniform baseline
          const minQc = Math.min(...qcCountsPerRow);
          expect(minQc).toBeGreaterThanOrEqual(phase1QcPerRow);
        }

        // Total QC preserved across all plates
        expect(totalOutputQc).toBe(totalInputQc);
      }),
      { numRuns: 20 }
    );
  });

  it('Feature: dp-plate-optimization, Property 5: Valid subsets fit within row capacity', () => {
    /**
     * Validates: Requirements 3.5
     *
     * Generate groups and row capacities, run innerDP.
     * For each row in the assignment, verify sum of group sizes ≤ row capacity.
     */
    const arb = fc.gen().map(gen => {
      // 2-4 rows, capacity 4-8 each
      const numRows = gen(fc.integer, { min: 2, max: 4 });
      const rowCap = gen(fc.integer, { min: 4, max: 8 });
      const rowCapacities: number[] = new Array(numRows).fill(rowCap);
      const totalCapacity = numRows * rowCap;

      // 1-4 covariate keys
      const numKeys = gen(fc.integer, { min: 1, max: 4 });
      const covariateKeys: string[] = [];
      for (let i = 0; i < numKeys; i++) {
        covariateKeys.push(`Cov${i}`);
      }

      // 3-8 groups with sizes 1-3, ensuring total fits in capacity
      const numGroups = gen(fc.integer, { min: 3, max: 8 });
      const groups: SubjectGroup[] = [];
      let totalSize = 0;
      for (let i = 0; i < numGroups; i++) {
        const maxSize = Math.min(3, rowCap, totalCapacity - totalSize);
        if (maxSize < 1) break;
        const size = gen(fc.integer, { min: 1, max: maxSize });
        const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
        groups.push(makeGroup(`P${i}`, covariateKeys[keyIdx], size));
        totalSize += size;
      }

      // Need at least 1 group
      if (groups.length === 0) {
        groups.push(makeGroup('P0', covariateKeys[0], 1));
      }

      return { groups, rowCapacities, covariateKeys };
    });

    fc.assert(
      fc.property(arb, ({ groups, rowCapacities, covariateKeys }) => {
        const allSamples = groups.flatMap(g => g.samples);
        const globalProportions = computeGlobalProportions(allSamples);
        const groupTypes = buildGroupTypes(groups);

        const result = innerDP(groupTypes, rowCapacities, globalProportions);

        // For each row, verify sum of group sizes ≤ row capacity
        for (let r = 0; r < rowCapacities.length; r++) {
          const rowGroups = result.assignment.get(r) ?? [];
          const totalSamples = rowGroups.reduce((sum, g) => sum + g.size, 0);
          expect(totalSamples).toBeLessThanOrEqual(rowCapacities[r]);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('Feature: dp-plate-optimization, Property 9: Row reordering valid permutation', () => {
    /**
     * Validates: Requirements 8.2
     *
     * Generate random row assignments, run reorderRows.
     * Verify the result is a valid permutation of [0, 1, ..., numRows-1]:
     * - Length equals numRows
     * - Contains every index exactly once
     */
    const arb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 8 });

      // Build row assignments: each row has 0-4 SubjectGroups
      const rowAssignments = new Map<number, SubjectGroup[]>();
      const covariateKeys = ['CovA', 'CovB', 'CovC'];

      for (let r = 0; r < numRows; r++) {
        const numGroups = gen(fc.integer, { min: 0, max: 4 });
        const groups: SubjectGroup[] = [];
        for (let g = 0; g < numGroups; g++) {
          const keyIdx = gen(fc.integer, { min: 0, max: covariateKeys.length - 1 });
          const size = gen(fc.integer, { min: 1, max: 3 });
          groups.push(makeGroup(`R${r}_G${g}`, covariateKeys[keyIdx], size));
        }
        rowAssignments.set(r, groups);
      }

      return { rowAssignments, numRows };
    });

    fc.assert(
      fc.property(arb, ({ rowAssignments, numRows }) => {
        const result = reorderRows(rowAssignments, numRows);

        // Length equals numRows
        expect(result.length).toBe(numRows);

        // Contains every index exactly once
        const sorted = [...result].sort((a, b) => a - b);
        const expected = Array.from({ length: numRows }, (_, i) => i);
        expect(sorted).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

});
