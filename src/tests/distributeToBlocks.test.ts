import { distributeToBlocks, calculateExpectedMinimums } from '../algorithms/balancedRandomization';
import { SearchData, BlockType } from '../utils/types';
import { groupByCovariates, buildCovariateKey } from '../utils/utils';

describe('distributeToBlocks - Plate-Level Distribution', () => {
  // Helper function to create mock samples with specific covariate values
  const createSample = (name: string, gender: string, plate: string, treatment: string): SearchData => ({
    name,
    metadata: { Gender: gender, Plate: plate, Treatment: treatment },
    covariateKey: `${gender}|${plate}|${treatment}` // Add treatmentKey for tests
  });

  // Helper function to count samples per covariate group in result
  const countSamplesPerGroup = (result: Map<number, SearchData[]>, selectedCovariates: string[]): Map<string, Map<number, number>> => {
    const groupCounts = new Map<string, Map<number, number>>();

    result.forEach((samples, blockIndex) => {
      samples.forEach(sample => {
        const groupKey = buildCovariateKey(sample, { selectedCovariates } );
        if (!groupCounts.has(groupKey)) {
          groupCounts.set(groupKey, new Map());
        }
        if (!groupCounts.get(groupKey)!.has(blockIndex)) {
          groupCounts.get(groupKey)!.set(blockIndex, 0);
        }
        groupCounts.get(groupKey)!.set(blockIndex, groupCounts.get(groupKey)!.get(blockIndex)! + 1);
      });
    });

    return groupCounts;
  };

   test('Should distribute covariate groups proportionally across multiple plates (exact counts)', () => {
    // Create 40 samples with 9 covariate groups
    const samples: SearchData[] = [];

    // Group 1: Control (8 samples)
    // Group 2: Female_P1_Blinded (4 samples)
    // Group 3: Male_P1_Blinded (4 samples)
    // Group 4: Female_P1_XRay (4 samples)
    // Group 5: Male_P1_XRay (4 samples)
    // Group 6: Female_P2_Blinded (4 samples)
    // Group 7: Male_P2_Blinded (4 samples)
    // Group 8: Female_P2_XRay (4 samples)
    // Group 9: Male_P2_XRay (4 samples)

    // Group 1: Control
    for (let i = 1; i <= 8; i++) {
      samples.push(createSample(`C_${i}`, '', '', 'Control'));
    }

    // Groups 2-9: All combinations of Gender, Plate, and Treatment (4 samples each)
    const genders = ['Male', 'Female'];
    const plates = ['P_1', 'P_2'];
    const treatments = ['Blinded', 'X-Ray'];

    genders.forEach(gender => {
      plates.forEach(plate => {
        treatments.forEach(treatment => {
          for (let i = 1; i <= 4; i++) {
            const shortGender = gender.charAt(0);
            const shortPlate = plate.replace('_', '');
            const shortTreatment = treatment.charAt(0);
            samples.push(createSample(`${shortGender}_${shortPlate}_${shortTreatment}_${i}`, gender, plate, treatment));
          }
        });
      });
    });


    const selectedCovariates = ['Gender', 'Plate', 'Treatment'];
    const covariateGroups = groupByCovariates(samples, selectedCovariates);
    expect(covariateGroups.size).toBe(9);

    // Create 2 plates with capacity 20 each
    const blockCapacities = [20, 20];

    const maxCapacity = 20;
    const blockType = BlockType.PLATE;
    const expectedMinimums = calculateExpectedMinimums(blockCapacities, covariateGroups, maxCapacity, blockType);

    const result = distributeToBlocks(
      covariateGroups,
      blockCapacities,
      maxCapacity,
      selectedCovariates,
      blockType,
      expectedMinimums
    );

    // Verify all plates are created
    expect(result.size).toBe(2);
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(true);

    // Verify total sample count (8 Control + 8 covariate groups × 4 samples = 40 total)
    let totalSamples = 0;
    result.forEach(samples => {
      totalSamples += samples.length;
    });
    expect(totalSamples).toBe(40);

    // Verify plate capacities are respected (20 samples per plate)
    result.forEach((samples) => {
      expect(samples.length).toBe(20);
    });

    // Verify proportional distribution
    const groupCounts = countSamplesPerGroup(result, selectedCovariates);

    // Control group (8 samples) should be distributed 4 per plate
    const controlCounts = groupCounts.get('N/A|N/A|Control');
    expect(controlCounts?.size).toBe(2);
    expect(controlCounts!.get(0)).toBe(4);
    expect(controlCounts!.get(1)).toBe(4);

    // Each other covariate group (4 samples each) should be distributed 2 per plate
    const otherGroups = [
      'Male|P_1|Blinded', 'Female|P_1|Blinded',
      'Male|P_1|X-Ray', 'Female|P_1|X-Ray',
      'Male|P_2|Blinded', 'Female|P_2|Blinded',
      'Male|P_2|X-Ray', 'Female|P_2|X-Ray'
    ];

    otherGroups.forEach(groupKey => {
      const groupCount = groupCounts.get(groupKey);
      expect(groupCount?.size).toBe(2);
      expect(groupCount!.get(0)).toBe(2);
      expect(groupCount!.get(1)).toBe(2);
    });
  });


  test('should distribute covariate groups proportionally across multiple plates', () => {
    // Create 120 samples with 3 covariate groups
    const samples: SearchData[] = [];

    // Group 1: Male_P_1_Control (60 samples)
    for (let i = 1; i <= 60; i++) {
      samples.push(createSample(`M_P1_C_${i}`, 'Male', 'P_1', 'Control'));
    }

    // Group 2: Female_P_2_Blinded (40 samples)
    for (let i = 1; i <= 40; i++) {
      samples.push(createSample(`F_P2_B_${i}`, 'Female', 'P_2', 'Blinded'));
    }

    // Group 3: Male_P_3_X-Ray (20 samples)
    for (let i = 1; i <= 20; i++) {
      samples.push(createSample(`M_P3_X_${i}`, 'Male', 'P_3', 'X-Ray'));
    }

    const selectedCovariates = ['Gender', 'Plate', 'Treatment'];
    const covariateGroups = groupByCovariates(samples, selectedCovariates);

    // Create 4 plates with capacity 30 each
    const blockCapacities = [30, 30, 30, 30];
    const plateCount = blockCapacities.length;

    const maxCapacity = 30;
    const blockType = BlockType.PLATE;
    const expectedMinimums = calculateExpectedMinimums(blockCapacities, covariateGroups, maxCapacity, blockType);

    const result = distributeToBlocks(
      covariateGroups,
      blockCapacities,
      maxCapacity,
      selectedCovariates,
      blockType,
      expectedMinimums
    );

    // Verify all plates are created
    expect(result.size).toBe(plateCount);
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(true);

    // Verify total sample count
    let totalSamples = 0;
    result.forEach(samples => {
      totalSamples += samples.length;
    });
    expect(totalSamples).toBe(120);

    // Verify plate capacities are respected
    result.forEach((samples, plateId) => {
      expect(samples.length).toBe(30);
    });

    // Verify proportional distribution of covariate groups
    const groupCounts = countSamplesPerGroup(result, selectedCovariates);

    // Group 1 (60 samples) should be distributed 15 per plate
    const group1Counts = groupCounts.get('Male|P_1|Control');
    expect(group1Counts?.size).toBe(plateCount);
    let group1Total = 0;
    group1Counts!.forEach(count => {
      group1Total += count;
      expect(count).toBe(15);
    });
    expect(group1Total).toBe(60);

    // Group 2 (40 samples) should be distributed 10 per plate
    const group2Counts = groupCounts.get('Female|P_2|Blinded');
    expect(group2Counts?.size).toBe(plateCount);
    let group2Total = 0;
    group2Counts!.forEach(count => {
      group2Total += count;
      expect(count).toBe(10);
    });
    expect(group2Total).toBe(40);

    // Group 3 (20 samples) should be distributed 5 per plate
    const group3Counts = groupCounts.get('Male|P_3|X-Ray');
    expect(group3Counts?.size).toBe(plateCount);
    let group3Total = 0;
    group3Counts!.forEach(count => {
      group3Total += count;
      expect(count).toBe(5);
    });
    expect(group3Total).toBe(20);
  });

  test('Should handle uneven plate capacities with proportional distribution based on capacity ratios', () => {
    // Create 100 samples with 2 covariate groups
    const samples: SearchData[] = [];

    // Group 1: Female_P_1_Control (70 samples)
    for (let i = 1; i <= 70; i++) {
      samples.push(createSample(`F_P1_C_${i}`, 'Female', 'P_1', 'Control'));
    }

    // Group 2: Male_P_2_Blinded (30 samples)
    for (let i = 1; i <= 30; i++) {
      samples.push(createSample(`M_P2_B_${i}`, 'Male', 'P_2', 'Blinded'));
    }

    const selectedCovariates = ['Gender', 'Plate', 'Treatment'];
    const covariateGroups = groupByCovariates(samples, selectedCovariates);

    // Create plates with different capacities
    const blockCapacities = [40, 40, 20];

    const maxCapacity = 40;
    const blockType = BlockType.PLATE;
    const expectedMinimums = calculateExpectedMinimums(blockCapacities, covariateGroups, maxCapacity, blockType);
    expect(expectedMinimums).toBeDefined();
    expect(Object.keys(expectedMinimums).length).toBe(3);

    // Hamilton: quota = groupSize × plateCap / totalCap. All quotas are integers here.
    // G1 (70): P1=28, P2=28, P3=14. G2 (30): P1=12, P2=12, P3=6.
    // Per-plate sums: P1=40, P2=40, P3=20. Per-group sums: G1=70, G2=30.
    expect(expectedMinimums[0]['Female|P_1|Control'] + expectedMinimums[1]['Female|P_1|Control'] + expectedMinimums[2]['Female|P_1|Control']).toBe(70);
    expect(expectedMinimums[0]['Male|P_2|Blinded'] + expectedMinimums[1]['Male|P_2|Blinded'] + expectedMinimums[2]['Male|P_2|Blinded']).toBe(30);
    for (let p = 0; p < 3; p++) {
      const plateSum = (expectedMinimums[p]['Female|P_1|Control'] ?? 0) + (expectedMinimums[p]['Male|P_2|Blinded'] ?? 0);
      expect(plateSum).toBe(blockCapacities[p]);
    }

    const result = distributeToBlocks(
      covariateGroups,
      blockCapacities,
      maxCapacity,
      selectedCovariates,
      blockType,
      expectedMinimums
    );

    // Verify all plates are created
    expect(result.size).toBe(3);

    // Verify total sample count
    let totalSamples = 0;
    result.forEach(samples => {
      totalSamples += samples.length;
    });
    expect(totalSamples).toBe(100);

    // Verify plate capacities are respected
    expect(result.get(0)!.length).toBe(40);
    expect(result.get(1)!.length).toBe(40);
    expect(result.get(2)!.length).toBe(20);

    // Verify proportional distribution
    const groupCounts = countSamplesPerGroup(result, selectedCovariates);

    // With Hamilton apportionment, all samples are placed in Phase 1.
    // G1 (70): quota per plate = 70×cap/100. P1: 28, P2: 28, P3: 14.
    // G2 (30): quota per plate = 30×cap/100. P1: 12, P2: 12, P3: 6.
    const group1Counts = groupCounts.get('Female|P_1|Control');
    expect(group1Counts).toBeDefined();
    const group2Counts = groupCounts.get('Male|P_2|Blinded');
    expect(group2Counts).toBeDefined();

    // Verify all samples are distributed
    const group1Total = (group1Counts!.get(0) || 0) + (group1Counts!.get(1) || 0) + (group1Counts!.get(2) || 0);
    const group2Total = (group2Counts!.get(0) || 0) + (group2Counts!.get(1) || 0) + (group2Counts!.get(2) || 0);
    expect(group1Total).toBe(70);
    expect(group2Total).toBe(30);

    // Verify proportional allocation: each cell within ±1 of ideal
    // G1 on P1/P2: ideal = 70×40/100 = 28. G1 on P3: ideal = 70×20/100 = 14.
    // G2 on P1/P2: ideal = 30×40/100 = 12. G2 on P3: ideal = 30×20/100 = 6.
    expect(group1Counts!.get(0)).toBeGreaterThanOrEqual(27);
    expect(group1Counts!.get(0)).toBeLessThanOrEqual(29);
    expect(group1Counts!.get(1)).toBeGreaterThanOrEqual(27);
    expect(group1Counts!.get(1)).toBeLessThanOrEqual(29);
    expect(group1Counts!.get(2)).toBeGreaterThanOrEqual(13);
    expect(group1Counts!.get(2)).toBeLessThanOrEqual(15);

    expect(group2Counts!.get(0)).toBeGreaterThanOrEqual(11);
    expect(group2Counts!.get(0)).toBeLessThanOrEqual(13);
    expect(group2Counts!.get(1)).toBeGreaterThanOrEqual(11);
    expect(group2Counts!.get(1)).toBeLessThanOrEqual(13);
    expect(group2Counts!.get(2)).toBeGreaterThanOrEqual(5);
    expect(group2Counts!.get(2)).toBeLessThanOrEqual(7);

    // Verify final plate capacities are reached
    const plate0Total = (group1Counts!.get(0) || 0) + (group2Counts!.get(0) || 0);
    const plate1Total = (group1Counts!.get(1) || 0) + (group2Counts!.get(1) || 0);
    const plate2Total = (group1Counts!.get(2) || 0) + (group2Counts!.get(2) || 0);

    expect(plate0Total).toBe(40);
    expect(plate1Total).toBe(40);
    expect(plate2Total).toBe(20);
  });


  test('Should handle single plate distribution', () => {
    // Create 50 samples with 2 covariate groups
    const samples: SearchData[] = [];

    // Group 1: Male_P_1_X-Ray (30 samples)
    for (let i = 1; i <= 30; i++) {
      samples.push(createSample(`M_P1_X_${i}`, 'Male', 'P_1', 'X-Ray'));
    }

    // Group 2: Female_P_3_Control (20 samples)
    for (let i = 1; i <= 20; i++) {
      samples.push(createSample(`F_P3_C_${i}`, 'Female', 'P_3', 'Control'));
    }

    const selectedCovariates = ['Gender', 'Plate', 'Treatment'];
    const covariateGroups = groupByCovariates(samples, selectedCovariates);

    // Single plate with sufficient capacity
    const blockCapacities = [60];
    const maxCapacity = 30;
    const blockType = BlockType.PLATE;
    const expectedMinimums = {};

    const result = distributeToBlocks(
      covariateGroups,
      blockCapacities,
      maxCapacity,
      selectedCovariates,
      blockType,
      expectedMinimums
    );

    // Verify single plate created
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);

    // Verify all samples are in the single plate
    expect(result.get(0)!.length).toBe(50);

    // Verify both groups are present
    const groupCounts = countSamplesPerGroup(result, selectedCovariates);
    expect(groupCounts.get('Male|P_1|X-Ray')!.get(0)).toBe(30);
    expect(groupCounts.get('Female|P_3|Control')!.get(0)).toBe(20);
  });

  test('should handle edge case with more plates than needed', () => {
    // Create 30 samples with 1 covariate group
    const samples: SearchData[] = [];

    for (let i = 1; i <= 30; i++) {
      samples.push(createSample(`F_P2_B_${i}`, 'Female', 'P_2', 'Blinded'));
    }

    const selectedCovariates = ['Gender', 'Plate', 'Treatment'];
    const covariateGroups = groupByCovariates(samples, selectedCovariates);

    // 5 plates but only need 2-3 plates for 30 samples
    const blockCapacities = [15, 15, 15, 15, 15];

    const maxCapacity = 60;
    const blockType = BlockType.PLATE;
    const expectedMinimums = {};

    const result = distributeToBlocks(
      covariateGroups,
      blockCapacities,
      maxCapacity,
      selectedCovariates,
      blockType,
      expectedMinimums
    );

    // Verify that only plates with samples are returned
    let totalSamples = 0;
    let usedPlates = 0;
    result.forEach(samples => {
      totalSamples += samples.length;
      if (samples.length > 0) {
        usedPlates++;
      }
    });

    expect(totalSamples).toBe(30);
    expect(usedPlates).toBeGreaterThan(0);
    expect(usedPlates).toBeLessThanOrEqual(5);

    // Each used plate should be at or under capacity
    result.forEach(samples => {
      if (samples.length > 0) {
        expect(samples.length).toBeLessThanOrEqual(15);
      }
    });
  });
});


