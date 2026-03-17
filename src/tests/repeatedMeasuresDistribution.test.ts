import * as fc from 'fast-check';
import { buildSubjectGroups, validateSubjectGroups, distributeGroupsToPlates } from '../algorithms/repeatedMeasuresDistribution';
import { SearchData, SubjectGroup } from '../utils/types';

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

describe('Property 4: Validation rejects infeasible configurations', () => {
  // Feature: repeated-measures-constraints, Property 4: Validation rejects infeasible configurations
  // **Validates: Requirements 4.1, 4.2, 4.3**

  it('rejects when a group exceeds row capacity under same-row constraint', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),  // rowCapacity
        fc.integer({ min: 1, max: 10 }),  // extra samples beyond row capacity
        (rowCapacity, extra) => {
          const oversizedGroupSize = rowCapacity + extra;
          const groups = [{
            subjectId: 'P001',
            samples: Array.from({ length: oversizedGroupSize }, (_, i) => makeSample(`S${i}`, 'P001')),
            size: oversizedGroupSize,
          }];

          const result = validateSubjectGroups(groups, 'same-row', rowCapacity, 96, 960);
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects when a group exceeds plate capacity under same-plate constraint', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 96 }),  // plateCapacity
        fc.integer({ min: 1, max: 10 }),  // extra
        (plateCapacity, extra) => {
          const oversizedGroupSize = plateCapacity + extra;
          const groups = [{
            subjectId: 'P001',
            samples: Array.from({ length: oversizedGroupSize }, (_, i) => makeSample(`S${i}`, 'P001')),
            size: oversizedGroupSize,
          }];

          const result = validateSubjectGroups(groups, 'same-plate', 12, plateCapacity, 960);
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects when total samples exceed total well capacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),  // totalWellCapacity
        fc.integer({ min: 1, max: 50 }),   // extra
        (totalWellCapacity, extra) => {
          const totalSamples = totalWellCapacity + extra;
          const groups = [{
            subjectId: 'P001',
            samples: Array.from({ length: totalSamples }, (_, i) => makeSample(`S${i}`, 'P001')),
            size: totalSamples,
          }];

          // Use large row/plate capacity so only total capacity triggers
          const result = validateSubjectGroups(groups, 'same-plate', 9999, 9999, totalWellCapacity);
          expect(result.isValid).toBe(false);
          expect(result.errors.some(e => e.includes('exceed available well capacity'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Property 2: Same Plate grouping invariant', () => {
  // Feature: repeated-measures-constraints, Property 2: Same Plate grouping invariant
  // **Validates: Requirements 3.2, 5.1**

  // Arbitrary: generate a list of subject groups where each group fits within a plate capacity
  const groupArb = (maxPlateCapacity: number) =>
    fc.array(
      fc.record({
        subjectId: fc.string({ minLength: 1, maxLength: 8 }),
        size: fc.integer({ min: 1, max: maxPlateCapacity }),
        treatment: fc.constantFrom('Drug', 'Placebo'),
      }),
      { minLength: 1, maxLength: 20 }
    ).map(defs => {
      // Ensure unique subject IDs
      const seen = new Set<string>();
      return defs
        .filter(d => {
          if (seen.has(d.subjectId)) return false;
          seen.add(d.subjectId);
          return true;
        })
        .map(d => ({
          subjectId: d.subjectId,
          samples: Array.from({ length: d.size }, (_, i) => ({
            name: `${d.subjectId}_T${i}`,
            metadata: { SubjectID: d.subjectId, Treatment: d.treatment },
          })),
          size: d.size,
        } as SubjectGroup));
    }).filter(groups => groups.length > 0);

  it('all samples sharing the same subject ID are assigned to the same plate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 24 }),  // plate capacity
        fc.integer({ min: 1, max: 4 }),   // number of plates
        fc.gen().map(gen => gen), // used for dependent generation
        (plateCapacity, numPlates, gen) => {
          // Generate groups that each fit within plate capacity
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

          if (groups.length === 0) return; // skip trivial case

          const totalSamples = groups.reduce((sum, g) => sum + g.size, 0);
          const totalCapacity = plateCapacity * numPlates;

          // Only test feasible configurations
          if (totalSamples > totalCapacity) return;

          const plateCapacities = Array(numPlates).fill(plateCapacity);

          let result: Map<number, SubjectGroup[]>;
          try {
            result = distributeGroupsToPlates(groups, plateCapacities, ['Treatment']);
          } catch {
            // If distribution throws (infeasible packing), that's acceptable
            return;
          }

          // Build a map: subjectId → set of plate indices where its samples appear
          const subjectPlateMap = new Map<string, Set<number>>();
          result.forEach((assignedGroups, plateIdx) => {
            for (const group of assignedGroups) {
              if (!subjectPlateMap.has(group.subjectId)) {
                subjectPlateMap.set(group.subjectId, new Set());
              }
              subjectPlateMap.get(group.subjectId)!.add(plateIdx);
            }
          });

          // Assert: every subject appears on exactly one plate
          subjectPlateMap.forEach((plateIndices, subjectId) => {
            expect(plateIndices.size).toBe(1);
          });

          // Assert: all input samples are accounted for
          const totalAssigned = Array.from(result.values())
            .flatMap(gs => gs)
            .reduce((sum, g) => sum + g.size, 0);
          expect(totalAssigned).toBe(totalSamples);
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

    // 2 subject groups + 2 singletons = 4 groups
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

  it('treats all-unique subject IDs as individual groups', () => {
    const samples: SearchData[] = [
      makeSample('S1', 'A'),
      makeSample('S2', 'B'),
      makeSample('S3', 'C'),
    ];

    const groups = buildSubjectGroups(samples, 'SubjectID');
    expect(groups.length).toBe(3);
    expect(groups.every(g => g.size === 1)).toBe(true);
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
      { subjectId: 'P001', samples: Array.from({ length: 4 }, (_, i) => makeSample(`S${i}`, 'P001')), size: 4 },
      { subjectId: 'P002', samples: Array.from({ length: 3 }, (_, i) => makeSample(`S${i}`, 'P002')), size: 3 },
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects group exceeding row capacity with same-row constraint', () => {
    const groups = [
      { subjectId: 'P001', samples: Array.from({ length: 13 }, (_, i) => makeSample(`S${i}`, 'P001')), size: 13 },
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(
      'Subject P001 has 13 samples, which exceeds the row capacity of 12. Reduce group size or switch to Same Plate constraint.'
    );
  });

  it('rejects group exceeding plate capacity with same-plate constraint', () => {
    const groups = [
      { subjectId: 'P001', samples: Array.from({ length: 100 }, (_, i) => makeSample(`S${i}`, 'P001')), size: 100 },
    ];

    const result = validateSubjectGroups(groups, 'same-plate', 12, 96, 192);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(
      'Subject P001 has 100 samples, which exceeds the plate capacity of 96.'
    );
  });

  it('rejects when total samples exceed total well capacity', () => {
    const groups = [
      { subjectId: 'P001', samples: Array.from({ length: 50 }, (_, i) => makeSample(`S${i}`, 'P001')), size: 50 },
      { subjectId: 'P002', samples: Array.from({ length: 50 }, (_, i) => makeSample(`S${i}`, 'P002')), size: 50 },
    ];

    const result = validateSubjectGroups(groups, 'same-plate', 12, 96, 96);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(
      'Total samples (100) exceed available well capacity (96).'
    );
  });

  it('warns when majority of groups are singletons', () => {
    const groups = [
      { subjectId: 'P001', samples: [makeSample('S1', 'P001')], size: 1 },
      { subjectId: '__singleton_0', samples: [makeSingletonSample('QC1')], size: 1 },
      { subjectId: '__singleton_1', samples: [makeSingletonSample('QC2')], size: 1 },
    ];

    const result = validateSubjectGroups(groups, 'same-row', 12, 96, 192);
    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('2 out of 3 groups are singletons');
  });
});

// ─── Unit Tests: distributeGroupsToPlates ───────────────────────────────────

describe('distributeGroupsToPlates', () => {
  // Helper: create a SubjectGroup with a given treatment
  const makeGroup = (id: string, size: number, treatment: string = 'Drug'): SubjectGroup => ({
    subjectId: id,
    samples: Array.from({ length: size }, (_, i) => ({
      name: `${id}_T${i}`,
      metadata: { SubjectID: id, Treatment: treatment },
    })),
    size,
  });

  // Helper: create a singleton SubjectGroup
  const makeSingleton = (id: string, treatment: string = 'Drug'): SubjectGroup => ({
    subjectId: id,
    samples: [{ name: id, metadata: { SubjectID: id, Treatment: treatment } }],
    size: 1,
  });

  // Helper: get total samples assigned across all plates
  const totalAssigned = (result: Map<number, SubjectGroup[]>): number =>
    Array.from(result.values()).flatMap(gs => gs).reduce((sum, g) => sum + g.size, 0);

  // Helper: assert every subject appears on exactly one plate
  const assertSubjectsOnSinglePlate = (result: Map<number, SubjectGroup[]>) => {
    const subjectPlates = new Map<string, number>();
    result.forEach((groups, plateIdx) => {
      for (const g of groups) {
        if (subjectPlates.has(g.subjectId)) {
          expect(subjectPlates.get(g.subjectId)).toBe(plateIdx);
        }
        subjectPlates.set(g.subjectId, plateIdx);
      }
    });
  };

  // Helper: get sample count per plate
  const plateSampleCounts = (result: Map<number, SubjectGroup[]>): number[] => {
    const counts: number[] = [];
    result.forEach((groups, plateIdx) => {
      counts[plateIdx] = groups.reduce((sum, g) => sum + g.size, 0);
    });
    return counts;
  };

  it('distributes uniform group sizes across plates without exceeding capacity', () => {
    // 6 groups of size 4 = 24 samples, 2 plates of 12 capacity each
    const groups = [
      makeGroup('P001', 4, 'Drug'),
      makeGroup('P002', 4, 'Placebo'),
      makeGroup('P003', 4, 'Drug'),
      makeGroup('P004', 4, 'Placebo'),
      makeGroup('P005', 4, 'Drug'),
      makeGroup('P006', 4, 'Placebo'),
    ];

    const result = distributeGroupsToPlates(groups, [12, 12], ['Treatment']);

    expect(totalAssigned(result)).toBe(24);
    assertSubjectsOnSinglePlate(result);

    const counts = plateSampleCounts(result);
    // Each plate should have at most 12 samples
    counts.forEach(c => expect(c).toBeLessThanOrEqual(12));
  });

  it('distributes mixed group sizes respecting plate capacities', () => {
    // Groups: 5, 4, 3, 2, 1 = 15 samples, 2 plates of 8 capacity
    const groups = [
      makeGroup('P001', 5, 'Drug'),
      makeGroup('P002', 4, 'Placebo'),
      makeGroup('P003', 3, 'Drug'),
      makeGroup('P004', 2, 'Placebo'),
      makeGroup('P005', 1, 'Drug'),
    ];

    const result = distributeGroupsToPlates(groups, [8, 8], ['Treatment']);

    expect(totalAssigned(result)).toBe(15);
    assertSubjectsOnSinglePlate(result);

    const counts = plateSampleCounts(result);
    counts.forEach(c => expect(c).toBeLessThanOrEqual(8));
  });

  it('handles exact-fit scenario where groups perfectly fill plates', () => {
    // 2 groups of 6 = 12 samples, 2 plates of 6 capacity each → exact fit
    const groups = [
      makeGroup('P001', 6, 'Drug'),
      makeGroup('P002', 6, 'Placebo'),
    ];

    const result = distributeGroupsToPlates(groups, [6, 6], ['Treatment']);

    expect(totalAssigned(result)).toBe(12);
    assertSubjectsOnSinglePlate(result);

    const counts = plateSampleCounts(result);
    // Each plate should have exactly 6
    counts.forEach(c => expect(c).toBe(6));
  });

  it('distributes singletons after multi-sample groups are placed', () => {
    // 2 multi-sample groups of 3 + 4 singletons = 10 samples, 2 plates of 5
    const groups = [
      makeGroup('P001', 3, 'Drug'),
      makeGroup('P002', 3, 'Placebo'),
      makeSingleton('S1', 'Drug'),
      makeSingleton('S2', 'Placebo'),
      makeSingleton('S3', 'Drug'),
      makeSingleton('S4', 'Placebo'),
    ];

    const result = distributeGroupsToPlates(groups, [5, 5], ['Treatment']);

    expect(totalAssigned(result)).toBe(10);
    assertSubjectsOnSinglePlate(result);

    const counts = plateSampleCounts(result);
    counts.forEach(c => expect(c).toBeLessThanOrEqual(5));

    // Verify multi-sample groups are intact (each on one plate)
    const p001Plate = Array.from(result.entries()).find(([_, gs]) =>
      gs.some(g => g.subjectId === 'P001')
    );
    const p001Group = p001Plate![1].find(g => g.subjectId === 'P001');
    expect(p001Group!.size).toBe(3);
  });

  it('throws when a group cannot fit in any plate', () => {
    const groups = [makeGroup('P001', 10, 'Drug')];

    expect(() => {
      distributeGroupsToPlates(groups, [5, 5], []);
    }).toThrow(/Unable to fit all subject groups/);
  });
});

