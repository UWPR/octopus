import {
  calculateClusterScore,
  greedyPlaceInRow,
  analyzePlateSpatialQuality,
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
});
