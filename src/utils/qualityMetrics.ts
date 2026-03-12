import { SearchData, QualityMetrics, PlateDiversityMetrics, PlateQualityScore, OverallQualityAssessment } from '../utils/types';
   import { DEFAULT_QUALITY_DISPLAY_CONFIG, QualityDisplayConfig } from '../utils/configs';
import { groupByCovariates, getQualityLevel } from '../utils/utils';

/**
 * Quality Metrics Calculator
 *
 * Focuses on two key aspects of plate randomization quality:
 * 1. Plate Balance Score (Proportional Accuracy)
 * 2. Clustering Score (Spatial Clustering - row, column, cross-row)
 */

// Utility functions
const calculateMean = (values: number[]): number =>
  values.reduce((sum, val) => sum + val, 0) / values.length;

/**
 * Calculate plate balance metrics
 * Returns both overall weighted balance score and detailed breakdown for each covariate group
 */
const calculatePlateBalance = (
  plateSamples: SearchData[],
  allSamples: SearchData[],
  selectedCovariates: string[]
): {
  overallScore: number;
  groupDetails: {
    [combination: string]: {
      actualCount: number;
      expectedCount: number;
      actualProportion: number;
      expectedProportion: number;
      relativeDeviation: number;
      weightedDeviation: number;
      balanceScore: number
    }
  };
} => {
  if (plateSamples.length === 0 || allSamples.length === 0) {
    return { overallScore: 0, groupDetails: {} };
  }

  const plateCombinations = groupByCovariates(plateSamples, selectedCovariates);
  const globalCombinations = groupByCovariates(allSamples, selectedCovariates);
  const plateSize = plateSamples.length;
  const totalSamples = allSamples.length;

  const groupDetails: {
    [combination: string]: {
      actualCount: number;
      expectedCount: number;
      actualProportion: number;
      expectedProportion: number;
      relativeDeviation: number;
      weightedDeviation: number;
      balanceScore: number
    }
  } = {};

  let totalWeightedDeviation = 0;
  let totalWeight = 0;

  globalCombinations.forEach((globalSamples, combination) => {
    const actualCount = plateCombinations.get(combination)?.length || 0;
    const expectedCount = (globalSamples.length / totalSamples) * plateSize;
    const actualProportion = actualCount / plateSize;
    const expectedProportion = globalSamples.length / totalSamples;

    // Calculate relative percent deviation
    let relativeDeviation: number;
    if (expectedProportion > 0) {
      relativeDeviation = Math.abs(actualProportion - expectedProportion) / expectedProportion;
    } else {
      relativeDeviation = actualProportion > 0 ? 1 : 0;
    }

    // Store detailed metrics for this group
    const cappedDeviation = Math.min(relativeDeviation, 1.0);
    const groupBalanceScore = Math.round(Math.max(0, 100 - (cappedDeviation * 100)));

    // Accumulate weighted deviation for overall score (weight by global proportion)
    // const weight = 1; // expectedProportion;
    const weight = expectedProportion;
    const weightedDeviation = relativeDeviation * weight;
    totalWeightedDeviation += weightedDeviation;
    totalWeight += weight;

    groupDetails[combination] = {
      actualCount,
      expectedCount,
      actualProportion,
      expectedProportion,
      relativeDeviation,
      weightedDeviation,
      balanceScore: groupBalanceScore
    };
  });

  // Calculate overall weighted balance score
  let overallScore = 0;
  if (totalWeight > 0) {
    const weightedAverageDeviation = totalWeightedDeviation / totalWeight;
    const cappedDeviation = Math.min(weightedAverageDeviation, 1.0);
    overallScore = Math.round(Math.max(0, 100 - (cappedDeviation * 100)));
  }

  return { overallScore, groupDetails };
};

/**
 * Calculate spatial clustering score for a plate
 * Uses the spatial quality analysis from greedySpatialPlacement
 * Returns a score from 0-100 where 100 = no clustering, 0 = maximum clustering
 *
 * The score is based on the number of same-treatment adjacencies:
 * - Horizontal adjacencies (same row, adjacent columns)
 * - Vertical adjacencies (same column, adjacent rows)
 * - Cross-row adjacencies (last column of row N, first column of row N+1)
 *
 * @param plate - The 2D grid of a single plate
 * @param numRows - Total number of rows per plate
 * @param numColumns - Total number of columns per row
 * @returns Clustering score (0-100)
 */
