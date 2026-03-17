import * as fc from 'fast-check';
import { buildSubjectGroups, validateSubjectGroups } from '../algorithms/repeatedMeasuresDistribution';
import { SearchData } from '../utils/types';

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
