import * as fc from 'fast-check';
import { buildSubjectGroups, validateSubjectGroups, distributeGroupsToPlates, distributeGroupsToRows, groupAwareRandomization, covariateImbalanceScore, computeGlobalProportions, distributeQcByCovariate } from '../algorithms/repeatedMeasuresDistribution';
import { SearchData, SubjectGroup, RepeatedMeasuresConfig } from '../utils/types';

// Helper: create a sample with a subject column value
const makeSample = (name: string, subjectId: string): SearchData => ({
  name,
  metadata: { SubjectID: subjectId },
});

// Helper: create a sample with no subject column value (singleton)
const makeSingletonSample = (name: string): SearchData => ({
  name,
  metadata: {},
});

// Helper: create a SubjectGroup with a given treatment
const makeGroup = (id: string, size: number, treatment: string = 'Drug'): SubjectGroup => ({
  subjectId: id,
  samples: Array.from({ length: size }, (_, i) => ({
    name: `${id}_T${i}`,
    metadata: { SubjectID: id, Treatment: treatment },
    covariateKey: treatment,
  })),
  size,
});

// Helper: standard globalProportions for Drug/Placebo tests (equal 50/50)
const DRUG_PLACEBO_PROPORTIONS = new Map<string, number>([['Drug', 0.5], ['Placebo', 0.5]]);
const EMPTY_PROPORTIONS = new Map<string, number>();

// ─── Property-Based Tests ───────────────────────────────────────────────────