const calculateClusteringScore = (
  plate: (SearchData | undefined)[][],
  numRows: number,
  numColumns: number
): number => {
  // Import the spatial quality analysis function
  const { analyzePlateSpatialQuality } = require('../algorithms/greedySpatialPlacement');

  // Get the spatial quality metrics
  const quality = analyzePlateSpatialQuality(plate, numRows, numColumns);

  // Count total filled positions in the plate
  let totalFilledPositions = 0;
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numColumns; col++) {
      if (plate[row][col] !== undefined) {
        totalFilledPositions++;
      }
    }
  }

  if (totalFilledPositions === 0) return 100; // Empty plate has perfect score
  if (totalFilledPositions === 1) return 100; // Single sample has perfect score

  // Calculate the theoretical minimum number of adjacencies
  // In a perfect checkerboard pattern with 2 groups, we'd have 0 adjacencies
  // But with multiple groups and irregular distributions, some adjacencies are unavoidable

  // Calculate maximum possible adjacencies for this plate configuration
  // Each filled position can have up to 4 neighbors (left, right, up, down)
  // But we count each adjacency once, so we count edges, not positions
  let maxHorizontalAdjacencies = 0;
  let maxVerticalAdjacencies = 0;
  let maxCrossRowAdjacencies = 0;

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numColumns; col++) {
      if (plate[row][col] !== undefined) {
        // Count potential horizontal adjacency (to the right)
        if (col < numColumns - 1 && plate[row][col + 1] !== undefined) {
          maxHorizontalAdjacencies++;
        }
        // Count potential vertical adjacency (below)
        if (row < numRows - 1 && plate[row + 1][col] !== undefined) {
          maxVerticalAdjacencies++;
        }
        // Count potential cross-row adjacency
        if (col === numColumns - 1 && row < numRows - 1 && plate[row + 1][0] !== undefined) {
          maxCrossRowAdjacencies++;
        }
      }
    }
  }

  const maxTotalAdjacencies = maxHorizontalAdjacencies + maxVerticalAdjacencies + maxCrossRowAdjacencies;

  if (maxTotalAdjacencies === 0) return 100; // No possible adjacencies

  // Calculate clustering ratio
  // 0 clusters = perfect (100 score)
  // All possible adjacencies are clusters = worst (0 score)
  const clusterRatio = quality.totalClusters / maxTotalAdjacencies;

  // Convert to score (0-100)
  const score = Math.round((1 - clusterRatio) * 100);

  return Math.max(0, Math.min(100, score));
}


/**
 * Calculate row clustering score
 * Measures clustering (runs of same group)
 * Higher score = better distribution (less clustering)
 */
const calculateRowClusteringScore = (
  plateRows: (SearchData | undefined)[][],
): { averageScore: number; rowScores: number[] } => {
  if (plateRows.length === 0) return { averageScore: 0, rowScores: [] };

  const numRows = plateRows.length;
  let totalScore = 0;
  let analyzedRows = 0;
  const rowScores: number[] = [];

  // Analyze each row
  for (let row = 0; row < numRows; row++) {
    const rowSamples = plateRows[row].filter((sample): sample is SearchData => sample !== undefined);

    if (rowSamples.length <= 2) {
      rowScores.push(100); // Default score for rows with insufficient samples
      continue;
    }

    const rowKeys = rowSamples.map(sample => sample.covariateKey || '');

    // Calculate clustering score
    const rowScore = calculateRowScore(rowKeys);
    console.log(`Row ${row} keys: ${rowKeys.join(', ')} => Clustering Score: ${rowScore.toFixed(2)}`);

    rowScores.push(rowScore);
    totalScore += rowScore;
    analyzedRows++;
  }

  if (analyzedRows === 0) return { averageScore: 100, rowScores };
  const averageScore = totalScore / analyzedRows;
  console.log(`Average Row Clustering Score: ${averageScore.toFixed(2)}`);
  return { averageScore, rowScores };
};

/**
 * Calculate expected number of runs for the provided group-runLength combinations
 * in actualRunCounts.
 */
const calculateExpectedRunsByGroup = (
  rowKeys: string[],
  actualRunCounts: Map<string, Map<number, number>>
): Map<string, Map<number, number>> => {
  const n = rowKeys.length;
  const rowComposition = new Map<string, number>();

  // Count composition
  rowKeys.forEach(key => {
    rowComposition.set(key, (rowComposition.get(key) || 0) + 1);
  });

  // Calculate total possible arrangements
  const totalArrangements = calculateMultinomialCoefficient(n, Array.from(rowComposition.values()));

  const expectedRunsByGroup = new Map<string, Map<number, number>>();

  // For each group that has actual runs
  actualRunCounts.forEach((runLengthCounts, groupKey) => {
    const groupExpectedRuns = new Map<number, number>();

    // Calculate expected # of runs for each run length that was actually observed
    runLengthCounts.forEach((actualCount, runLength) => {
      const expectedCount = calculateExpectedRuns(rowComposition, groupKey, runLength, totalArrangements);
      groupExpectedRuns.set(runLength, expectedCount);
    });

    expectedRunsByGroup.set(groupKey, groupExpectedRuns);
  });

  return expectedRunsByGroup;
};

