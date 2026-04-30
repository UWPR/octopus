import {
  calculateClusterScore,
  greedyPlaceInRow,
  analyzePlateSpatialQuality,
  analyzeOverallSpatialQuality,
  isClustered,
  identifyClusteredPositions
} from '../algorithms/greedySpatialPlacement';
import { SearchData } from '../utils/types';

describe('Greedy Spatial Placement', () => {
  const createSample = (id: string, gender: string, protocol: string, treatment: string): SearchData => ({
    name: `Sample_${id}`,
    metadata: {
      gender: gender,
      protocol,
      treatment
    },
    covariateKey: `${gender}|${protocol}|${treatment}`
  });

  describe('calculateClusterScore', () => {
    it('should return 0 for first placement in empty plate', () => {
      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];

      const score = calculateClusterScore(plates[0], 0, 0, 'Male|P1|Control', 12);

      expect(score).toBe(0);
    });

    it('should penalize horizontal adjacency heavily', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];
      plates[0][0][0] = sample1;

      const treatmentKey = 'Male|P1|Control';

      // Check position 1 (right next to position 0)
      const score = calculateClusterScore(plates[0], 0, 1, treatmentKey, 12);

      expect(score).toBe(10); // Heavy penalty for horizontal adjacency
    });

    it('should penalize vertical adjacency heavily', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];
      plates[0][0][0] = sample1;

      const treatmentKey = 'Male|P1|Control';

      // Check position in row 1, column 0 (directly below)
      const score = calculateClusterScore(plates[0], 1, 0, treatmentKey, 12);

      expect(score).toBe(10); // Heavy penalty for vertical adjacency
    });

    it('should penalize cross-row adjacency', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];
      // Place sample at last column of row 0
      plates[0][0][11] = sample1;

      const treatmentKey = 'Male|P1|Control';

      // Check first column of row 1 (cross-row position)
      const score = calculateClusterScore(plates[0], 1, 0, treatmentKey, 12);

      expect(score).toBe(8); // Medium-high penalty for cross-row adjacency
    });

    it('should not penalize different treatment groups', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];
      plates[0][0][0] = sample1;

      const differentTreatmentKey = 'Female|P2|Treatment';

      // Check position 1 (right next to position 0, but different treatment)
      const score = calculateClusterScore(plates[0], 0, 1, differentTreatmentKey, 12);

      expect(score).toBe(0); // No penalty for different treatment
    });
  });

  describe('greedyPlaceInRow', () => {
    it('should minimize horizontal adjacency when possible', () => {
      // greedyPlaceInRow shuffles internally, so run multiple trials
      // and verify the algorithm produces 0 horizontal adjacencies most of the time.
      const trials = 20;
      let zeroAdjacencyCount = 0;

      for (let t = 0; t < trials; t++) {
        const samples = [
          createSample('1', 'Male', 'P1', 'Control'),
          createSample('2', 'Male', 'P1', 'Control'),
          createSample('3', 'Female', 'P2', 'Treatment'),
          createSample('4', 'Male', 'P3', 'Blinded'),
          createSample('5', 'Female', 'P4', 'XRay')
        ];

        const plate: (SearchData | undefined)[][] =
          Array.from({ length: 8 }, () => new Array(12).fill(undefined));

        greedyPlaceInRow(samples, plate, 0, 12);

        let adjacentCount = 0;
        for (let col = 0; col < 11; col++) {
          const current = plate[0][col];
          const next = plate[0][col + 1];
          if (current && next && current.covariateKey === next.covariateKey) {
            adjacentCount++;
          }
        }
        if (adjacentCount === 0) zeroAdjacencyCount++;
      }

      // With 5 samples, 2 sharing a key, and 3 distinct separators,
      // the greedy algorithm should achieve 0 adjacencies in the majority of trials.
      expect(zeroAdjacencyCount).toBeGreaterThanOrEqual(Math.floor(trials * 0.5));
    });

    it('should place all samples in the row', () => {
      const samples = [
        createSample('1', 'Male', 'P1', 'Control'),
        createSample('2', 'Female', 'P2', 'Treatment'),
        createSample('3', 'Male', 'P3', 'Blinded')
      ];

      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];

      greedyPlaceInRow(samples, plates[0], 0, 12);

      // Count placed samples
      const placedCount = plates[0][0].filter(s => s !== undefined).length;

      expect(placedCount).toBe(3);
    });
  });

  describe('analyzePlateSpatialQuality', () => {
    it('should detect horizontal clusters', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const sample2 = createSample('2', 'Male', 'P1', 'Control');

      const plate: (SearchData | undefined)[][] = Array.from({ length: 8 }, () =>
        new Array(12).fill(undefined)
      );
      plate[0][0] = sample1;
      plate[0][1] = sample2;

      const quality = analyzePlateSpatialQuality(plate, 8, 12);

      expect(quality.horizontalClusters).toBe(1);
      expect(quality.verticalClusters).toBe(0);
      expect(quality.crossRowClusters).toBe(0);
    });

    it('should detect vertical clusters', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const sample2 = createSample('2', 'Male', 'P1', 'Control');

      const plate: (SearchData | undefined)[][] = Array.from({ length: 8 }, () =>
        new Array(12).fill(undefined)
      );
      plate[0][0] = sample1;
      plate[1][0] = sample2;

      const quality = analyzePlateSpatialQuality(plate, 8, 12);

      expect(quality.horizontalClusters).toBe(0);
      expect(quality.verticalClusters).toBe(1);
      expect(quality.crossRowClusters).toBe(0);
    });

    it('should detect cross-row clusters', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const sample2 = createSample('2', 'Male', 'P1', 'Control');

      const plate: (SearchData | undefined)[][] = Array.from({ length: 8 }, () =>
        new Array(12).fill(undefined)
      );
      plate[0][11] = sample1; // Last column of row 0
      plate[1][0] = sample2; // First column of row 1

      const quality = analyzePlateSpatialQuality(plate, 8, 12);

      expect(quality.horizontalClusters).toBe(0);
      expect(quality.verticalClusters).toBe(0);
      expect(quality.crossRowClusters).toBe(1);
    });

    it('should return zero clusters for well-distributed samples', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const sample2 = createSample('2', 'Male', 'P1', 'Control');
      const sample3 = createSample('3', 'Female', 'P2', 'Treatment');

      const plate: (SearchData | undefined)[][] = Array.from({ length: 8 }, () =>
        new Array(12).fill(undefined)
      );
      // Place samples far apart
      plate[0][0] = sample1;
      plate[0][5] = sample2;
      plate[0][2] = sample3;

      const quality = analyzePlateSpatialQuality(plate, 8, 12);

      expect(quality.totalClusters).toBe(0);
    });
  });

  describe('analyzeOverallSpatialQuality', () => {
    it('should aggregate quality across multiple plates', () => {
      const sample1 = createSample('1', 'Male', 'P1', 'Control');
      const sample2 = createSample('2', 'Male', 'P1', 'Control');
      const sample3 = createSample('3', 'Female', 'P2', 'Treatment');
      const sample4 = createSample('4', 'Female', 'P2', 'Treatment');

      const plates: (SearchData | undefined)[][][] = [
        Array.from({ length: 8 }, () => new Array(12).fill(undefined)),
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
      ];

      // Plate 0: 1 horizontal cluster
      plates[0][0][0] = sample1;
      plates[0][0][1] = sample2;

      // Plate 1: 1 vertical cluster
      plates[1][0][0] = sample3;
      plates[1][1][0] = sample4;

      const quality = analyzeOverallSpatialQuality(plates, 8, 12);

      expect(quality.plateQualities).toHaveLength(2);
      expect(quality.plateQualities[0].plateIndex).toBe(0);
      expect(quality.plateQualities[0].horizontalClusters).toBe(1);
      expect(quality.plateQualities[0].verticalClusters).toBe(0);
      expect(quality.plateQualities[1].plateIndex).toBe(1);
      expect(quality.plateQualities[1].horizontalClusters).toBe(0);
      expect(quality.plateQualities[1].verticalClusters).toBe(1);
      expect(quality.totalHorizontalClusters).toBe(1);
      expect(quality.totalVerticalClusters).toBe(1);
      expect(quality.totalClusters).toBe(2);
    });
  });

  describe('isClustered', () => {
    // Helper: build a plate grid of given dimensions, all undefined
    const makePlate = (rows: number, cols: number): (SearchData | undefined)[][] =>
      Array.from({ length: rows }, () => new Array(cols).fill(undefined));

    it('should return false for an isolated sample with no neighbors', () => {
      const plate = makePlate(4, 6);
      const A = createSample('1', 'Male', 'P1', 'Control');
      plate[1][3] = A;

      expect(isClustered(3, 1, plate, A.covariateKey, 6, 4)).toBe(false);
    });

    it('should return false when all neighbors have different covariate keys', () => {
      const plate = makePlate(3, 3);
      const center = createSample('1', 'Male', 'P1', 'Control');
      plate[1][1] = center;
      // Surround with different-key samples
      plate[0][1] = createSample('2', 'Female', 'P2', 'Treatment'); // above
      plate[2][1] = createSample('3', 'Female', 'P3', 'Blinded');   // below
      plate[1][0] = createSample('4', 'Female', 'P4', 'XRay');      // left
      plate[1][2] = createSample('5', 'Male', 'P2', 'Treatment');   // right

      expect(isClustered(1, 1, plate, center.covariateKey, 3, 3)).toBe(false);
    });

    it('should detect left neighbor clustering', () => {
      const plate = makePlate(3, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[1][1] = A; // left neighbor
      plate[1][2] = B; // position under test

      expect(isClustered(2, 1, plate, B.covariateKey, 4, 3)).toBe(true);
    });

    it('should detect right neighbor clustering', () => {
      const plate = makePlate(3, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[1][2] = A; // position under test
      plate[1][3] = B; // right neighbor

      expect(isClustered(2, 1, plate, A.covariateKey, 4, 3)).toBe(true);
    });

    it('should detect above neighbor clustering', () => {
      const plate = makePlate(4, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][2] = A; // above
      plate[1][2] = B; // position under test

      expect(isClustered(2, 1, plate, B.covariateKey, 4, 4)).toBe(true);
    });

    it('should detect below neighbor clustering', () => {
      const plate = makePlate(4, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[1][2] = A; // position under test
      plate[2][2] = B; // below

      expect(isClustered(2, 1, plate, A.covariateKey, 4, 4)).toBe(true);
    });

    it('should detect cross-row clustering: last col of prev row → first col of current row', () => {
      const plate = makePlate(3, 5);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][4] = A; // last column of row 0
      plate[1][0] = B; // first column of row 1

      // Test from perspective of (row=1, col=0)
      expect(isClustered(0, 1, plate, B.covariateKey, 5, 3)).toBe(true);
    });

    it('should detect cross-row clustering: last col of current row → first col of next row', () => {
      const plate = makePlate(3, 5);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][4] = A; // last column of row 0
      plate[1][0] = B; // first column of row 1

      // Test from perspective of (row=0, col=4)
      expect(isClustered(4, 0, plate, A.covariateKey, 5, 3)).toBe(true);
    });

    it('should not false-positive cross-row when col is not at boundary', () => {
      // Same key at row 0 col 4 and row 1 col 1 — not a cross-row pair
      const plate = makePlate(3, 5);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][4] = A;
      plate[1][1] = B;

      // Position (row=1, col=1) has no same-key neighbors
      expect(isClustered(1, 1, plate, B.covariateKey, 5, 3)).toBe(false);
    });

    it('should handle top-left corner (row=0, col=0) with no neighbors', () => {
      const plate = makePlate(3, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      plate[0][0] = A;

      expect(isClustered(0, 0, plate, A.covariateKey, 4, 3)).toBe(false);
    });

    it('should handle bottom-right corner with same-key above', () => {
      const plate = makePlate(3, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[1][3] = A; // above the corner
      plate[2][3] = B; // bottom-right corner

      expect(isClustered(3, 2, plate, B.covariateKey, 4, 3)).toBe(true);
    });

    it('should handle bottom-right corner with no same-key neighbors', () => {
      const plate = makePlate(3, 4);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Female', 'P2', 'Treatment');
      plate[1][3] = B; // above, different key
      plate[2][2] = B; // left, different key
      plate[2][3] = A; // bottom-right corner

      expect(isClustered(3, 2, plate, A.covariateKey, 4, 3)).toBe(false);
    });

    it('should return true when only the right neighbor matches (no left, above, below, or cross-row)', () => {
      // This is the exact scenario the bug would have missed:
      // position has no left neighbor match, but right neighbor matches
      const plate = makePlate(1, 3);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      const C = createSample('3', 'Female', 'P2', 'Treatment');
      plate[0][0] = C; // different key to the left
      plate[0][1] = A; // position under test
      plate[0][2] = B; // same key to the right

      expect(isClustered(1, 0, plate, A.covariateKey, 3, 1)).toBe(true);
    });

    it('should return true when only the below neighbor matches (no left, right, above, or cross-row)', () => {
      // Another scenario the bug would have missed
      const plate = makePlate(2, 1);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][0] = A; // position under test
      plate[1][0] = B; // same key below

      expect(isClustered(0, 0, plate, A.covariateKey, 1, 2)).toBe(true);
    });

    it('should return true when only the above neighbor matches', () => {
      const plate = makePlate(2, 3);
      const A = createSample('1', 'Male', 'P1', 'Control');
      const B = createSample('2', 'Male', 'P1', 'Control');
      plate[0][1] = A; // above
      plate[1][1] = B; // position under test
      // left and right are empty, no cross-row

      expect(isClustered(1, 1, plate, B.covariateKey, 3, 2)).toBe(true);
    });

    it('should handle undefined covariateKey (matches other undefined)', () => {
      const plate = makePlate(2, 2);
      const A: SearchData = { name: 'A', metadata: {} }; // no covariateKey
      const B: SearchData = { name: 'B', metadata: {} }; // no covariateKey
      plate[0][0] = A;
      plate[0][1] = B;

      // Both have undefined covariateKey, which are equal
      expect(isClustered(0, 0, plate, undefined, 2, 2)).toBe(true);
    });
  });

  describe('identifyClusteredPositions', () => {
    const makePlate = (rows: number, cols: number): (SearchData | undefined)[][] =>
      Array.from({ length: rows }, () => new Array(cols).fill(undefined));

    it('should return empty array for an empty plate', () => {
      const plate = makePlate(4, 6);
      const result = identifyClusteredPositions(plate, 4, 6);
      expect(result).toEqual([]);
    });

    it('should return empty array when no samples are clustered', () => {
      const plate = makePlate(3, 4);
      plate[0][0] = createSample('1', 'Male', 'P1', 'Control');
      plate[0][2] = createSample('2', 'Female', 'P2', 'Treatment');
      plate[2][1] = createSample('3', 'Male', 'P3', 'Blinded');

      const result = identifyClusteredPositions(plate, 3, 4);
      expect(result).toEqual([]);
    });

    it('should identify both positions in a horizontal cluster', () => {
      const plate = makePlate(3, 4);
      plate[1][1] = createSample('1', 'Male', 'P1', 'Control');
      plate[1][2] = createSample('2', 'Male', 'P1', 'Control');

      const result = identifyClusteredPositions(plate, 3, 4);
      expect(result).toEqual([
        { row: 1, col: 1 },
        { row: 1, col: 2 },
      ]);
    });

    it('should identify both positions in a vertical cluster', () => {
      const plate = makePlate(4, 4);
      plate[0][2] = createSample('1', 'Male', 'P1', 'Control');
      plate[1][2] = createSample('2', 'Male', 'P1', 'Control');

      const result = identifyClusteredPositions(plate, 4, 4);
      expect(result).toEqual([
        { row: 0, col: 2 },
        { row: 1, col: 2 },
      ]);
    });

    it('should identify both positions in a cross-row cluster', () => {
      const plate = makePlate(3, 5);
      plate[0][4] = createSample('1', 'Male', 'P1', 'Control'); // last col row 0
      plate[1][0] = createSample('2', 'Male', 'P1', 'Control'); // first col row 1

      const result = identifyClusteredPositions(plate, 3, 5);
      expect(result).toEqual([
        { row: 0, col: 4 },
        { row: 1, col: 0 },
      ]);
    });

    it('should identify all positions in a 3-sample horizontal chain', () => {
      const plate = makePlate(2, 5);
      plate[0][1] = createSample('1', 'Male', 'P1', 'Control');
      plate[0][2] = createSample('2', 'Male', 'P1', 'Control');
      plate[0][3] = createSample('3', 'Male', 'P1', 'Control');

      const result = identifyClusteredPositions(plate, 2, 5);
      expect(result).toEqual([
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 0, col: 3 },
      ]);
    });

    it('should identify clusters from multiple independent groups', () => {
      const plate = makePlate(3, 4);
      // Horizontal cluster of group A
      plate[0][0] = createSample('1', 'Male', 'P1', 'Control');
      plate[0][1] = createSample('2', 'Male', 'P1', 'Control');
      // Vertical cluster of group B
      plate[1][3] = createSample('3', 'Female', 'P2', 'Treatment');
      plate[2][3] = createSample('4', 'Female', 'P2', 'Treatment');

      const result = identifyClusteredPositions(plate, 3, 4);
      expect(result).toEqual([
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 3 },
        { row: 2, col: 3 },
      ]);
    });

    it('should not flag adjacent samples with different covariate keys', () => {
      const plate = makePlate(2, 3);
      plate[0][0] = createSample('1', 'Male', 'P1', 'Control');
      plate[0][1] = createSample('2', 'Female', 'P2', 'Treatment');
      plate[1][0] = createSample('3', 'Male', 'P3', 'Blinded');

      const result = identifyClusteredPositions(plate, 2, 3);
      expect(result).toEqual([]);
    });
  });
});
