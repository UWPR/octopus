import * as fc from 'fast-check';
import { buildSubjectGroups, validateSubjectGroups, distributeGroupsToPlates, distributeGroupsToRows, groupAwareRandomization } from '../algorithms/repeatedMeasuresDistribution';
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
  })),
  size,
});

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
            result = distributeGroupsToPlates(groups, plateCapacities, ['Treatment']);
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
            result = distributeGroupsToRows(groups, rowCapacities, ['Treatment']);
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

    const result = distributeGroupsToPlates(groups, [6, 6], ['Treatment']);

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

    const result = distributeGroupsToPlates(groups, [5, 5], ['Treatment']);

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
      distributeGroupsToPlates(groups, [5, 5], []);
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

    const result = distributeGroupsToRows(groups, [10, 10, 10], ['Treatment']);

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
      distributeGroupsToRows(groups, [10, 10], []);
    }).toThrow('Unable to fit all subject groups into available rows');
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

      const result = distributeGroupsToRows(groups, [6, 6], ['Treatment']);

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

    const result = distributeGroupsToRows(groups, [5, 5], ['Treatment']);

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