/*
 * Export for testing purposes
 */
export const calculateExpectedRunsByGroupForTest = ( rowKeys: string[] ): Map<string, Map<number, number>> => {
  // Track runs with their covariate groups
  const runs: Array<{ length: number; group: string; }> = getRunsByGroup(rowKeys);
  return calculateExpectedRunsByGroup(rowKeys, getRunCountsByGroup(runs));
};


/**
 * Calculate the expected number of runs using combinatorial gap analysis
 * 1. Separate non-target groups and calculate their arrangements
 * 2. Calculate gaps between non-target slots
 * 3. Choose which gaps will have runs of given size
 * 4. Place remaining target members in remaining gaps
 *
 * Exported for testing
 */
export const calculateExpectedRuns = (
  composition: Map<string, number>,
  targetGroup: string,
  runLength: number,
  totalArrangements: number
): number => {
  // Calculate n (total sequence length)
  const n = Array.from(composition.values()).reduce((sum, count) => sum + count, 0);
  // Get the target group size
  const groupSize = composition.get(targetGroup) || 0;

  if (groupSize < runLength) return 0;
  if (runLength < 2) return 0;

  // Step 1: Separate target group from non-target groups
  const nonTargetGroups = new Map<string, number>();
  let totalNonTargetSize = 0;

  composition.forEach((size, group) => {
    if (group !== targetGroup) {
      nonTargetGroups.set(group, size);
      totalNonTargetSize += size;
    }
  });

  if (totalNonTargetSize === 0) {
    // All samples are from target group - special case
    // Expected runs = total possible runs of this length
    return Math.max(0, n - runLength + 1);
  }

  // Step 2: Calculate total arrangements of non-target groups
  // n! / (a1! * a2! * ...)
  const nonTargetArrangements = calculateMultinomialCoefficient(totalNonTargetSize, Array.from(nonTargetGroups.values()));

  // Step 3: Calculate number of gaps between non-target slots
  // Non-target elements create (totalNonTargetSize + 1) gaps where target elements can go
  const totalGaps = totalNonTargetSize + 1;

  // Step 4: Calculate maximum number of runs of given size we can have
  const maxRunsOfThisSize = Math.floor(groupSize / runLength);

  let totalExpectedRuns = 0;

  // Step 5: For each possible number of runs (r = 1, 2,...) of the given size
  for (let r = 1; r <= maxRunsOfThisSize; r++) {
    if (r > totalGaps) break; // Can't have more runs than gaps

    // Ways to choose which gaps will have runs of the given size
    const waysToChooseGaps = combination(totalGaps, r);

    // Remaining target group members after using r runs of runLength
    const remainingTargetMembers = groupSize - (r * runLength);

    // Remaining gaps after placing r runs
    const remainingGaps = totalGaps - r;

    if (remainingTargetMembers >= 0 && remainingGaps >= 0) {
      // Ways to distribute remaining target members in remaining gaps
      // (they can form runs of any other size, including size 1)
      const waysToDistributeRemaining = calculateWaysToDistributeInGaps(remainingTargetMembers, remainingGaps);

      // Total arrangements with exactly r runs of the specified length
      const arrangementsWithRRuns = nonTargetArrangements * waysToChooseGaps * waysToDistributeRemaining;

      // Expected number of runs of this length in this configuration
      const expectedRunsForThisR = r * arrangementsWithRRuns;

      totalExpectedRuns += expectedRunsForThisR;

      console.log(`  r=${r}: gaps=${waysToChooseGaps}, remaining=${waysToDistributeRemaining}, arrangements=${arrangementsWithRRuns}, expected=${expectedRunsForThisR}`);
    }
  }

  // Return expected number of runs
  return totalExpectedRuns / totalArrangements;
};

/**
 * Calculate multinomial coefficient: n! / (k1! * k2! * ... * km!)
 */
export const calculateMultinomialCoefficient = (n: number, groups: number[]): number => {
  let result = factorial(n);
  groups.forEach(groupSize => {
    result /= factorial(groupSize);
  });
  return result;
};