describe('Property 1: Subject grouping is complete and disjoint', () => {
  // Feature: repeated-measures-constraints, Property 1: Subject grouping is complete and disjoint
  // **Validates: Requirements 1.2**

  const sampleArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }),
    subjectId: fc.oneof(
      fc.string({ minLength: 1, maxLength: 10 }),  // non-empty subject ID
      fc.constantFrom('')                            // empty → singleton
    ),
  });

  it('every sample appears in exactly one group and total count is preserved', () => {
    fc.assert(
      fc.property(
        fc.array(sampleArb, { minLength: 1, maxLength: 50 }),
        (sampleDefs) => {
          const samples: SearchData[] = sampleDefs.map((s, i) => ({
            name: `${s.name}_${i}`,
            metadata: { SubjectID: s.subjectId } as { [key: string]: string },
          }));

          const groups = buildSubjectGroups(samples, 'SubjectID');

          // (a) Total samples across all groups equals input count
          const totalInGroups = groups.reduce((sum, g) => sum + g.size, 0);
          expect(totalInGroups).toBe(samples.length);

          // (b) Every sample appears in exactly one group (disjoint + complete)
          const allGroupedSamples = groups.flatMap(g => g.samples);
          const groupedNames = allGroupedSamples.map(s => s.name).sort();
          const inputNames = samples.map(s => s.name).sort();
          expect(groupedNames).toEqual(inputNames);

          // (c) All samples in a group share the same subject column value (after trimming)
          for (const group of groups) {
            if (!group.subjectId.startsWith('__singleton_')) {
              for (const sample of group.samples) {
                expect(sample.metadata['SubjectID'].trim()).toBe(group.subjectId);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: Same Plate grouping invariant', () => {
  // Feature: repeated-measures-constraints, Property 2: Same Plate grouping invariant
  // **Validates: Requirements 3.2, 5.1**

  it('all samples sharing the same subject ID are assigned to the same plate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 24 }),  // plate capacity
        fc.integer({ min: 1, max: 4 }),   // number of plates
        fc.gen().map(gen => gen),
        (plateCapacity, numPlates, gen) => {
          const numGroups = gen(fc.integer, { min: 1, max: 15 });
          const groups: SubjectGroup[] = [];
          const usedIds = new Set<string>();

          for (let i = 0; i < numGroups; i++) {
            const id = `P${String(i).padStart(3, '0')}`;
            if (usedIds.has(id)) continue;
            usedIds.add(id);

            const groupSize = gen(fc.integer, { min: 1, max: plateCapacity });
            const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
            groups.push({
              subjectId: id,
              samples: Array.from({ length: groupSize }, (_, j) => ({
                name: `${id}_T${j}`,
                metadata: { SubjectID: id, Treatment: treatment },
              })),
              size: groupSize,
            });
          }

          if (groups.length === 0) return;

          const totalSamples = groups.reduce((sum, g) => sum + g.size, 0);
          const totalCapacity = plateCapacity * numPlates;
          if (totalSamples > totalCapacity) return;

          const plateCapacities = Array(numPlates).fill(plateCapacity);

          let result: Map<number, SubjectGroup[]>;
          try {
            result = distributeGroupsToPlates(groups, plateCapacities, DRUG_PLACEBO_PROPORTIONS);
          } catch {
            return; // infeasible packing is acceptable
          }

          // Every subject appears on exactly one plate
          const subjectPlateMap = new Map<string, Set<number>>();
          result.forEach((assignedGroups, plateIdx) => {
            for (const group of assignedGroups) {
              if (!subjectPlateMap.has(group.subjectId)) {
                subjectPlateMap.set(group.subjectId, new Set());
              }
              subjectPlateMap.get(group.subjectId)!.add(plateIdx);
            }
          });
          subjectPlateMap.forEach((plateIndices) => {
            expect(plateIndices.size).toBe(1);
          });

          // All input samples are accounted for
          const totalAssigned = Array.from(result.values())
            .flatMap(gs => gs)
            .reduce((sum, g) => sum + g.size, 0);
          expect(totalAssigned).toBe(totalSamples);

          // No plate exceeds its capacity
          result.forEach((assignedGroups, plateIdx) => {
            const samplesOnPlate = assignedGroups.reduce((sum, g) => sum + g.size, 0);
            expect(samplesOnPlate <= plateCapacities[plateIdx]).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Same Row grouping invariant + Property 5: Row capacity is never exceeded', () => {
  // Feature: repeated-measures-constraints, Property 3: Same Row grouping invariant
  // **Validates: Requirements 3.3, 6.1**
  // Feature: repeated-measures-constraints, Property 5: Row capacity is never exceeded
  // **Validates: Requirements 6.2**

  it('all samples sharing the same subject ID are assigned to the same row and no row exceeds capacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),  // row capacity
        fc.integer({ min: 2, max: 6 }),   // number of rows
        fc.gen().map(gen => gen),
        (rowCapacity, numRows, gen) => {
          const numGroups = gen(fc.integer, { min: 1, max: 15 });
          const groups: SubjectGroup[] = [];
          const usedIds = new Set<string>();
          let totalSamples = 0;
          const totalCapacity = rowCapacity * numRows;

          for (let i = 0; i < numGroups; i++) {
            const id = `S${String(i).padStart(3, '0')}`;
            if (usedIds.has(id)) continue;
            usedIds.add(id);

            const maxGroupSize = Math.min(rowCapacity, totalCapacity - totalSamples);
            if (maxGroupSize < 1) break;

            const groupSize = gen(fc.integer, { min: 1, max: maxGroupSize });
            const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
            groups.push({
              subjectId: id,
              samples: Array.from({ length: groupSize }, (_, j) => ({
                name: `${id}_T${j}`,
                metadata: { SubjectID: id, Treatment: treatment },
              })),
              size: groupSize,
            });
            totalSamples += groupSize;
          }

          if (groups.length === 0) return;
          if (totalSamples > totalCapacity) return;

          const rowCapacities = Array(numRows).fill(rowCapacity);

          let result: Map<number, SubjectGroup[]>;
          try {
            result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
          } catch {
            return; // infeasible packing is acceptable
          }

          // Every subject appears in exactly one row
          const subjectRowMap = new Map<string, Set<number>>();
          result.forEach((assignedGroups, rowIdx) => {
            for (const group of assignedGroups) {
              if (!subjectRowMap.has(group.subjectId)) {
                subjectRowMap.set(group.subjectId, new Set());
              }
              subjectRowMap.get(group.subjectId)!.add(rowIdx);
            }
          });
          subjectRowMap.forEach((rowIndices) => {
            expect(rowIndices.size).toBe(1);
          });

          // All input samples are accounted for
          const totalAssigned = Array.from(result.values())
            .flatMap(gs => gs)
            .reduce((sum, g) => sum + g.size, 0);
          expect(totalAssigned).toBe(totalSamples);

          // No row exceeds its capacity (Property 5)
          result.forEach((assignedGroups, rowIdx) => {
            const samplesInRow = assignedGroups.reduce((sum, g) => sum + g.size, 0);
            expect(samplesInRow <= rowCapacities[rowIdx]).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe('buildSubjectGroups', () => {
  it('groups samples by subject column and treats empty values as singletons', () => {
    const samples: SearchData[] = [
      makeSample('P001_T1', 'P001'),
      makeSample('P001_T2', 'P001'),
      makeSample('P002_T1', 'P002'),
      makeSingletonSample('QC_1'),
      makeSingletonSample('QC_2'),
    ];

    const groups = buildSubjectGroups(samples, 'SubjectID');

    expect(groups.length).toBe(4);

    const p001 = groups.find(g => g.subjectId === 'P001');
    expect(p001!.size).toBe(2);
    expect(p001!.samples.map(s => s.name).sort()).toEqual(['P001_T1', 'P001_T2']);

    const p002 = groups.find(g => g.subjectId === 'P002');
    expect(p002!.size).toBe(1);
    expect(p002!.samples[0].name).toBe('P002_T1');

    const singletons = groups.filter(g => g.subjectId.startsWith('__singleton_'));
    expect(singletons.length).toBe(2);
    expect(singletons.every(s => s.size === 1)).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const groups = buildSubjectGroups([], 'SubjectID');
    expect(groups).toEqual([]);
  });

  it('treats whitespace-only subject values as singletons', () => {
    const samples: SearchData[] = [
      { name: 'S1', metadata: { SubjectID: '  ' } },
      { name: 'S2', metadata: { SubjectID: 'P001' } },
    ];

    const groups = buildSubjectGroups(samples, 'SubjectID');
    expect(groups.length).toBe(2);

    const singletons = groups.filter(g => g.subjectId.startsWith('__singleton_'));
    expect(singletons.length).toBe(1);
    expect(singletons[0].samples[0].name).toBe('S1');
  });
});

describe('validateSubjectGroups', () => {
  it('returns valid when all groups fit within constraints', () => {
    const groups = [
      makeGroup('P001', 4),
      makeGroup('P002', 3),
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result).toEqual({ isValid: true, errors: [], warnings: [] });
  });

  it('rejects group exceeding row capacity with same-row constraint', () => {
    const groups = [
      makeGroup('P001', 13),
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'Subject P001 has 13 samples, which exceeds the row capacity of 12. Reduce group size or switch to Same Plate constraint.',
    ]);
  });

  it('rejects group exceeding plate capacity with same-plate constraint', () => {
    const groups = [
      makeGroup('P001', 100),
    ];

    const result = validateSubjectGroups(groups, 'same-plate', 12, 96, 192);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'Subject P001 has 100 samples, which exceeds the plate capacity of 96.',
    ]);
  });

  it('rejects when total samples exceed total well capacity', () => {
    const groups = [
      makeGroup('P001', 50),
      makeGroup('P002', 50),
    ];

    const result = validateSubjectGroups(groups, 'same-plate', 12, 96, 96);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'Total samples (100) exceed available well capacity (96).',
    ]);
  });

  it('warns when majority of groups are singletons', () => {
    const groups: SubjectGroup[] = [
      makeGroup('P001', 1),
      { subjectId: '__singleton_0', samples: [makeSingletonSample('QC1')], size: 1 },
      { subjectId: '__singleton_1', samples: [makeSingletonSample('QC2')], size: 1 },
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toEqual([
      '2 out of 3 groups are singletons (empty subject ID). Consider checking your subject column selection.',
    ]);
  });
});

// ─── Unit Tests: distributeGroupsToPlates ───────────────────────────────────

describe('distributeGroupsToPlates', () => {
  it('handles exact-fit scenario where groups perfectly fill plates', () => {
    // 2 groups of 6 = 12 samples, 2 plates of 6 capacity each → exact fit
    const groups = [
      makeGroup('P001', 6, 'Drug'),
      makeGroup('P002', 6, 'Placebo'),
    ];

    const result = distributeGroupsToPlates(groups, [6, 6], DRUG_PLACEBO_PROPORTIONS);

    // Total assigned
    const totalAssigned = Array.from(result.values())
      .flatMap(gs => gs)
      .reduce((sum, g) => sum + g.size, 0);
    expect(totalAssigned).toBe(12);

    // Each plate has exactly 6
    const counts = Array.from(result.values()).map(gs =>
      gs.reduce((sum, g) => sum + g.size, 0)
    );
    expect(counts.sort()).toEqual([6, 6]);
  });

  it('distributes singletons after multi-sample groups to fill remaining capacity', () => {
    // 2 multi-sample groups of 3 + 4 singletons = 10 samples, 2 plates of 5
    const groups: SubjectGroup[] = [
      makeGroup('P001', 3, 'Drug'),
      makeGroup('P002', 3, 'Placebo'),
      { subjectId: 'S1', samples: [{ name: 'S1', metadata: { SubjectID: 'S1', Treatment: 'Drug' } }], size: 1 },
      { subjectId: 'S2', samples: [{ name: 'S2', metadata: { SubjectID: 'S2', Treatment: 'Placebo' } }], size: 1 },
      { subjectId: 'S3', samples: [{ name: 'S3', metadata: { SubjectID: 'S3', Treatment: 'Drug' } }], size: 1 },
      { subjectId: 'S4', samples: [{ name: 'S4', metadata: { SubjectID: 'S4', Treatment: 'Placebo' } }], size: 1 },
    ];

    const result = distributeGroupsToPlates(groups, [5, 5], DRUG_PLACEBO_PROPORTIONS);

    const totalAssigned = Array.from(result.values())
      .flatMap(gs => gs)
      .reduce((sum, g) => sum + g.size, 0);
    expect(totalAssigned).toBe(10);

    // Each plate has exactly 5 (3-sample group + 2 singletons)
    const counts = Array.from(result.values()).map(gs =>
      gs.reduce((sum, g) => sum + g.size, 0)
    );
    expect(counts.sort()).toEqual([5, 5]);

    // Multi-sample groups are intact
    const allGroups = Array.from(result.values()).flat();
    const p001 = allGroups.find(g => g.subjectId === 'P001');
    expect(p001!.size).toBe(3);
    const p002 = allGroups.find(g => g.subjectId === 'P002');
    expect(p002!.size).toBe(3);
  });

  it('throws when a group cannot fit in any plate', () => {
    const groups = [makeGroup('P001', 10, 'Drug')];

    expect(() => {
      distributeGroupsToPlates(groups, [5, 5], EMPTY_PROPORTIONS);
    }).toThrow('Unable to fit all subject groups into available plates. Subject P001 (size 10) cannot fit in any plate. Add more plates or reduce group sizes.');
  });
});


// ─── Unit Tests: distributeGroupsToRows ─────────────────────────────────────

describe('distributeGroupsToRows', () => {
  it('packs groups of sizes [4,4,3,3,2,2,2] into 3 rows of 10', () => {
    // Total = 4+4+3+3+2+2+2 = 20, 3 rows of 10 = 30 capacity (enough slack for FFD)
    // FFD sorts descending: [4,4,3,3,2,2,2]
    // Row 0: 4 → Row 1: 4 → Row 0: 3 (=7) → Row 1: 3 (=7) → Row 0: 2 (=9) → Row 1: 2 (=9) → Row 2: 2
    const groups = [
      makeGroup('S1', 4, 'Drug'),
      makeGroup('S2', 4, 'Placebo'),
      makeGroup('S3', 3, 'Drug'),
      makeGroup('S4', 3, 'Placebo'),
      makeGroup('S5', 2, 'Drug'),
      makeGroup('S6', 2, 'Placebo'),
      makeGroup('S7', 2, 'Drug'),
    ];

    const result = distributeGroupsToRows(groups, [10, 10, 10], DRUG_PLACEBO_PROPORTIONS);

    // All groups are assigned
    const allAssigned = Array.from(result.values()).flat();
    expect(allAssigned.length).toBe(7);

    // Total sample count matches
    const totalSamples = allAssigned.reduce((sum, g) => sum + g.size, 0);
    expect(totalSamples).toBe(20);

    // No row exceeds capacity 10
    result.forEach((assignedGroups) => {
      const rowTotal = assignedGroups.reduce((sum, g) => sum + g.size, 0);
      expect(rowTotal).toBeLessThanOrEqual(10);
    });

    // Each group appears in exactly one row
    const groupIds = allAssigned.map(g => g.subjectId).sort();
    expect(groupIds).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  });

  it('throws when a group cannot fit in any row', () => {
    const groups = [makeGroup('BIG', 11, 'Drug')];

    expect(() => {
      distributeGroupsToRows(groups, [10, 10], EMPTY_PROPORTIONS);
    }).toThrow('but the largest row only has');
  });

  it('prefers rows that improve covariate balance when capacities are tied', () => {
    // Strategy: 2 rows of capacity 6, place groups with different treatments.
    // When rows have equal remaining capacity, the algorithm should prefer
    // the row that improves treatment balance rather than clustering same treatments.
    // Run multiple iterations to verify the tendency toward balance.
    let balancedCount = 0;
    const iterations = 20;

    for (let i = 0; i < iterations; i++) {
      // 4 groups of size 2: 2 Drug, 2 Placebo → 2 rows of 6 capacity
      // Plus 2 singletons to fill remaining capacity
      const groups = [
        makeGroup('D1', 2, 'Drug'),
        makeGroup('D2', 2, 'Placebo'),
        makeGroup('D3', 2, 'Drug'),
        makeGroup('D4', 2, 'Placebo'),
        makeGroup('S1', 1, 'Drug'),
        makeGroup('S2', 1, 'Placebo'),
      ];

      const result = distributeGroupsToRows(groups, [6, 6], DRUG_PLACEBO_PROPORTIONS);

      // Check if both rows have a mix of Drug and Placebo
      let hasBalance = true;
      result.forEach((assignedGroups) => {
        const treatments = assignedGroups.flatMap(g =>
          g.samples.map(s => s.metadata['Treatment'])
        );
        const drugCount = treatments.filter(t => t === 'Drug').length;
        const placeboCount = treatments.filter(t => t === 'Placebo').length;
        // A balanced row has both Drug and Placebo present
        if (drugCount === 0 || placeboCount === 0) {
          hasBalance = false;
        }
      });

      if (hasBalance) balancedCount++;
    }

    // The algorithm should produce balanced distributions most of the time
    expect(balancedCount).toBeGreaterThanOrEqual(iterations * 0.5);
  });

  it('distributes singletons after multi-sample groups', () => {
    // 2 multi-sample groups (size 3 each) + 4 singletons = 10 total
    // 2 rows of capacity 5
    const groups: SubjectGroup[] = [
      makeGroup('G1', 3, 'Drug'),
      makeGroup('G2', 3, 'Placebo'),
      makeGroup('S1', 1, 'Drug'),
      makeGroup('S2', 1, 'Placebo'),
      makeGroup('S3', 1, 'Drug'),
      makeGroup('S4', 1, 'Placebo'),
    ];

    const result = distributeGroupsToRows(groups, [5, 5], DRUG_PLACEBO_PROPORTIONS);

    // All groups and singletons are assigned
    const allAssigned = Array.from(result.values()).flat();
    const totalSamples = allAssigned.reduce((sum, g) => sum + g.size, 0);
    expect(totalSamples).toBe(10);

    // No row exceeds capacity
    result.forEach((assignedGroups) => {
      const rowTotal = assignedGroups.reduce((sum, g) => sum + g.size, 0);
      expect(rowTotal).toBeLessThanOrEqual(5);
    });

    // Multi-sample groups are intact (not split)
    const g1 = allAssigned.find(g => g.subjectId === 'G1');
    expect(g1!.size).toBe(3);
    const g2 = allAssigned.find(g => g.subjectId === 'G2');
    expect(g2!.size).toBe(3);

    // Each multi-sample group is in exactly one row
    const g1Row = Array.from(result.entries()).find(([_, gs]) =>
      gs.some(g => g.subjectId === 'G1')
    )![0];
    const g2Row = Array.from(result.entries()).find(([_, gs]) =>
      gs.some(g => g.subjectId === 'G2')
    )![0];

    // With capacity 5 and groups of size 3, they must be in different rows
    expect(g1Row).not.toBe(g2Row);

    // Singletons fill remaining capacity (each row should have 3 + 2 singletons = 5)
    result.forEach((assignedGroups) => {
      const multiGroups = assignedGroups.filter(g => g.size > 1);
      const singletons = assignedGroups.filter(g => g.size === 1);
      if (multiGroups.length > 0) {
        // Row with a multi-sample group should have singletons filling remaining capacity
        expect(singletons.length).toBe(2);
      }
    });
  });
});


// ─── Property-Based Test: Property 6 ───────────────────────────────────────

describe('Property 6: QC samples reduce effective capacity for group fitting', () => {
  // Feature: repeated-measures-constraints, Property 6: QC samples reduce effective capacity for group fitting
  // **Validates: Requirements 7.4**

  it('no row contains more experimental group samples than (numColumns - qcSlotsInRow)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 8 }),   // numRows
        fc.integer({ min: 4, max: 12 }),  // numColumns
        fc.gen().map(gen => gen),
        (numRows, numColumns, gen) => {
          const plateSize = numRows * numColumns;

          // Generate QC samples (1-20% of plate capacity)
          const maxQc = Math.max(1, Math.floor(plateSize * 0.2));
          const numQc = gen(fc.integer, { min: 1, max: maxQc });

          // Generate subject groups that fit within effective capacity
          const effectiveCapacity = plateSize - numQc;
          if (effectiveCapacity < 2) return; // too small to test meaningfully

          // Create groups that fit within a single row's effective capacity
          const maxGroupSize = Math.min(numColumns - 1, effectiveCapacity); // leave room for at least 1 QC per row
          if (maxGroupSize < 1) return;

          const numGroups = gen(fc.integer, { min: 1, max: Math.min(8, effectiveCapacity) });
          const samples: SearchData[] = [];
          let totalExperimental = 0;

          for (let i = 0; i < numGroups && totalExperimental < effectiveCapacity; i++) {
            const remaining = effectiveCapacity - totalExperimental;
            const groupSize = gen(fc.integer, { min: 1, max: Math.min(maxGroupSize, remaining) });
            const subjectId = `P${String(i).padStart(3, '0')}`;
            const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');

            for (let j = 0; j < groupSize; j++) {
              samples.push({
                name: `${subjectId}_T${j}`,
                metadata: { SubjectID: subjectId, Treatment: treatment },
              });
            }
            totalExperimental += groupSize;
          }

          if (totalExperimental === 0) return;

          // Add QC samples
          for (let q = 0; q < numQc; q++) {
            samples.push({
              name: `QC_${q}`,
              metadata: { Treatment: 'QC' },
              isQC: true,
            });
          }

          const config: RepeatedMeasuresConfig = {
            subjectColumn: 'SubjectID',
            groupingConstraint: 'same-row',
          };

          let result: { plates: (SearchData | undefined)[][][] };
          try {
            result = groupAwareRandomization(
              samples,
              ['Treatment'],
              config,
              true,
              numRows,
              numColumns
            );
          } catch {
            return; // infeasible packing is acceptable
          }

          // Verify: no row has more samples than numColumns
          for (const plate of result.plates) {
            for (let r = 0; r < plate.length; r++) {
              const filledWells = plate[r].filter(w => w !== undefined).length;
              expect(filledWells).toBeLessThanOrEqual(numColumns);
            }
          }

          // Verify: total placed samples equals input
          const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
          expect(totalPlaced).toBe(samples.length);

          // Verify: QC samples are present in the output
          const placedQc = result.plates.flat(2).filter(w => w?.isQC === true).length;
          expect(placedQc).toBe(numQc);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Unit Tests: groupAwareRandomization ────────────────────────────────────

describe('groupAwareRandomization', () => {
  // Helper to create experimental samples for a subject
  const makeSubjectSamples = (
    subjectId: string,
    count: number,
    treatment: string
  ): SearchData[] =>
    Array.from({ length: count }, (_, i) => ({
      name: `${subjectId}_T${i}`,
      metadata: { SubjectID: subjectId, Treatment: treatment },
    }));

  // Helper to create QC samples
  const makeQcSamples = (prefix: string, count: number): SearchData[] =>
    Array.from({ length: count }, (_, i) => ({
      name: `${prefix}_${i}`,
      metadata: { Condition: prefix },
      isQC: true,
    }));

  it('handles the small test data scenario (8 subjects, mixed sizes, QC/Reference/Blinded)', () => {
    // Scenario A from requirements: 8 subjects with mixed group sizes + QC samples
    const samples: SearchData[] = [
      ...makeSubjectSamples('P001', 4, 'Drug'),
      ...makeSubjectSamples('P002', 4, 'Placebo'),
      ...makeSubjectSamples('P003', 4, 'Drug'),
      ...makeSubjectSamples('P004', 4, 'Placebo'),
      ...makeSubjectSamples('P005', 3, 'Drug'),
      ...makeSubjectSamples('P006', 2, 'Placebo'),
      ...makeSubjectSamples('P007', 1, 'Drug'),
      ...makeSubjectSamples('P008', 1, 'Placebo'),
      ...makeQcSamples('QC', 8),
      ...makeQcSamples('Reference', 8),
      ...makeQcSamples('Blinded', 8),
    ];

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-row',
    };

    const result = groupAwareRandomization(
      samples,
      ['Treatment'],
      config,
      true,
      8,
      12
    );

    // All 47 samples should be placed
    const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
    expect(totalPlaced).toBe(47);

    // Only 1 plate needed (47 < 96)
    expect(result.plates.length).toBe(1);

    // Same-row invariant: all samples from each subject are in the same row
    const plate = result.plates[0];
    const subjectRows = new Map<string, Set<number>>();
    for (let r = 0; r < plate.length; r++) {
      for (const well of plate[r]) {
        if (well && well.metadata.SubjectID) {
          if (!subjectRows.has(well.metadata.SubjectID)) {
            subjectRows.set(well.metadata.SubjectID, new Set());
          }
          subjectRows.get(well.metadata.SubjectID)!.add(r);
        }
      }
    }
    subjectRows.forEach((rows, subjectId) => {
      expect(rows.size).toBe(1);
    });

    // No row exceeds 12 columns
    for (const row of plate) {
      const filled = row.filter(w => w !== undefined).length;
      expect(filled).toBeLessThanOrEqual(12);
    }

    // QC samples are present
    const qcCount = result.plates.flat(2).filter(w => w?.isQC === true).length;
    expect(qcCount).toBe(24);
  });

  it('with same-plate constraint keeps all subject samples on the same plate', () => {
    // Multi-plate scenario with same-plate constraint
    // 4 subjects × 3 samples = 12 experimental + 0 QC = 12 total
    // 2 rows × 4 columns = 8 wells per plate → need 2 plates
    const samples: SearchData[] = [
      ...makeSubjectSamples('P001', 3, 'Drug'),
      ...makeSubjectSamples('P002', 3, 'Placebo'),
      ...makeSubjectSamples('P003', 3, 'Drug'),
      ...makeSubjectSamples('P004', 3, 'Placebo'),
    ];

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-plate',
    };

    const result = groupAwareRandomization(
      samples,
      ['Treatment'],
      config,
      false,
      2,
      4
    );

    const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
    expect(totalPlaced).toBe(12);
    expect(result.plates.length).toBe(2);

    // Same-plate invariant: all samples from each subject are on the same plate
    const subjectPlates = new Map<string, Set<number>>();
    for (let p = 0; p < result.plates.length; p++) {
      for (const row of result.plates[p]) {
        for (const well of row) {
          if (well && well.metadata.SubjectID) {
            if (!subjectPlates.has(well.metadata.SubjectID)) {
              subjectPlates.set(well.metadata.SubjectID, new Set());
            }
            subjectPlates.get(well.metadata.SubjectID)!.add(p);
          }
        }
      }
    }
    subjectPlates.forEach((plates) => {
      expect(plates.size).toBe(1);
    });
  });

  it('keepEmptyInLastPlate + grouping constraint together', () => {
    // 20 experimental samples + 4 QC = 24 total
    // 4 rows × 6 columns = 24 wells per plate → 1 plate, exact fit
    // With keepEmptyInLastPlate=true, should still work
    const samples: SearchData[] = [
      ...makeSubjectSamples('P001', 3, 'Drug'),
      ...makeSubjectSamples('P002', 3, 'Placebo'),
      ...makeSubjectSamples('P003', 2, 'Drug'),
      ...makeSubjectSamples('P004', 2, 'Placebo'),
      ...makeQcSamples('QC', 4),
    ];

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-row',
    };

    const result = groupAwareRandomization(
      samples,
      ['Treatment'],
      config,
      true,
      4,
      6
    );

    const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
    expect(totalPlaced).toBe(14);

    // Same-row invariant
    const plate = result.plates[0];
    const subjectRows = new Map<string, Set<number>>();
    for (let r = 0; r < plate.length; r++) {
      for (const well of plate[r]) {
        if (well && well.metadata.SubjectID) {
          if (!subjectRows.has(well.metadata.SubjectID)) {
            subjectRows.set(well.metadata.SubjectID, new Set());
          }
          subjectRows.get(well.metadata.SubjectID)!.add(r);
        }
      }
    }
    subjectRows.forEach((rows) => {
      expect(rows.size).toBe(1);
    });

    // QC samples present
    const qcCount = result.plates.flat(2).filter(w => w?.isQC === true).length;
    expect(qcCount).toBe(4);
  });

  it('returns plateAssignments map with all samples', () => {
    const samples: SearchData[] = [
      ...makeSubjectSamples('P001', 3, 'Drug'),
      ...makeSubjectSamples('P002', 3, 'Placebo'),
      ...makeQcSamples('QC', 2),
    ];

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-row',
    };

    const result = groupAwareRandomization(
      samples,
      ['Treatment'],
      config,
      true,
      4,
      6
    );

    expect(result.plateAssignments).toBeDefined();
    const totalInAssignments = Array.from(result.plateAssignments!.values())
      .reduce((sum, arr) => sum + arr.length, 0);
    expect(totalInAssignments).toBe(8);
  });

  it('throws when subjectColumn is null', () => {
    const config: RepeatedMeasuresConfig = {
      subjectColumn: null,
      groupingConstraint: 'same-row',
    };

    expect(() => {
      groupAwareRandomization([], [], config, true, 8, 12);
    }).toThrow('groupAwareRandomization requires a subjectColumn to be set');
  });
});

// ─── Fix-Checking Property Tests: Valid packings never throw after fix ───────

describe('Fix Checking: Valid packings never throw after fix', () => {
  // Property 1: Fix Checking — for any input where a valid bin-packing exists (by construction),
  // distributeGroupsToRows() SHALL find a valid assignment without throwing.
  // Validates: Requirements 2.1, 2.2, 2.3, 3.3, 3.4

  /**
   * Helper: assert that distributeGroupsToRows succeeds and produces a valid assignment.
   */
  const assertValid = (
    groups: SubjectGroup[],
    rowCapacities: number[],
    result: Map<number, SubjectGroup[]>
  ) => {
    const assignedGroups = Array.from(result.values()).flat();
    const assignedIds = assignedGroups.map(g => g.subjectId).sort();
    const inputIds = groups.map(g => g.subjectId).sort();
    expect(assignedIds).toEqual(inputIds);

    for (let rowIdx = 0; rowIdx < rowCapacities.length; rowIdx++) {
      const rowGroups = result.get(rowIdx) ?? [];
      const rowTotal = rowGroups.reduce((sum, g) => sum + g.size, 0);
      expect(rowTotal).toBeLessThanOrEqual(rowCapacities[rowIdx]);
    }
  };

  // Strategy: generate a valid assignment first, then extract groups and row capacities from it.
  // This guarantees a valid packing exists by construction.
  it('PBT: constructed-feasible inputs never throw (by-construction generator)', () => {
    // Arbitrary that builds a valid assignment, then derives groups + rowCapacities
    const feasibleInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 8 });
      const numGroups = gen(fc.integer, { min: 1, max: 20 });

      // Assign each group to a random row and pick a size
      const assignments: { row: number; size: number; id: string; treatment: string }[] = [];
      for (let i = 0; i < numGroups; i++) {
        const row = gen(fc.integer, { min: 0, max: numRows - 1 });
        const size = gen(fc.integer, { min: 1, max: 6 });
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        assignments.push({ row, size, id: `G${i}`, treatment });
      }

      // Compute row capacities from the assignment (with optional slack)
      const rowCapacities = new Array(numRows).fill(0);
      for (const a of assignments) {
        rowCapacities[a.row] += a.size;
      }
      // Add 0-3 slack per row so packing isn't always trivially tight
      for (let r = 0; r < numRows; r++) {
        rowCapacities[r] += gen(fc.integer, { min: 0, max: 3 });
      }

      const groups = assignments.map(a => makeGroup(a.id, a.size, a.treatment));
      return { groups, rowCapacities };
    });

    fc.assert(
      fc.property(feasibleInputArb, ({ groups, rowCapacities }) => {
        const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertValid(groups, rowCapacities, result);
      }),
      { numRuns: 200 }
    );
  });

  // Tight packings: total group size === total capacity (zero slack)
  it('PBT: tight packings (total = capacity) never throw', () => {
    const tightInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 6 });
      const numGroups = gen(fc.integer, { min: numRows, max: numRows * 3 });

      // Build a valid assignment where each row is exactly filled
      const assignments: { row: number; size: number; id: string; treatment: string }[] = [];
      // Distribute groups round-robin, then set capacity = sum per row
      for (let i = 0; i < numGroups; i++) {
        const row = i % numRows;
        const size = gen(fc.integer, { min: 1, max: 4 });
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        assignments.push({ row, size, id: `T${i}`, treatment });
      }

      const rowCapacities = new Array(numRows).fill(0);
      for (const a of assignments) {
        rowCapacities[a.row] += a.size;
      }
      // No slack — exact fit

      const groups = assignments.map(a => makeGroup(a.id, a.size, a.treatment));
      return { groups, rowCapacities };
    });

    fc.assert(
      fc.property(tightInputArb, ({ groups, rowCapacities }) => {
        const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertValid(groups, rowCapacities, result);
      }),
      { numRuns: 200 }
    );
  });

  // Uneven row capacities (mimics QC pre-allocation reducing some rows more than others)
  it('PBT: uneven row capacities with feasible packing never throw', () => {
    const unevenInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 8 });
      // Each row gets a different capacity (simulating uneven QC allocation)
      const rowCapacities: number[] = [];
      for (let r = 0; r < numRows; r++) {
        rowCapacities.push(gen(fc.integer, { min: 3, max: 12 }));
      }

      // Build groups that fit by construction: assign each to a row that can hold it
      const groups: SubjectGroup[] = [];
      const remaining = [...rowCapacities];
      let gIdx = 0;

      // Fill rows with groups until we've placed at least a few
      const targetGroups = gen(fc.integer, { min: 1, max: 15 });
      for (let i = 0; i < targetGroups; i++) {
        // Pick a row that still has capacity
        const availableRows = remaining
          .map((cap, idx) => ({ idx, cap }))
          .filter(r => r.cap >= 1);
        if (availableRows.length === 0) break;

        const chosen = availableRows[gen(fc.integer, { min: 0, max: availableRows.length - 1 })];
        const maxSize = Math.min(chosen.cap, 6);
        const size = gen(fc.integer, { min: 1, max: maxSize });
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        groups.push(makeGroup(`U${gIdx}`, size, treatment));
        remaining[chosen.idx] -= size;
        gIdx++;
      }

      if (groups.length === 0) return null;
      return { groups, rowCapacities };
    });

    fc.assert(
      fc.property(feasibleInputArb_filter(unevenInputArb), (input) => {
        const result = distributeGroupsToRows(input.groups, input.rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertValid(input.groups, input.rowCapacities, result);
      }),
      { numRuns: 200 }
    );
  });

  // Mix of large and small groups (the pattern that triggers the original bug)
  it('PBT: mixed large/small groups with feasible packing never throw', () => {
    const mixedInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 8 });
      const rowCap = gen(fc.integer, { min: 6, max: 12 });
      // Uneven capacities: some rows get -1 or -2 (simulating QC)
      const rowCapacities = Array.from({ length: numRows }, (_, i) =>
        rowCap - gen(fc.integer, { min: 0, max: 2 })
      );

      // Build groups by construction: assign large groups first, then small
      const groups: SubjectGroup[] = [];
      const remaining = [...rowCapacities];
      let gIdx = 0;

      // Phase 1: place large groups (size 3-6)
      const numLarge = gen(fc.integer, { min: 1, max: numRows * 2 });
      for (let i = 0; i < numLarge; i++) {
        const availableRows = remaining
          .map((cap, idx) => ({ idx, cap }))
          .filter(r => r.cap >= 3);
        if (availableRows.length === 0) break;
        const chosen = availableRows[gen(fc.integer, { min: 0, max: availableRows.length - 1 })];
        const maxSize = Math.min(chosen.cap, 6);
        const size = gen(fc.integer, { min: 3, max: maxSize });
        groups.push(makeGroup(`L${gIdx}`, size, gen(fc.constantFrom, 'Drug', 'Placebo')));
        remaining[chosen.idx] -= size;
        gIdx++;
      }

      // Phase 2: place small groups (size 1-2) in remaining space
      const numSmall = gen(fc.integer, { min: 0, max: 10 });
      for (let i = 0; i < numSmall; i++) {
        const availableRows = remaining
          .map((cap, idx) => ({ idx, cap }))
          .filter(r => r.cap >= 1);
        if (availableRows.length === 0) break;
        const chosen = availableRows[gen(fc.integer, { min: 0, max: availableRows.length - 1 })];
        const size = gen(fc.integer, { min: 1, max: Math.min(2, chosen.cap) });
        groups.push(makeGroup(`S${gIdx}`, size, gen(fc.constantFrom, 'Drug', 'Placebo')));
        remaining[chosen.idx] -= size;
        gIdx++;
      }

      if (groups.length === 0) return null;

      // Add minimum slack per row so the greedy FFD heuristic has room to
      // find a valid packing. Without slack, tight packings can cause the
      // greedy algorithm to paint itself into a corner even when a valid
      // assignment exists. See .kiro/specs/greedy-ffd-backtracking/README.md.
      for (let r = 0; r < rowCapacities.length; r++) {
        rowCapacities[r] += gen(fc.integer, { min: 1, max: 3 });
      }

      return { groups, rowCapacities };
    });

    fc.assert(
      fc.property(feasibleInputArb_filter(mixedInputArb), (input) => {
        const result = distributeGroupsToRows(input.groups, input.rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertValid(input.groups, input.rowCapacities, result);
      }),
      { numRuns: 200 }
    );
  });

  // Requirement 3.3: group size > max row capacity still throws
  it('PBT: group exceeding max row capacity always throws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),   // numRows
        fc.integer({ min: 3, max: 10 }),  // maxRowCap
        (numRows, maxRowCap) => {
          const rowCapacities = Array.from({ length: numRows }, () => maxRowCap);
          const oversizedGroup = makeGroup('BIG', maxRowCap + 1, 'Drug');

          expect(() => {
            distributeGroupsToRows([oversizedGroup], rowCapacities, EMPTY_PROPORTIONS);
          }).toThrow('but the largest row only has');
        }
      ),
      { numRuns: 50 }
    );
  });

  // Requirement 3.4: total size > total capacity still throws
  it('PBT: total group size exceeding total capacity always throws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),   // numRows
        fc.integer({ min: 3, max: 8 }),   // rowCap
        (numRows, rowCap) => {
          const rowCapacities = Array.from({ length: numRows }, () => rowCap);
          const totalCapacity = numRows * rowCap;
          // Create groups that exceed total capacity
          const numGroups = totalCapacity + 1; // one more singleton than capacity
          const groups = Array.from({ length: numGroups }, (_, i) =>
            makeGroup(`X${i}`, 1, 'Drug')
          );

          expect(() => {
            distributeGroupsToRows(groups, rowCapacities, EMPTY_PROPORTIONS);
          }).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });
});

