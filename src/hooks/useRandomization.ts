import { useState } from 'react';
import { SearchData, RandomizationAlgorithm, RepeatedMeasuresConfig } from '../utils/types';
import { randomizeSearches } from '../utils/utils';
import { greedyPlaceInRow } from '../algorithms/greedySpatialPlacement';
import { groupAwareRandomization } from '../algorithms/repeatedMeasuresDistribution';

export function useRandomization() {
  const [isProcessed, setIsProcessed] = useState<boolean>(false);
  const [randomizedPlates, setRandomizedPlates] = useState<(SearchData | undefined)[][][]>([]);
  const [plateAssignments, setPlateAssignments] = useState<Map<number, SearchData[]> | undefined>(undefined);

  const processRandomization = (
    searches: SearchData[],
    selectedCovariates: string[],
    selectedAlgorithm: RandomizationAlgorithm,
    keepEmptyInLastPlate: boolean,
    plateRows: number,
    plateColumns: number,
    repeatedMeasuresConfig?: RepeatedMeasuresConfig
  ) => {
    if (searches.length > 0 && selectedCovariates.length > 0) {
      const result = randomizeSearches(
        searches,
        selectedCovariates,
        selectedAlgorithm,
        keepEmptyInLastPlate,
        plateRows,
        plateColumns,
        repeatedMeasuresConfig
      );
      setRandomizedPlates(result.plates);
      setPlateAssignments(result.plateAssignments);
      setIsProcessed(true);
      return true;
    }
    return false;
  };

  const reRandomize = (
    searches: SearchData[],
    selectedCovariates: string[],
    selectedAlgorithm: RandomizationAlgorithm,
    keepEmptyInLastPlate: boolean,
    plateRows: number,
    plateColumns: number,
    repeatedMeasuresConfig?: RepeatedMeasuresConfig
  ) => {
    if (searches.length > 0 && selectedCovariates.length > 0) {
      const result = randomizeSearches(
        searches,
        selectedCovariates,
        selectedAlgorithm,
        keepEmptyInLastPlate,
        plateRows,
        plateColumns,
        repeatedMeasuresConfig
      );
      setRandomizedPlates(result.plates);
      setPlateAssignments(result.plateAssignments);
    }
  };

  const resetRandomization = () => {
    setIsProcessed(false);
    setRandomizedPlates([]);
    setPlateAssignments(undefined);
  };

  const updatePlates = (
    fromPlate: number,
    fromRow: number,
    fromCol: number,
    toPlate: number,
    toRow: number,
    toCol: number
  ) => {
    const updatedRandomizedPlates = [...randomizedPlates];
    const sourceSearch = updatedRandomizedPlates[fromPlate][fromRow][fromCol];
    const targetSearch = updatedRandomizedPlates[toPlate][toRow][toCol];

    // Swap positions in plates
    updatedRandomizedPlates[fromPlate][fromRow][fromCol] = targetSearch;
    updatedRandomizedPlates[toPlate][toRow][toCol] = sourceSearch;

    // Update plateAssignments if it exists
    if (plateAssignments) {
      const updatedPlateAssignments = new Map(plateAssignments);

      // If swapping between different plates, update the assignments
      if (fromPlate !== toPlate) {
        const fromPlateSearches = updatedPlateAssignments.get(fromPlate) || [];
        const toPlateSearches = updatedPlateAssignments.get(toPlate) || [];

        // Remove and add searches to maintain correct plate assignments
        if (sourceSearch) {
          const sourceIndex = fromPlateSearches.findIndex(s => s.name === sourceSearch.name);
          if (sourceIndex !== -1) {
            fromPlateSearches.splice(sourceIndex, 1);
            toPlateSearches.push(sourceSearch);
          }
        }

        if (targetSearch) {
          const targetIndex = toPlateSearches.findIndex(s => s.name === targetSearch.name);
          if (targetIndex !== -1) {
            toPlateSearches.splice(targetIndex, 1);
            fromPlateSearches.push(targetSearch);
          }
        }

        updatedPlateAssignments.set(fromPlate, fromPlateSearches);
        updatedPlateAssignments.set(toPlate, toPlateSearches);
      }
      // If swapping within the same plate, no need to update plateAssignments
      // as the searches remain on the same plate

      setPlateAssignments(updatedPlateAssignments);
    }

    setRandomizedPlates(updatedRandomizedPlates);
  };

  const reRandomizeSinglePlate = (
    plateIndex: number,
    searches: SearchData[],
    selectedCovariates: string[],
    selectedAlgorithm: RandomizationAlgorithm,
    keepEmptyInLastPlate: boolean,
    plateRows: number,
    plateColumns: number,
    repeatedMeasuresConfig?: RepeatedMeasuresConfig
  ) => {
    if (!plateAssignments) return false;

    const updatedRandomizedPlates = [...randomizedPlates];
    const currentPlate = updatedRandomizedPlates[plateIndex];

    if (!currentPlate || currentPlate.length === 0) return false;

    const plateSamples = plateAssignments.get(plateIndex) || [];
    if (plateSamples.length === 0) return false;

    if (selectedAlgorithm === 'balanced') {
      // When grouping constraint is active, use groupAwareRandomization on just the plate's samples
      if (repeatedMeasuresConfig?.subjectColumn) {
        console.log(`Re-randomizing plate ${plateIndex + 1} using group-aware randomization`);

        const result = groupAwareRandomization(
          plateSamples,
          selectedCovariates,
          repeatedMeasuresConfig,
          false, // Don't keep empty in last plate for single-plate re-randomization
          plateRows,
          plateColumns
        );

        // The result should produce exactly 1 plate since we're passing just this plate's samples
        if (result.plates.length > 0) {
          updatedRandomizedPlates[plateIndex] = result.plates[0];
        }
      } else {
        // For balanced randomization without grouping: use row-level greedy spatial placement
        console.log(`Re-randomizing plate ${plateIndex + 1} using greedy spatial placement`);

        // Create a new empty plate
        const newPlate: (SearchData | undefined)[][] = Array(plateRows)
          .fill(null)
          .map(() => Array(plateColumns).fill(undefined));

        // Process each row using greedy placement
        currentPlate.forEach((row, rowIdx) => {
          // Get all non-undefined samples in this row
          const rowSamples = row.filter(sample => sample !== undefined) as SearchData[];

          if (rowSamples.length > 0) {
            // Use greedy spatial placement for this row
            greedyPlaceInRow(rowSamples, newPlate, rowIdx, plateColumns);
          }
        });

        updatedRandomizedPlates[plateIndex] = newPlate;
      }
    } else {
      // For other algorithms (greedy): shuffle the entire plate
      console.log(`Re-randomizing plate ${plateIndex + 1} using simple shuffling with ${plateSamples.length} samples`);

      // Create a new empty plate
      const newPlate: (SearchData | undefined)[][] = Array(plateRows)
        .fill(null)
        .map(() => Array(plateColumns).fill(undefined));

      // Shuffle all samples for this plate
      const shuffledSamples = [...plateSamples].sort(() => Math.random() - 0.5);

      // Fill the plate with shuffled samples
      let sampleIndex = 0;
      for (let row = 0; row < plateRows && sampleIndex < shuffledSamples.length; row++) {
        for (let col = 0; col < plateColumns && sampleIndex < shuffledSamples.length; col++) {
          newPlate[row][col] = shuffledSamples[sampleIndex];
          sampleIndex++;
        }
      }

      updatedRandomizedPlates[plateIndex] = newPlate;
    }

    setRandomizedPlates(updatedRandomizedPlates);
    return true;
  };

  return {
    isProcessed,
    randomizedPlates,
    plateAssignments,
    processRandomization,
    reRandomize,
    reRandomizeSinglePlate,
    resetRandomization,
    updatePlates,
  };
}