/**
 * Calculate ways to distribute items in gaps (stars and bars problem)
 *
 * NOTE: This is an APPROXIMATION. It doesn't exclude distributions where
 * remaining items form additional runs of the target length.
 * For example, if checking for runs of length 2, a gap with exactly 2 items
 * would form another run, but this is counted here.
 *
 * This means expected run counts may be slightly overestimated.
 */
const calculateWaysToDistributeInGaps = (items: number, gaps: number): number => {
  if (items === 0) return 1; // One way to distribute zero items
  if (gaps === 0) return items === 0 ? 1 : 0; // Can only distribute zero items in zero gaps

  // Stars and bars: C(items + gaps - 1, gaps - 1)
  return combination(items + gaps - 1, gaps - 1);
};

/**
 * Calculate factorial with caching for performance
 */
const factorialCache = new Map<number, number>();
const factorial = (n: number): number => {
  if (n <= 1) return 1;
  if (factorialCache.has(n)) return factorialCache.get(n)!;

  const result = n * factorial(n - 1);
  factorialCache.set(n, result);
  return result;
};

/**
 * Calculate combination (n choose k)
 */
const combination = (n: number, k: number): number => {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;

  return factorial(n) / (factorial(k) * factorial(n - k));
};


/**
 * Count actual runs by group and length
 */
const getRunCountsByGroup = (runs: Array<{ length: number; group: string }>): Map<string, Map<number, number>> => {
  const countsByGroup = new Map<string, Map<number, number>>();

  runs.forEach(run => {
    if (!countsByGroup.has(run.group)) {
      countsByGroup.set(run.group,
        new Map<number, number>()); // Run length -> number of runs of the length
    }
    const groupCounts = countsByGroup.get(run.group)!;
    groupCounts.set(run.length, (groupCounts.get(run.length) || 0) + 1);
  });

  return countsByGroup;
};