describe('calculateExpectedMinimums', () => {
  // Helper function to create covariate groups for testing
  const createTestGroups = (): Map<string, SearchData[]> => {
    const groups = new Map<string, SearchData[]>();

    // Group 1: 20 samples
    const group1Samples = Array.from({ length: 20 }, (_, i) => ({
      name: `sample_1_${i + 1}`,
      metadata: { Gender: 'Male', Plate: 'P_1', Treatment: 'Control' },
      treatmentKey: 'Male|P_1|Control'
    }));
    groups.set('Male|P_1|Control', group1Samples);

    // Group 2: 10 samples
    const group2Samples = Array.from({ length: 10 }, (_, i) => ({
      name: `sample_2_${i + 1}`,
      metadata: { Gender: 'Female', Plate: 'P_2', Treatment: 'Blinded' },
      treatmentKey: 'Female|P_2|Blinded'
    }));
    groups.set('Female|P_2|Blinded', group2Samples);

    // Group 3: 6 samples
    const group3Samples = Array.from({ length: 6 }, (_, i) => ({
      name: `sample_3_${i + 1}`,
      metadata: { Gender: 'Male', Plate: 'P_3', Treatment: 'X-Ray' },
      treatmentKey: 'Male|P_3|X-Ray'
    }));
    groups.set('Male|P_3|X-Ray', group3Samples);

    return groups;
  };

  test('Should calculate expected minimums for plates with equal capacities', () => {
    const covariateGroups = createTestGroups();
    const blockCapacities = [12, 12, 12]; // 3 plates with 12 capacity each
    const fullBlockCapacity = 12;
    const blockType = BlockType.PLATE;

    const result = calculateExpectedMinimums(
      blockCapacities,
      covariateGroups,
      fullBlockCapacity,
      blockType
    );

    // Verify structure
    expect(Object.keys(result)).toHaveLength(3);
    expect(result[0]).toBeDefined();
    expect(result[1]).toBeDefined();
    expect(result[2]).toBeDefined();

    // Hamilton invariants: per-plate sum = capacity, per-group sum = group size
    const totalCap = 36;
    for (let p = 0; p < 3; p++) {
      const plateSum = Object.values(result[p]).reduce((a: number, b: number) => a + b, 0);
      expect(plateSum).toBe(12);
    }

    // Group 1: 20 samples across 3 plates — each plate gets 6 or 7
    const g1Total = result[0]['Male|P_1|Control'] + result[1]['Male|P_1|Control'] + result[2]['Male|P_1|Control'];
    expect(g1Total).toBe(20);
    for (let p = 0; p < 3; p++) {
      expect(result[p]['Male|P_1|Control']).toBeGreaterThanOrEqual(6);
      expect(result[p]['Male|P_1|Control']).toBeLessThanOrEqual(7);
    }

    // Group 2: 10 samples across 3 plates — each plate gets 3 or 4
    const g2Total = result[0]['Female|P_2|Blinded'] + result[1]['Female|P_2|Blinded'] + result[2]['Female|P_2|Blinded'];
    expect(g2Total).toBe(10);
    for (let p = 0; p < 3; p++) {
      expect(result[p]['Female|P_2|Blinded']).toBeGreaterThanOrEqual(3);
      expect(result[p]['Female|P_2|Blinded']).toBeLessThanOrEqual(4);
    }

    // Group 3: 6 samples across 3 plates = exactly 2 per plate
    expect(result[0]['Male|P_3|X-Ray']).toBe(2);
    expect(result[1]['Male|P_3|X-Ray']).toBe(2);
    expect(result[2]['Male|P_3|X-Ray']).toBe(2);
  });

  test('Should calculate expected minimums for plates with unequal capacities', () => {
    const covariateGroups = createTestGroups();
    const blockCapacities = [20, 10, 6]; // Different capacities
    const fullBlockCapacity = 20; // Full capacity
    const blockType = BlockType.PLATE;

    const result = calculateExpectedMinimums(
      blockCapacities,
      covariateGroups,
      fullBlockCapacity,
      blockType
    );

    // Hamilton invariants: per-plate sum = capacity, per-group sum = group size
    const plateSums = [0, 0, 0];
    for (let p = 0; p < 3; p++) {
      plateSums[p] = Object.values(result[p]).reduce((a: number, b: number) => a + b, 0);
      expect(plateSums[p]).toBe(blockCapacities[p]);
    }

    // Group totals must equal group sizes
    const g1Total = result[0]['Male|P_1|Control'] + result[1]['Male|P_1|Control'] + result[2]['Male|P_1|Control'];
    expect(g1Total).toBe(20);
    const g2Total = result[0]['Female|P_2|Blinded'] + result[1]['Female|P_2|Blinded'] + result[2]['Female|P_2|Blinded'];
    expect(g2Total).toBe(10);
    const g3Total = result[0]['Male|P_3|X-Ray'] + result[1]['Male|P_3|X-Ray'] + result[2]['Male|P_3|X-Ray'];
    expect(g3Total).toBe(6);

    // Each cell within ±1 of ideal (groupSize × plateCap / totalCap)
    const totalCap = 36;
    for (let p = 0; p < 3; p++) {
      for (const [key, size] of [['Male|P_1|Control', 20], ['Female|P_2|Blinded', 10], ['Male|P_3|X-Ray', 6]] as [string, number][]) {
        const ideal = (size * blockCapacities[p]) / totalCap;
        expect(result[p][key]).toBeGreaterThanOrEqual(Math.floor(ideal));
        expect(result[p][key]).toBeLessThanOrEqual(Math.ceil(ideal));
      }
    }
  });

  test('Should calculate expected minimums for rows with equal capacities', () => {
    const covariateGroups = createTestGroups();
    const blockCapacities = [6, 6, 6, 6]; // 4 rows with 6 columns each
    const fullBlockCapacity = 6; // Full row capacity
    const blockType = BlockType.ROW;

    // This test case has 36 total samples but only 24 total capacity (4 * 6)
    // It should throw an error indicating impossible distribution
    expect(() => {
      calculateExpectedMinimums(
        blockCapacities,
        covariateGroups,
        fullBlockCapacity,
        blockType
      );
    }).toThrow();
  });

  test('Should handle single block case (capacity ratio = 1)', () => {
    const covariateGroups = createTestGroups();
    const blockCapacities = [36]; // Single plate with capacity = total samples. This is less than full block capacity.
    const fullBlockCapacity = 50;
    const blockType = BlockType.PLATE;

    const result = calculateExpectedMinimums(
      blockCapacities,
      covariateGroups,
      fullBlockCapacity,
      blockType
    );

    // With single block, capacity ratio should be 1 for all groups
    expect(result[0]['Male|P_1|Control']).toBe(20); // All 20 samples
    expect(result[0]['Female|P_2|Blinded']).toBe(10); // All 10 samples
    expect(result[0]['Male|P_3|X-Ray']).toBe(6); // All 6 samples
  });
});