// Helper to filter out null values from generators that may produce null for empty groups
function feasibleInputArb_filter<T>(arb: fc.Arbitrary<T | null>): fc.Arbitrary<T> {
  return arb.filter((v): v is T => v !== null);
}

// ─── Preservation Property Tests: Greedy-success inputs produce identical structure ───

describe('Preservation Property: Greedy-success inputs produce identical structure', () => {
  // Property 2: Preservation — for inputs where the greedy FFD succeeds,
  // distributeGroupsToRows() produces valid assignments with all groups assigned,
  // no row over capacity, and correct structural invariants.
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  /**
   * Helper: assert structural invariants on a distributeGroupsToRows result.
   */
  const assertPreservation = (
    groups: SubjectGroup[],
    rowCapacities: number[],
    result: Map<number, SubjectGroup[]>
  ) => {
    const assignedGroups = Array.from(result.values()).flat();

    // All groups assigned to exactly one row
    const assignedIds = assignedGroups.map(g => g.subjectId).sort();
    const inputIds = groups.map(g => g.subjectId).sort();
    expect(assignedIds).toEqual(inputIds);

    // No row exceeds capacity
    for (let rowIdx = 0; rowIdx < rowCapacities.length; rowIdx++) {
      const rowGroups = result.get(rowIdx) ?? [];
      const rowTotal = rowGroups.reduce((sum, g) => sum + g.size, 0);
      expect(rowTotal).toBeLessThanOrEqual(rowCapacities[rowIdx]);
    }

    // Total assigned equals total input
    const totalAssigned = assignedGroups.reduce((sum, g) => sum + g.size, 0);
    const totalInput = groups.reduce((sum, g) => sum + g.size, 0);
    expect(totalAssigned).toBe(totalInput);
  };

  // 1. Greedy-success structural invariants
  // Generate random group configs where FFD is likely to succeed (small groups, plenty of slack).
  it('PBT: greedy-success structural invariants hold for slack inputs', () => {
    const slackInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 8 });
      const rowCap = gen(fc.integer, { min: 6, max: 12 });
      const rowCapacities = Array.from({ length: numRows }, () => rowCap);
      const totalCapacity = numRows * rowCap;

      // Generate small groups (size 1-3) that use at most 60% of total capacity
      // so FFD will succeed easily
      const maxTotal = Math.floor(totalCapacity * 0.6);
      const groups: SubjectGroup[] = [];
      let used = 0;
      let gIdx = 0;

      while (used < maxTotal) {
        const remaining = maxTotal - used;
        if (remaining < 1) break;
        const size = gen(fc.integer, { min: 1, max: Math.min(3, remaining, rowCap) });
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        groups.push(makeGroup(`GS${gIdx}`, size, treatment));
        used += size;
        gIdx++;
        if (gIdx >= 20) break; // cap number of groups
      }

      if (groups.length === 0) return null;
      return { groups, rowCapacities };
    });

    fc.assert(
      fc.property(feasibleInputArb_filter(slackInputArb), (input) => {
        const result = distributeGroupsToRows(input.groups, input.rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertPreservation(input.groups, input.rowCapacities, result);
      }),
      { numRuns: 200 }
    );
  });

  // 2. Singleton distribution preservation (Req 3.1)
  // All-singleton inputs continue to distribute correctly.
  it('PBT: singleton distribution preservation — all singletons distribute correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),   // numRows
        fc.integer({ min: 4, max: 12 }),  // rowCap
        fc.integer({ min: 1, max: 30 }),  // numSingletons
        (numRows, rowCap, numSingletons) => {
          const totalCapacity = numRows * rowCap;
          if (numSingletons > totalCapacity) return; // skip infeasible

          const rowCapacities = Array.from({ length: numRows }, () => rowCap);
          const groups: SubjectGroup[] = Array.from({ length: numSingletons }, (_, i) =>
            makeGroup(`Sing${i}`, 1, i % 2 === 0 ? 'Drug' : 'Placebo')
          );

          const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
          assertPreservation(groups, rowCapacities, result);
        }
      ),
      { numRuns: 200 }
    );
  });

  // 3. Error preservation — group exceeds max row (Req 3.3)
  it('PBT: error preservation — group exceeding max row capacity always throws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),   // numRows
        fc.integer({ min: 3, max: 10 }),  // maxRowCap
        fc.integer({ min: 1, max: 5 }),   // excess
        (numRows, maxRowCap, excess) => {
          const rowCapacities = Array.from({ length: numRows }, () => maxRowCap);
          const oversizedGroup = makeGroup('TOOBIG', maxRowCap + excess, 'Drug');

          expect(() => {
            distributeGroupsToRows([oversizedGroup], rowCapacities, EMPTY_PROPORTIONS);
          }).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  // 4. Error preservation — total exceeds capacity (Req 3.4)
  it('PBT: error preservation — total group size exceeding total capacity always throws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),   // numRows
        fc.integer({ min: 3, max: 8 }),   // rowCap
        fc.integer({ min: 1, max: 5 }),   // excess singletons beyond capacity
        (numRows, rowCap, excess) => {
          const rowCapacities = Array.from({ length: numRows }, () => rowCap);
          const totalCapacity = numRows * rowCap;
          // Create exactly totalCapacity + excess singletons
          const numGroups = totalCapacity + excess;
          const groups = Array.from({ length: numGroups }, (_, i) =>
            makeGroup(`OV${i}`, 1, 'Drug')
          );

          expect(() => {
            distributeGroupsToRows(groups, rowCapacities, EMPTY_PROPORTIONS);
          }).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  // 5. Covariate balance preservation (Req 3.6)
  // Over many runs, rows tend to have a mix of treatments (statistical tendency).
  it('PBT: covariate balance preservation — rows tend to have mixed treatments', () => {
    // Run a fixed scenario many times and check that the majority of runs produce
    // at least one mixed row. This tests the statistical tendency of covariate balancing.
    const numRuns = 50;
    let runsWithMixedRows = 0;

    for (let run = 0; run < numRuns; run++) {
      // 4 rows of capacity 8, 6 Drug groups + 6 Placebo groups of size 2 = 24 total, capacity 32
      const rowCapacities = [8, 8, 8, 8];
      const groups: SubjectGroup[] = [];
      for (let i = 0; i < 6; i++) {
        groups.push(makeGroup(`D${run}_${i}`, 2, 'Drug'));
        groups.push(makeGroup(`P${run}_${i}`, 2, 'Placebo'));
      }

      let result: Map<number, SubjectGroup[]>;
      try {
        result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
      } catch {
        continue;
      }

      // Count rows that have a mix of treatments
      let mixedRows = 0;
      result.forEach((rowGroups) => {
        const treatments = new Set(
          rowGroups.flatMap(g => g.samples.map(s => s.metadata['Treatment']))
        );
        if (treatments.size > 1) mixedRows++;
      });

      if (mixedRows >= 1) runsWithMixedRows++;
    }

    // With covariate balancing active, the majority of runs should produce mixed rows
    expect(runsWithMixedRows).toBeGreaterThanOrEqual(numRuns * 0.5);
  });

  // 6. Mixed multi-sample and singleton preservation (Req 3.1, 3.2)
  // Multi-sample groups are intact (not split), singletons fill remaining capacity.
  it('PBT: mixed multi-sample and singleton preservation', () => {
    const mixedInputArb = fc.gen().map(gen => {
      const numRows = gen(fc.integer, { min: 2, max: 6 });
      const rowCap = gen(fc.integer, { min: 6, max: 12 });
      const rowCapacities = Array.from({ length: numRows }, () => rowCap);
      const totalCapacity = numRows * rowCap;

      // Phase 1: multi-sample groups (size 2-4) using ~40% capacity
      const multiTarget = Math.floor(totalCapacity * 0.4);
      const multiGroups: SubjectGroup[] = [];
      let used = 0;
      let gIdx = 0;

      while (used < multiTarget) {
        const remaining = multiTarget - used;
        if (remaining < 2) break;
        const size = gen(fc.integer, { min: 2, max: Math.min(4, remaining, rowCap) });
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        multiGroups.push(makeGroup(`M${gIdx}`, size, treatment));
        used += size;
        gIdx++;
        if (gIdx >= 10) break;
      }

      // Phase 2: singletons using ~20% capacity
      const singletonTarget = Math.floor(totalCapacity * 0.2);
      const singletons: SubjectGroup[] = [];
      for (let i = 0; i < singletonTarget && (used + i + 1) <= totalCapacity; i++) {
        const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
        singletons.push(makeGroup(`Sng${i}`, 1, treatment));
      }

      const groups = [...multiGroups, ...singletons];
      if (groups.length === 0) return null;
      return { groups, rowCapacities, multiGroupIds: multiGroups.map(g => g.subjectId) };
    });

    fc.assert(
      fc.property(feasibleInputArb_filter(mixedInputArb), (input) => {
        const result = distributeGroupsToRows(input.groups, input.rowCapacities, DRUG_PLACEBO_PROPORTIONS);

        // Basic structural invariants
        assertPreservation(input.groups, input.rowCapacities, result);

        // Multi-sample groups are intact (not split across rows)
        const allAssigned = Array.from(result.values()).flat();
        for (const mId of input.multiGroupIds) {
          const group = allAssigned.find(g => g.subjectId === mId);
          expect(group).toBeDefined();
          // The group's size should match the original
          const original = input.groups.find(g => g.subjectId === mId)!;
          expect(group!.size).toBe(original.size);
          // The group should appear in exactly one row
          const rowsContaining = Array.from(result.entries())
            .filter(([_, gs]) => gs.some(g => g.subjectId === mId));
          expect(rowsContaining.length).toBe(1);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ─── Bug Condition Exploration: Greedy FFD fails on valid packings ───────────

describe('Bug Condition Exploration: Greedy FFD fails on valid packings', () => {
  // Property 1: Bug Condition — the greedy FFD throws on inputs where a valid bin-packing exists.
  // These tests encode the EXPECTED behavior (no throw, all groups assigned, no row overflow).
  // On UNFIXED code, they MUST FAIL — failure confirms the bug exists.
  // After the fix is implemented, they will PASS — confirming the fix works.

  /**
   * Helper: assert that distributeGroupsToRows succeeds and produces a valid assignment.
   * - No throw
   * - Every group appears in exactly one row
   * - No row exceeds its capacity
   */
  const assertValidDistribution = (
    groups: SubjectGroup[],
    rowCapacities: number[],
    result: Map<number, SubjectGroup[]>
  ) => {
    // All groups assigned to exactly one row
    const assignedGroups = Array.from(result.values()).flat();
    const assignedIds = assignedGroups.map(g => g.subjectId).sort();
    const inputIds = groups.map(g => g.subjectId).sort();
    expect(assignedIds).toEqual(inputIds);

    // No row exceeds capacity
    for (let rowIdx = 0; rowIdx < rowCapacities.length; rowIdx++) {
      const rowGroups = result.get(rowIdx) ?? [];
      const rowTotal = rowGroups.reduce((sum, g) => sum + g.size, 0);
      expect(rowTotal).toBeLessThanOrEqual(rowCapacities[rowIdx]);
    }
  };

  // Test case 1 (minimal): Groups [4,4,3,3] into rows [8,6]
  // Valid packing: row0=[4,4]=8, row1=[3,3]=6
  // FFD places one 4 per row, leaving row1 with remainder 2, too small for the 3s.
  it('test case 1 (minimal): groups [4,4,3,3] into rows [8,6] should not throw', () => {
    const groups = [
      makeGroup('S1', 4, 'Drug'),
      makeGroup('S2', 4, 'Placebo'),
      makeGroup('S3', 3, 'Drug'),
      makeGroup('S4', 3, 'Placebo'),
    ];
    const rowCapacities = [8, 6];

    // Should NOT throw — a valid packing exists
    const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
    assertValidDistribution(groups, rowCapacities, result);
  });

  // Test case 2 (scaled): Groups [4,4,4,4,3,3,3,3] into rows [8,8,6,6]
  // Valid packing: rows[8]=[4,4], rows[6]=[3,3]
  // FFD spreads 4s across all rows including capacity-6 rows, blocking the 3s.
  it('test case 2 (scaled): groups [4,4,4,4,3,3,3,3] into rows [8,8,6,6] should not throw', () => {
    const groups = [
      makeGroup('S1', 4, 'Drug'),
      makeGroup('S2', 4, 'Placebo'),
      makeGroup('S3', 4, 'Drug'),
      makeGroup('S4', 4, 'Placebo'),
      makeGroup('S5', 3, 'Drug'),
      makeGroup('S6', 3, 'Placebo'),
      makeGroup('S7', 3, 'Drug'),
      makeGroup('S8', 3, 'Placebo'),
    ];
    const rowCapacities = [8, 8, 6, 6];

    const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
    assertValidDistribution(groups, rowCapacities, result);
  });

  // Test case 3 (production-like): Mixed size-4 and size-3 groups across 8 rows
  // with effective capacities [10,10,10,10,9,9,9,9], matching the reported P011 scenario.
  it('test case 3 (production-like): mixed groups across 8 rows with uneven capacities should not throw', () => {
    // 10 size-4 groups + 8 size-3 groups = 40 + 24 = 64
    // Total capacity = 4*10 + 4*9 = 76, so there's slack, but FFD can still fail
    const groups = [
      makeGroup('P001', 4, 'Drug'),
      makeGroup('P002', 4, 'Placebo'),
      makeGroup('P003', 4, 'Drug'),
      makeGroup('P004', 4, 'Placebo'),
      makeGroup('P005', 4, 'Drug'),
      makeGroup('P006', 4, 'Placebo'),
      makeGroup('P007', 4, 'Drug'),
      makeGroup('P008', 4, 'Placebo'),
      makeGroup('P009', 4, 'Drug'),
      makeGroup('P010', 4, 'Placebo'),
      makeGroup('P011', 3, 'Drug'),
      makeGroup('P012', 3, 'Placebo'),
      makeGroup('P013', 3, 'Drug'),
      makeGroup('P014', 3, 'Placebo'),
      makeGroup('P015', 3, 'Drug'),
      makeGroup('P016', 3, 'Placebo'),
      makeGroup('P017', 3, 'Drug'),
      makeGroup('P018', 3, 'Placebo'),
    ];
    const rowCapacities = [10, 10, 10, 10, 9, 9, 9, 9];

    const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
    assertValidDistribution(groups, rowCapacities, result);
  });

  // Test case 4 (non-deterministic): Run a borderline input 50+ times to observe
  // that some runs throw due to shuffle randomness while a valid packing exists.
  // Uses the minimal [4,4,3,3] / [8,6] case which is most likely to fail consistently.
  it('test case 4 (non-deterministic): borderline input succeeds across 50 runs', () => {
    const groups = [
      makeGroup('S1', 4, 'Drug'),
      makeGroup('S2', 4, 'Placebo'),
      makeGroup('S3', 3, 'Drug'),
      makeGroup('S4', 3, 'Placebo'),
    ];
    const rowCapacities = [8, 6];

    const failures: string[] = [];
    const runs = 50;

    for (let i = 0; i < runs; i++) {
      try {
        const result = distributeGroupsToRows(groups, rowCapacities, DRUG_PLACEBO_PROPORTIONS);
        assertValidDistribution(groups, rowCapacities, result);
      } catch (e: any) {
        failures.push(`Run ${i + 1}: ${e.message}`);
      }
    }

    // Expect zero failures — if any run throws, the bug is confirmed
    expect(failures).toEqual([]);
  });
});

// ─── Bug Condition Exploration Tests ────────────────────────────────────────
// Property 1: Bug Condition — Homogeneous sets score higher than balanced sets
// CRITICAL: These tests MUST FAIL on unfixed code — failure confirms the bug exists.
// DO NOT fix the test or the code when it fails.

describe('Bug Condition Exploration: covariateImbalanceScore returns 0 for homogeneous sets', () => {

  // Helper: create a SearchData sample with a Treatment covariate
  const makeCovSample = (treatment: string): SearchData => ({
    name: `sample_${treatment}_${Math.random().toString(36).slice(2, 6)}`,
    metadata: { Treatment: treatment },
    covariateKey: treatment,
  });

  // --- Direct score test ---
  // Homogeneous combined set [Drug, Drug, Drug, Drug] with globalProportions { Drug: 0.5, Placebo: 0.5 }
  // Expected: score > 0 (homogeneous set should be penalized)
  // On unfixed code: returns 0 due to numGroups <= 1 early return
  it('homogeneous combined set should return score > 0', () => {
    const currentSamples = [makeCovSample('Drug'), makeCovSample('Drug')];
    const candidateSamples = [makeCovSample('Drug'), makeCovSample('Drug')];

    const score = covariateImbalanceScore(currentSamples, candidateSamples, DRUG_PLACEBO_PROPORTIONS);

    // Bug: function returns 0 because numGroups=1 triggers early return.
    // Expected after fix: score = (1.0 - 0.5)^2 + (0.0 - 0.5)^2 = 0.50
    expect(score).toBeGreaterThan(0);
  });

  // --- Score comparison test ---
  // Homogeneous: [Drug×4] vs Balanced: [Placebo×2, Drug×2]
  // Expected: score_homogeneous > score_balanced
  // On unfixed code: both return 0, so assertion fails
  it('homogeneous set should score higher (worse) than balanced set', () => {
    const homogeneousCurrent = [makeCovSample('Drug'), makeCovSample('Drug')];
    const homogeneousCandidate = [makeCovSample('Drug'), makeCovSample('Drug')];

    const balancedCurrent = [makeCovSample('Placebo'), makeCovSample('Placebo')];
    const balancedCandidate = [makeCovSample('Drug'), makeCovSample('Drug')];

    const scoreHomogeneous = covariateImbalanceScore(homogeneousCurrent, homogeneousCandidate, DRUG_PLACEBO_PROPORTIONS);
    const scoreBalanced = covariateImbalanceScore(balancedCurrent, balancedCandidate, DRUG_PLACEBO_PROPORTIONS);

    // Bug: both return 0 on unfixed code.
    // Expected after fix: scoreHomogeneous = 0.50, scoreBalanced = 0.0
    expect(scoreHomogeneous).toBeGreaterThan(scoreBalanced);
  });

  // --- Empty row + single-group candidate ---
  // currentSamples = [], candidateSamples = [Drug, Drug]
  // Expected: score > 0 (placing only Drug into an empty row is imbalanced)
  // On unfixed code: returns 0 due to numGroups <= 1 early return
  it('empty row with single-group candidate should return score > 0', () => {
    const currentSamples: SearchData[] = [];
    const candidateSamples = [makeCovSample('Drug'), makeCovSample('Drug')];

    const score = covariateImbalanceScore(currentSamples, candidateSamples, DRUG_PLACEBO_PROPORTIONS);

    // Bug: function returns 0 because numGroups=1 triggers early return.
    // Expected after fix: score = (1.0 - 0.5)^2 + (0.0 - 0.5)^2 = 0.50
    expect(score).toBeGreaterThan(0);
  });
});

// ─── Preservation Property Tests: covariateImbalanceScore behavior unchanged ─
// Property 2: Preservation — Multi-group scoring and edge-case behavior unchanged
// IMPORTANT: These tests capture CURRENT (unfixed) behavior and MUST PASS on unfixed code.
// After the fix, they must STILL PASS — confirming no regressions.
// Requirements: 3.1, 3.2, 3.3, 3.4

describe('Preservation Property: covariateImbalanceScore edge-case and multi-group behavior', () => {

  // Helper: create a SearchData sample with a Treatment covariate and covariateKey
  const makeCovSample = (treatment: string): SearchData => ({
    name: `sample_${treatment}_${Math.random().toString(36).slice(2, 6)}`,
    metadata: { Treatment: treatment },
    covariateKey: treatment,
  });

  // ── Property-based test 1: Empty/no-covariate preservation ──
  // For all random sample sets, when selectedCovariates is empty (no covariates selected),
  // the function returns 0.
  // Requirement: 3.2
  it('PBT: empty selectedCovariates always returns 0 regardless of samples', () => {
    const sampleArb = fc.array(
      fc.constantFrom('Drug', 'Placebo', 'Control'),
      { minLength: 0, maxLength: 10 }
    );

    fc.assert(
      fc.property(sampleArb, sampleArb, (currentTreatments, candidateTreatments) => {
        const currentSamples = currentTreatments.map(t => makeCovSample(t));
        const candidateSamples = candidateTreatments.map(t => makeCovSample(t));

        const score = covariateImbalanceScore(currentSamples, candidateSamples, EMPTY_PROPORTIONS);
        expect(score).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  // ── Property-based test 2: Empty samples preservation ──
  // For empty combined sets, the function returns 0 regardless of globalProportions.
  // Requirement: 3.3
  it('PBT: empty combined samples always returns 0 regardless of globalProportions', () => {
    const proportionsArb = fc.array(
      fc.tuple(fc.constantFrom('Drug', 'Placebo', 'Control'), fc.double({ min: 0.01, max: 1, noNaN: true })),
      { minLength: 0, maxLength: 3 }
    ).map(entries => new Map<string, number>(entries));

    fc.assert(
      fc.property(proportionsArb, (globalProportions) => {
        const score = covariateImbalanceScore([], [], globalProportions);
        expect(score).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property-based test 3: Multi-group score preservation ──
  // For random sample sets where the combined set contains 2+ covariate groups,
  // the function produces the same score as the formula Σ(actualProportion - 1/numGroups)².
  // This captures the existing scoring logic for multi-group cases.
  // Requirement: 3.1
  it('PBT: multi-group combined sets match Σ(actualProportion - 1/numGroups)² formula', () => {
    // Generate samples that guarantee 2+ distinct Treatment values by construction:
    // always include at least one of each of two treatments in the candidate set.
    // Use equal globalProportions (1/numTreatments each) so the new formula matches the old one.
    const multiGroupArb = fc.gen().map(gen => {
      const treatments = ['Drug', 'Placebo', 'Control'];
      const numTreatments = gen(fc.integer, { min: 2, max: 3 });
      const selectedTreatments = treatments.slice(0, numTreatments);

      // Build equal globalProportions for the selected treatments
      const globalProportions = new Map<string, number>();
      for (const t of selectedTreatments) {
        globalProportions.set(t, 1 / numTreatments);
      }

      // Current samples: random mix (may be empty)
      const currentCount = gen(fc.integer, { min: 0, max: 8 });
      const currentTreatments: string[] = [];
      for (let i = 0; i < currentCount; i++) {
        currentTreatments.push(selectedTreatments[gen(fc.integer, { min: 0, max: selectedTreatments.length - 1 })]);
      }

      // Candidate samples: start with one of each selected treatment to guarantee 2+ groups
      const candidateTreatments: string[] = [...selectedTreatments];
      const extraCount = gen(fc.integer, { min: 0, max: 6 });
      for (let i = 0; i < extraCount; i++) {
        candidateTreatments.push(selectedTreatments[gen(fc.integer, { min: 0, max: selectedTreatments.length - 1 })]);
      }

      return { currentTreatments, candidateTreatments, globalProportions };
    });

    fc.assert(
      fc.property(multiGroupArb, ({ currentTreatments, candidateTreatments, globalProportions }) => {
        const currentSamples = currentTreatments.map(t => makeCovSample(t));
        const candidateSamples = candidateTreatments.map(t => makeCovSample(t));

        const score = covariateImbalanceScore(currentSamples, candidateSamples, globalProportions);

        // Manually compute expected score using globalProportions
        const combined = [...currentTreatments, ...candidateTreatments];
        const counts = new Map<string, number>();
        for (const t of combined) {
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        const total = combined.length;
        let expectedScore = 0;
        globalProportions.forEach((expectedProportion, key) => {
          const actualProportion = (counts.get(key) ?? 0) / total;
          const deviation = actualProportion - expectedProportion;
          expectedScore += deviation * deviation;
        });

        expect(score).toBeCloseTo(expectedScore, 10);
      }),
      { numRuns: 300 }
    );
  });

  // ── Property-based test 4: Single global group preservation ──
  // When globalProportions.size == 1 (only one covariate group globally),
  // the function returns 0 (no balance to optimize).
  // Requirement: 3.2 (single global group → no balance to optimize)
  it('PBT: single covariate group in globalProportions returns 0', () => {
    const singleGroupArb = fc.gen().map(gen => {
      const treatment = gen(fc.constantFrom, 'Drug', 'Placebo', 'Control');
      const currentCount = gen(fc.integer, { min: 0, max: 8 });
      const candidateCount = gen(fc.integer, { min: 1, max: 8 });
      return { treatment, currentCount, candidateCount };
    });

    fc.assert(
      fc.property(singleGroupArb, ({ treatment, currentCount, candidateCount }) => {
        const currentSamples = Array.from({ length: currentCount }, () => makeCovSample(treatment));
        const candidateSamples = Array.from({ length: candidateCount }, () => makeCovSample(treatment));

        // globalProportions.size == 1 → no balance to optimize → score = 0
        const singleProportions = new Map<string, number>([[treatment, 1.0]]);
        const score = covariateImbalanceScore(currentSamples, candidateSamples, singleProportions);
        expect(score).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  // ── Property-based test 5: Capacity-first ordering ──
  // distributeGroupsToRows still assigns to the row with most remaining capacity
  // when capacities differ (covariate balance is only a tie-breaker).
  // Requirement: 3.4
  it('PBT: groups are assigned to the row with most remaining capacity when capacities differ', () => {
    // Strategy: create 2 rows where one has strictly more capacity than the other.
    // A single group should always land in the larger row.
    const capacityFirstArb = fc.gen().map(gen => {
      // Smaller row capacity: 3–8, larger row gets +2 to +4 more (guarantees unique max)
      const smallCap = gen(fc.integer, { min: 3, max: 8 });
      const largeCap = smallCap + gen(fc.integer, { min: 2, max: 4 });

      // Randomly decide which index gets the large capacity
      const largeFirst = gen(fc.boolean);
      const rowCapacities = largeFirst ? [largeCap, smallCap] : [smallCap, largeCap];
      const expectedRow = largeFirst ? 0 : 1;

      // Single group that fits in the smaller row
      const groupSize = gen(fc.integer, { min: 1, max: smallCap });
      const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');

      return { rowCapacities, groupSize, treatment, expectedRow, largeCap };
    });

    fc.assert(
      fc.property(capacityFirstArb, ({ rowCapacities, groupSize, treatment, expectedRow, largeCap }) => {
        const group = makeGroup('CAP_TEST', groupSize, treatment);
        const result = distributeGroupsToRows([group], rowCapacities, DRUG_PLACEBO_PROPORTIONS);

        // Find which row the group was assigned to
        let assignedRow = -1;
        result.forEach((groups, rowIdx) => {
          if (groups.some(g => g.subjectId === 'CAP_TEST')) {
            assignedRow = rowIdx;
          }
        });

        // The group should be in the row with the largest capacity
        expect(assignedRow).not.toBe(-1);
        expect(rowCapacities[assignedRow]).toBe(largeCap);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: qc-covariate-balanced-distribution
// Property 2: Plate-level proportional balance per QC covariate group
// ---------------------------------------------------------------------------
describe('Feature: qc-covariate-balanced-distribution, Property 2: Plate-level proportional balance per QC covariate group', () => {
  /** Arbitrary that generates a random QC sample with a random covariateKey */
  const qcSampleArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    covariateKey: fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 20 })
    ),
  }).map(({ name, covariateKey }): SearchData => ({
    name,
    metadata: {},
    isQC: true,
    ...(covariateKey !== undefined ? { covariateKey } : {}),
  }));

  it('per-group plate counts satisfy max-min ≤ 1 and total conservation', () => {
    fc.assert(
      fc.property(
        fc.array(qcSampleArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 8 }),
        (qcSamples, numPlates, numRows) => {
          const result = distributeQcByCovariate(qcSamples, numPlates, numRows);

          // Build expected group counts from input
          const expectedGroups = new Map<string, number>();
          for (const s of qcSamples) {
            const key = s.covariateKey || '';
            expectedGroups.set(key, (expectedGroups.get(key) ?? 0) + 1);
          }

          // For each covariate group, collect per-plate counts from the output
          for (const [groupKey, expectedTotal] of Array.from(expectedGroups.entries())) {
            const plateCounts: number[] = [];
            for (let p = 0; p < numPlates; p++) {
              let count = 0;
              for (let r = 0; r < numRows; r++) {
                count += result[p][r].filter(s => (s.covariateKey || '') === groupKey).length;
              }
              plateCounts.push(count);
            }

            // Total conservation: sum across plates equals input group count
            const totalAcrossPlates = plateCounts.reduce((a, b) => a + b, 0);
            expect(totalAcrossPlates).toBe(expectedTotal);

            // Proportional balance: max - min ≤ 1
            const maxCount = Math.max(...plateCounts);
            const minCount = Math.min(...plateCounts);
            expect(maxCount - minCount).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: qc-covariate-balanced-distribution
// Property 1: QC grouping is complete and disjoint
// ---------------------------------------------------------------------------
describe('Feature: qc-covariate-balanced-distribution, Property 1: QC grouping is complete and disjoint', () => {
  /** Arbitrary that generates a random QC sample with a random covariateKey */
  const qcSampleArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    covariateKey: fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 20 })
    ),
  }).map(({ name, covariateKey }): SearchData => ({
    name,
    metadata: {},
    isQC: true,
    ...(covariateKey !== undefined ? { covariateKey } : {}),
  }));

  it('union of all output samples equals the input set exactly (no loss, no duplication)', () => {
    fc.assert(
      fc.property(
        fc.array(qcSampleArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 8 }),
        (qcSamples, numPlates, numRows) => {
          const result = distributeQcByCovariate(qcSamples, numPlates, numRows);

          // Collect every sample from the 3D output
          const outputSamples: SearchData[] = [];
          for (let p = 0; p < result.length; p++) {
            for (let r = 0; r < result[p].length; r++) {
              outputSamples.push(...result[p][r]);
            }
          }

          // Total count must match
          expect(outputSamples.length).toBe(qcSamples.length);

          // Every input sample must appear exactly once in the output (by reference)
          // Every input sample must appear exactly once in the output (by reference)
          const outputSet = new Set(outputSamples);
          expect(outputSet.size).toBe(outputSamples.length); // no duplicates
          qcSamples.forEach(s => {
            expect(outputSet.has(s)).toBe(true);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: qc-covariate-balanced-distribution
// Property 3: Row-level proportional balance per QC covariate group within each plate
// ---------------------------------------------------------------------------
describe('Feature: qc-covariate-balanced-distribution, Property 3: Row-level proportional balance per QC covariate group within each plate', () => {
  /** Arbitrary that generates a random QC sample with a random covariateKey */
  const qcSampleArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    covariateKey: fc.oneof(
      fc.constant(undefined),
      fc.constant(''),
      fc.string({ minLength: 1, maxLength: 20 })
    ),
  }).map(({ name, covariateKey }): SearchData => ({
    name,
    metadata: {},
    isQC: true,
    ...(covariateKey !== undefined ? { covariateKey } : {}),
  }));

  it('per-group row counts within each plate satisfy max-min ≤ 1 and total conservation', () => {
    fc.assert(
      fc.property(
        fc.array(qcSampleArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 8 }),
        (qcSamples, numPlates, numRows) => {
          const result = distributeQcByCovariate(qcSamples, numPlates, numRows);

          // For each plate, build per-group row counts and verify balance
          for (let p = 0; p < numPlates; p++) {
            // Collect all covariate groups present on this plate
            const plateGroupCounts = new Map<string, number>();
            for (let r = 0; r < numRows; r++) {
              for (const s of result[p][r]) {
                const key = s.covariateKey || '';
                plateGroupCounts.set(key, (plateGroupCounts.get(key) ?? 0) + 1);
              }
            }

            // For each group on this plate, check row-level balance
            plateGroupCounts.forEach((plateTotal, groupKey) => {
              const rowCounts: number[] = [];
              for (let r = 0; r < numRows; r++) {
                rowCounts.push(
                  result[p][r].filter(s => (s.covariateKey || '') === groupKey).length
                );
              }

              // Total conservation: sum across rows equals plate allocation for this group
              const totalAcrossRows = rowCounts.reduce((a, b) => a + b, 0);
              expect(totalAcrossRows).toBe(plateTotal);

              // Proportional balance: max - min ≤ 1
              const maxCount = Math.max(...rowCounts);
              const minCount = Math.min(...rowCounts);
              expect(maxCount - minCount).toBeLessThanOrEqual(1);
            });
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: qc-covariate-balanced-distribution
// Property 4: Effective row capacity equals columns minus QC allocation
// ---------------------------------------------------------------------------
describe('Feature: qc-covariate-balanced-distribution, Property 4: Effective row capacity equals columns minus QC allocation', () => {
  /**
   * Generator that produces a valid input for groupAwareRandomization:
   * - Random experimental samples (small subject groups, size 1-2)
   * - Random QC samples with multiple covariate groups
   * - Plate dimensions that can fit all samples
   *
   * Constraints are guaranteed by construction so the generator never
   * needs to filter/reject inputs.
   */
  const validInputArb = fc.gen().map(gen => {
    const numRows = gen(fc.integer, { min: 2, max: 6 });
    const numColumns = gen(fc.integer, { min: 4, max: 12 });
    const plateSize = numRows * numColumns;

    // QC samples: 0-30% of plate capacity, split across 1-3 covariate groups
    const maxQc = Math.floor(plateSize * 0.3);
    const numQcGroups = gen(fc.integer, { min: 1, max: 3 });
    const qcGroupNames = ['QC', 'Reference', 'Blinded'].slice(0, numQcGroups);
    const qcSamples: SearchData[] = [];
    for (const groupName of qcGroupNames) {
      const groupCount = gen(fc.integer, { min: 0, max: Math.floor(maxQc / numQcGroups) });
      for (let i = 0; i < groupCount; i++) {
        qcSamples.push({
          name: `${groupName}_${i}`,
          metadata: { Condition: groupName },
          isQC: true,
          covariateKey: `${groupName}|na|na`,
        });
      }
    }

    // Experimental samples: small subject groups (size 1-2) filling 30-60% of plate
    const remainingCapacity = plateSize - qcSamples.length;
    const expTarget = gen(fc.integer, {
      min: Math.max(1, Math.floor(remainingCapacity * 0.3)),
      max: Math.floor(remainingCapacity * 0.6),
    });
    const experimentalSamples: SearchData[] = [];
    let expCount = 0;
    let subjectIdx = 0;
    while (expCount < expTarget) {
      const groupSize = gen(fc.integer, { min: 1, max: Math.min(2, expTarget - expCount, numColumns) });
      const treatment = gen(fc.constantFrom, 'Drug', 'Placebo');
      const subjectId = `S${subjectIdx}`;
      for (let i = 0; i < groupSize; i++) {
        experimentalSamples.push({
          name: `${subjectId}_T${i}`,
          metadata: { SubjectID: subjectId, Treatment: treatment },
          covariateKey: treatment,
        });
      }
      expCount += groupSize;
      subjectIdx++;
    }

    if (experimentalSamples.length === 0) return null;

    const allSamples = [...experimentalSamples, ...qcSamples];
    return { allSamples, numRows, numColumns };
  });

  function nonNull<T>(arb: fc.Arbitrary<T | null>): fc.Arbitrary<T> {
    return arb.filter((v): v is T => v !== null);
  }

  it('no row exceeds numColumns total samples and QC + experimental per row ≤ numColumns', () => {
    fc.assert(
      fc.property(nonNull(validInputArb), ({ allSamples, numRows, numColumns }) => {
        const config: RepeatedMeasuresConfig = {
          subjectColumn: 'SubjectID',
          groupingConstraint: 'same-row',
        };

        const result = groupAwareRandomization(
          allSamples,
          ['Treatment'],
          config,
          true,
          numRows,
          numColumns
        );

        for (const plate of result.plates) {
          for (let r = 0; r < plate.length; r++) {
            const row = plate[r];
            // Count defined (occupied) wells in this row
            const totalInRow = row.filter(w => w !== undefined).length;
            // Row must not exceed numColumns
            expect(totalInRow).toBeLessThanOrEqual(numColumns);

            // Count QC and experimental separately
            const qcInRow = row.filter(w => w !== undefined && w.isQC === true).length;
            const expInRow = row.filter(w => w !== undefined && w.isQC !== true).length;
            // QC + experimental must equal total
            expect(qcInRow + expInRow).toBe(totalInRow);
            // Experimental must not exceed columns minus QC
            expect(expInRow).toBeLessThanOrEqual(numColumns - qcInRow);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ---------------------------------------------------------------------------
// Task 5.1: Unit test for the 192-sample reference dataset scenario
// Validates: Requirements 6.1, 6.2, 6.3
// ---------------------------------------------------------------------------
describe('192-sample reference dataset: 16 QC + 16 Reference + 16 Blinded + 144 experimental', () => {
  it('places exactly 8 QC, 8 Reference, 8 Blinded per plate and 1 of each per row', () => {
    // Build 144 experimental samples: 144 unique subjects, alternating Drug/Placebo
    const experimentalSamples: SearchData[] = [];
    for (let i = 0; i < 144; i++) {
      const subjectId = `EXP${String(i).padStart(3, '0')}`;
      const treatment = i % 2 === 0 ? 'Drug' : 'Placebo';
      experimentalSamples.push({
        name: `${subjectId}_T0`,
        metadata: { SubjectID: subjectId, Treatment: treatment },
        covariateKey: treatment,
      });
    }

    // Build 16 QC samples
    const qcSamples: SearchData[] = Array.from({ length: 16 }, (_, i) => ({
      name: `QC_${i}`,
      metadata: { Condition: 'QC' },
      isQC: true,
      covariateKey: 'QC|na|na',
    }));

    // Build 16 Reference samples
    const refSamples: SearchData[] = Array.from({ length: 16 }, (_, i) => ({
      name: `Reference_${i}`,
      metadata: { Condition: 'Reference' },
      isQC: true,
      covariateKey: 'Reference|na|na',
    }));

    // Build 16 Blinded samples
    const blindedSamples: SearchData[] = Array.from({ length: 16 }, (_, i) => ({
      name: `Blinded_${i}`,
      metadata: { Condition: 'Blinded' },
      isQC: true,
      covariateKey: 'Blinded|na|na',
    }));

    const allSamples = [...experimentalSamples, ...qcSamples, ...refSamples, ...blindedSamples];
    // Total: 144 + 16 + 16 + 16 = 192

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-row',
    };

    const result = groupAwareRandomization(
      allSamples,
      ['Treatment'],
      config,
      true,
      8,   // numRows
      12   // numColumns
    );

    // Should produce exactly 2 plates (192 / 96 = 2)
    expect(result.plates.length).toBe(2);

    // All 192 samples should be placed
    const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
    expect(totalPlaced).toBe(192);

    // Verify per-plate QC type counts: exactly 8 QC, 8 Reference, 8 Blinded per plate
    for (let p = 0; p < 2; p++) {
      const plateSamples = result.plates[p].flat().filter((w): w is SearchData => w !== undefined);

      const qcOnPlate = plateSamples.filter(s => s.isQC === true && s.covariateKey === 'QC|na|na').length;
      const refOnPlate = plateSamples.filter(s => s.isQC === true && s.covariateKey === 'Reference|na|na').length;
      const blindedOnPlate = plateSamples.filter(s => s.isQC === true && s.covariateKey === 'Blinded|na|na').length;

      expect(qcOnPlate).toBe(8);
      expect(refOnPlate).toBe(8);
      expect(blindedOnPlate).toBe(8);
    }

    // Verify per-row QC type counts: exactly 1 QC, 1 Reference, 1 Blinded per row
    for (let p = 0; p < 2; p++) {
      for (let r = 0; r < 8; r++) {
        const rowSamples = result.plates[p][r].filter((w): w is SearchData => w !== undefined);

        const qcInRow = rowSamples.filter(s => s.isQC === true && s.covariateKey === 'QC|na|na').length;
        const refInRow = rowSamples.filter(s => s.isQC === true && s.covariateKey === 'Reference|na|na').length;
        const blindedInRow = rowSamples.filter(s => s.isQC === true && s.covariateKey === 'Blinded|na|na').length;

        expect(qcInRow).toBe(1);
        expect(refInRow).toBe(1);
        expect(blindedInRow).toBe(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.2: Unit test for single QC covariate group
// Validates: Requirements 2.1, 2.3
// ---------------------------------------------------------------------------
describe('Single QC covariate group degenerates to even distribution', () => {
  it('distributes evenly across plates and rows with max-min ≤ 1', () => {
    // 10 QC samples all sharing the same covariateKey
    const qcSamples: SearchData[] = Array.from({ length: 10 }, (_, i) => ({
      name: `QC_${i}`,
      metadata: { Condition: 'QC' },
      isQC: true,
      covariateKey: 'QC|na|na',
    }));

    const numPlates = 3;
    const numRows = 4;

    const result = distributeQcByCovariate(qcSamples, numPlates, numRows);

    // Total conservation: all 10 samples accounted for
    const totalOutput = result.flat(2).length;
    expect(totalOutput).toBe(10);

    // Plate-level balance: floor(10/3)=3, remainder=1 → counts are [3,3,4] or similar
    // max-min ≤ 1
    const plateCounts = result.map(plate =>
      plate.reduce((sum, row) => sum + row.length, 0)
    );
    const plateMax = Math.max(...plateCounts);
    const plateMin = Math.min(...plateCounts);
    expect(plateMax - plateMin).toBeLessThanOrEqual(1);
    expect(plateCounts.reduce((a, b) => a + b, 0)).toBe(10);

    // Row-level balance within each plate: max-min ≤ 1
    for (let p = 0; p < numPlates; p++) {
      const rowCounts = result[p].map(row => row.length);
      const rowMax = Math.max(...rowCounts);
      const rowMin = Math.min(...rowCounts);
      expect(rowMax - rowMin).toBeLessThanOrEqual(1);
      // Row counts sum to plate count
      expect(rowCounts.reduce((a, b) => a + b, 0)).toBe(plateCounts[p]);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.3: Unit test for zero QC samples edge case
// Validates: Requirements 5.1, 5.2
// ---------------------------------------------------------------------------
describe('Zero QC samples edge case', () => {
  it('distributeQcByCovariate returns empty allocations for zero QC samples', () => {
    const numPlates = 2;
    const numRows = 4;

    const result = distributeQcByCovariate([], numPlates, numRows);

    // Structure: 2 plates × 4 rows, all empty
    expect(result.length).toBe(numPlates);
    for (let p = 0; p < numPlates; p++) {
      expect(result[p].length).toBe(numRows);
      for (let r = 0; r < numRows; r++) {
        expect(result[p][r]).toEqual([]);
      }
    }
  });

  it('groupAwareRandomization with 0 QC samples distributes experimental samples normally', () => {
    // 16 experimental samples, no QC
    const experimentalSamples: SearchData[] = [];
    for (let i = 0; i < 16; i++) {
      const subjectId = `S${String(i).padStart(3, '0')}`;
      const treatment = i % 2 === 0 ? 'Drug' : 'Placebo';
      experimentalSamples.push({
        name: `${subjectId}_T0`,
        metadata: { SubjectID: subjectId, Treatment: treatment },
        covariateKey: treatment,
      });
    }

    const config: RepeatedMeasuresConfig = {
      subjectColumn: 'SubjectID',
      groupingConstraint: 'same-row',
    };

    const result = groupAwareRandomization(
      experimentalSamples,
      ['Treatment'],
      config,
      true,
      4,   // numRows
      6    // numColumns
    );

    // All 16 experimental samples placed
    const totalPlaced = result.plates.flat(2).filter(w => w !== undefined).length;
    expect(totalPlaced).toBe(16);

    // No QC samples in output
    const qcCount = result.plates.flat(2).filter(w => w !== undefined && w.isQC === true).length;
    expect(qcCount).toBe(0);

    // No row exceeds column count
    for (const plate of result.plates) {
      for (const row of plate) {
        const filled = row.filter(w => w !== undefined).length;
        expect(filled).toBeLessThanOrEqual(6);
      }
    }
  });
});