const calculateRowScore = (rowKeys: string[]): number => {

  if (rowKeys.length <= 3) return 100;

  // Track runs with their covariate groups
  const runs: Array<{ length: number; group: string; }> = getRunsByGroup(rowKeys);

  const filteredRuns = runs.filter(run => run.length > 1); // Remove runs of size 1
  console.log(`Runs: ${filteredRuns.map(r => `${r.group}:${r.length}`).join(', ')}`);

  if (filteredRuns.length === 0) return 100;

  const actualRunCountsByGroup = getRunCountsByGroup(filteredRuns);

  // Calculate expected runs for the specific group-runLength combinations that occurred
  const expectedRunsByGroup = calculateExpectedRunsByGroup(rowKeys, actualRunCountsByGroup);

  let totalPenalty = 0;

  // Compare actual vs expected runs for each group and length
  actualRunCountsByGroup.forEach((groupRunCounts, groupKey) => {
    const expectedGroupRuns = expectedRunsByGroup.get(groupKey) || new Map<number, number>();

    groupRunCounts.forEach((actualCount, runLength) => {
      const expectedCount = expectedGroupRuns.get(runLength) || 0;
      const excess = Math.max(0, actualCount - expectedCount);

      if (excess > 0) {
        // Penalty based on how much we exceed expectation for this specific group
        // Longer runs get higher base penalty, scaled by excess
        const basePenalty = Math.pow(runLength, 1.5) * 10; // Base penalty increases with run length
        const excessPenalty = excess * basePenalty;

        console.log(`  Group ${groupKey}, run length ${runLength}: expected ${expectedCount.toFixed(2)}, actual ${actualCount}, excess ${excess.toFixed(2)}, penalty ${excessPenalty.toFixed(2)}`);
        totalPenalty += excessPenalty;
      }
    });
  });
  console.log(`Total Penalty: ${totalPenalty.toFixed(2)}`);
  const score = (100 - totalPenalty);

  // Convert to score (0-100).  If no penalty score is 100.  If penalty is high, score is 0
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate plate diversity metrics (Balance + Randomization + Row Clustering scores)
 */
export const calculatePlateDiversityMetrics = (
  searches: SearchData[],
  plateAssignments: Map<number, SearchData[]>,
  randomizedPlates: (SearchData | undefined)[][][],
  selectedCovariates: string[],
  displayConfig: QualityDisplayConfig = DEFAULT_QUALITY_DISPLAY_CONFIG
): PlateDiversityMetrics => {
  if (!searches.length || !plateAssignments.size || !selectedCovariates.length) {
    return {
      averageBalanceScore: 0,
      averageClusteringScore: 0,
      averageRowClusteringScore: 0,
      plateScores: []
    };
  }

  const combinationGroups = groupByCovariates(searches, selectedCovariates);
  const plateScores: PlateQualityScore[] = [];

  // Convert combination groups to counts for balance calculation
  const globalCombinationCounts = new Map<string, number>();
  combinationGroups.forEach((samples, combination) => {
    globalCombinationCounts.set(combination, samples.length);
  });

  plateAssignments.forEach((plateSamples, plateIndex) => {
    // Calculate comprehensive balance metrics (both overall score and group details)
    const plateBalance = calculatePlateBalance(plateSamples, searches, selectedCovariates);

    // Calculate randomization score (spatial clustering) if enabled
    const plateRows = randomizedPlates[plateIndex] || [];
    const rowClusteringResult = displayConfig.showRowScore
      ? calculateRowClusteringScore(plateRows)
      : { averageScore: 0, rowScores: [] };

    // Calculate spatial clustering score if enabled
    const clusteringScore = displayConfig.showClusteringScore
      ? calculateClusteringScore(plateRows, plateRows.length, plateRows[0]?.length || 12)
      : 0;

    // Calculate overall score based on display configuration
    const overallScore = displayConfig.showRowScore
      ? (plateBalance.overallScore + rowClusteringResult.averageScore) / 2
      : plateBalance.overallScore;

    plateScores.push({
      plateIndex,
      balanceScore: plateBalance.overallScore,
      clusteringScore: clusteringScore,
      rowClusteringScore: rowClusteringResult.averageScore,
      rowScores: rowClusteringResult.rowScores,
      overallScore,
      covariateGroupBalance: plateBalance.groupDetails
    });
  });

  const averageBalanceScore = calculateMean(plateScores.map(score => score.balanceScore));
  const averageClusteringScore = displayConfig.showClusteringScore
    ? calculateMean(plateScores.map(score => score.clusteringScore))
    : 0;
  const averageRowClusteringScore = displayConfig.showRowScore
    ? calculateMean(plateScores.map(score => score.rowClusteringScore))
    : 0;

  return {
    averageBalanceScore,
    averageClusteringScore,
    averageRowClusteringScore,
    plateScores
  };
};

/**
 * Calculate overall quality assessment
 */
export const calculateOverallQuality = (
  plateDiversity: PlateDiversityMetrics,
  displayConfig: QualityDisplayConfig = DEFAULT_QUALITY_DISPLAY_CONFIG
): OverallQualityAssessment => {
  const recommendations: string[] = [];

  // Calculate overall score based on display configuration
  let scoreCount = 1;
  let totalScore = plateDiversity.averageBalanceScore;
  if (displayConfig.showClusteringScore)
  {
    scoreCount++;
    totalScore += plateDiversity.averageClusteringScore;
  }
  if (displayConfig.showRowScore)
  {
    totalScore++;
    totalScore += plateDiversity.averageRowClusteringScore;
  }
  const overallScore = totalScore / scoreCount;

  // Determine quality level using utility function
  const level = getQualityLevel(overallScore);

  return {
    score: Math.round(overallScore * 10) / 10, // Round to 1 decimal place
    level,
    recommendations
  };
};

/**
 * Main function to calculate all quality metrics
 */
export const calculateQualityMetrics = (
  searches: SearchData[],
  plateAssignments: Map<number, SearchData[]>,
  randomizedPlates: (SearchData | undefined)[][][],
  selectedCovariates: string[],
  displayConfig: QualityDisplayConfig = DEFAULT_QUALITY_DISPLAY_CONFIG
): QualityMetrics => {
  const plateDiversity = calculatePlateDiversityMetrics(
    searches,
    plateAssignments,
    randomizedPlates,
    selectedCovariates,
    displayConfig
  );

  const overallQuality = calculateOverallQuality(plateDiversity, displayConfig);

  return {
    plateDiversity,
    overallQuality
  };
};

function getRunsByGroup(rowKeys: string[]) {
  const runs: Array<{ length: number; group: string; }> = [];
  let currentRun = 1;
  let currentGroup = rowKeys[0];

  for (let i = 1; i < rowKeys.length; i++) {
    if (rowKeys[i] !== rowKeys[i - 1]) {
      // End of current run
      runs.push({ length: currentRun, group: currentGroup });
      currentRun = 1;
      currentGroup = rowKeys[i];
    } else {
      currentRun++;
    }

    if (i === rowKeys.length - 1) {
      // End of sequence
      runs.push({ length: currentRun, group: currentGroup });
    }
  }
  return runs;
}
