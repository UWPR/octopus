import { SearchData } from '../utils/types';
import { shuffleArray } from '../utils/utils';
import { debugLog } from '../utils/configs';

/**
 * Local helper to safely get covariate key from a sample (handles undefined)
 */
function getTreatmentKey(sample: SearchData | undefined): string | undefined {
  return sample?.covariateKey;
}

/**
 * Calculate a clustering score for placing a sample at a specific position.
 * Lower scores indicate better positions (less clustering).
 *
 * @param plate - The 2D grid of the current plate
 * @param rowIdx - Row index within the plate
 * @param colIdx - Column index within the row
 * @param treatmentKey - The covariate group key of the sample being placed
 * @param numColumns - Total number of columns per row
 * @returns Clustering score (lower is better)
 */
export function calculateClusterScore(
  plate: (SearchData | undefined)[][],
  rowIdx: number,
  colIdx: number,
  treatmentKey: string | undefined,
  numColumns: number
): number {
  let score = 0;

  // Check left neighbor (horizontal)
  if (colIdx > 0) {
    const leftSample = plate[rowIdx][colIdx - 1];
    if (getTreatmentKey(leftSample) === treatmentKey) {
      score += 10; // Heavy penalty for horizontal adjacency
    }
  }

  // Check right neighbor (horizontal) - may already be placed since we fill greedily
  if (colIdx < numColumns - 1) {
    const rightSample = plate[rowIdx][colIdx + 1];
    if (getTreatmentKey(rightSample) === treatmentKey) {
      score += 10; // Heavy penalty for horizontal adjacency
    }
  }

  // Check above neighbor (vertical)
  // Only check above since rows are filled sequentially (below is always empty)
  if (rowIdx > 0) {
    const aboveSample = plate[rowIdx - 1][colIdx];
    if (getTreatmentKey(aboveSample) === treatmentKey) {
      score += 10; // Heavy penalty for vertical adjacency
    }
  }

  // Cross-row constraint: check if this is the first column and matches the previous row's last column
  if (colIdx === 0 && rowIdx > 0) {
    const prevRowLastSample = plate[rowIdx - 1][numColumns - 1];
    if (getTreatmentKey(prevRowLastSample) === treatmentKey) {
      score += 8; // Medium-high penalty for cross-row adjacency
    }
  }

  return score;
}

/**
 * Place samples in a row using greedy spatial placement to minimize clustering.
 *
 * @param rowSamples - Array of samples to place in this row
 * @param plate - The 2D grid of the current plate (will be modified)
 * @param rowIdx - Row index within the plate
 * @param numColumns - Total number of columns per row
 * @param keepEmptyAtEnd - If true, empty spots are at the end; if false, distributed randomly
 */
export function greedyPlaceInRow(
  rowSamples: SearchData[],
  plate: (SearchData | undefined)[][],
  rowIdx: number,
  numColumns: number,
  keepEmptyAtEnd: boolean = true
): void {
  if (rowSamples.length === 0) return;

  // Shuffle samples first to add randomness when multiple positions have equal score
  const shuffledSamples = shuffleArray([...rowSamples]);

  // Track available positions in this row
  const availablePositions: number[] = [];
  if (keepEmptyAtEnd) {
    // Only use positions up to the number of samples - empty wells at the end
    for (let col = 0; col < rowSamples.length; col++) {
      availablePositions.push(col);
    }
  } else {
    // Use all columns - empty wells distributed randomly
    for (let col = 0; col < numColumns; col++) {
      availablePositions.push(col);
    }
  }

  // Place each sample one by one
  for (const sample of shuffledSamples) {
    if (availablePositions.length === 0) break;

    const treatmentKey = sample.covariateKey;

    // Score each available position
    const positionScores = availablePositions.map(col => ({
      col,
      score: calculateClusterScore(
        plate,
        rowIdx,
        col,
        treatmentKey,
        numColumns
      )
    }));

    // Find minimum score
    const minScore = Math.min(...positionScores.map(ps => ps.score));

    // Get all positions with minimum score
    const bestPositions = positionScores
      .filter(ps => ps.score === minScore)
      .map(ps => ps.col);

    // Randomly choose among best positions
    const chosenCol = bestPositions[Math.floor(Math.random() * bestPositions.length)];

    // Place the sample
    plate[rowIdx][chosenCol] = sample;

    // Remove chosen position from available positions
    const posIndex = availablePositions.indexOf(chosenCol);
    if (posIndex > -1) {
      availablePositions.splice(posIndex, 1);
    }

    debugLog(
      `Placed sample with treatment ${treatmentKey} at row ${rowIdx}, col ${chosenCol} (score: ${minScore})`
    );
  }
}

export interface PlateSpatialQuality {
  plateIndex: number;
  horizontalClusters: number;
  verticalClusters: number;
  crossRowClusters: number;
  totalClusters: number;
}

/**
 * Analyze the quality of spatial distribution in a single plate.
 * Returns metrics about clustering.
 *
 * @param plate - The 2D grid of a single plate
 * @param numRows - Total number of rows per plate
 * @param numColumns - Total number of columns per row
 * @returns Object with clustering metrics for the plate
 */
export function analyzePlateSpatialQuality(
  plate: (SearchData | undefined)[][],
  numRows: number,
  numColumns: number
): Omit<PlateSpatialQuality, 'plateIndex'> {
  let horizontalClusters = 0;
  let verticalClusters = 0;
  let crossRowClusters = 0;

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numColumns; col++) {
      const currentSample = plate[row][col];
      if (!currentSample) continue;

      const currentKey = getTreatmentKey(currentSample);

      // Check horizontal adjacency (right neighbor)
      if (col < numColumns - 1) {
        const rightSample = plate[row][col + 1];
        if (getTreatmentKey(rightSample) === currentKey) {
          horizontalClusters++;
        }
      }

      // Check vertical adjacency (below neighbor)
      if (row < numRows - 1) {
        const belowSample = plate[row + 1][col];
        if (getTreatmentKey(belowSample) === currentKey) {
          verticalClusters++;
        }
      }

      // Check cross-row adjacency (last column to first column of next row)
      if (col === numColumns - 1 && row < numRows - 1) {
        const nextRowFirstSample = plate[row + 1][0];
        if (getTreatmentKey(nextRowFirstSample) === currentKey) {
          crossRowClusters++;
        }
      }
    }
  }

  return {
    horizontalClusters,
    verticalClusters,
    crossRowClusters,
    totalClusters: horizontalClusters + verticalClusters + crossRowClusters
  };
}
