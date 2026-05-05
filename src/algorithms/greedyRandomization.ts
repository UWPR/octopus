import { SearchData } from '../utils/types';
import { shuffleArray } from '../utils/utils';

// Original greedy algorithm (refactored)
export function greedyRandomization(
    searches: SearchData[], 
    selectedCovariates: string[]): {
    plates: (SearchData | undefined)[][][];
    plateAssignments?: Map<number, SearchData[]>;
} {
    const platesNeeded = Math.ceil(searches.length / 96);
    let plates = Array.from({ length: platesNeeded }, () =>
        Array.from({ length: 8 }, () => new Array(12).fill(undefined))
    );

    let shuffledSearches = shuffleArray([...searches]);

    function searchCanBePlaced(search: SearchData, row: (SearchData | undefined)[], tolerance: number): boolean {
        const searchCovariates = selectedCovariates.map(cov => search.metadata[cov]);
        let duplicateCount = 0;

        for (const existingSearch of row) {
            if (existingSearch === undefined) continue;
            const existingSearchCovariates = selectedCovariates.map(cov => existingSearch.metadata[cov]);
            if (JSON.stringify(searchCovariates) === JSON.stringify(existingSearchCovariates)) {
                duplicateCount++;
            }
        }

        return duplicateCount <= tolerance;
    }

    // Place searches with increasing tolerance
    for (const search of shuffledSearches) {
        let placed = false;
        let tolerance = 0;

        while (!placed) {
            for (let p = 0; p < plates.length && !placed; p++) {
                for (let r = 0; r < plates[p].length && !placed; r++) {
                    if (searchCanBePlaced(search, plates[p][r], tolerance) && plates[p][r].includes(undefined)) {
                        const indexToPlace = plates[p][r].indexOf(undefined);
                        plates[p][r][indexToPlace] = search;
                        placed = true;
                    }
                }
            }

            if (!placed) tolerance++;
        }
    }

    //maximizeDissimilarity(plates, selectedCovariates);

    // Shuffle the order of searches within each row after all searches have been assigned
    for (let p = 0; p < plates.length; p++) {
        for (let r = 0; r < plates[p].length; r++) {
            plates[p][r] = shuffleArray(plates[p][r]);
        }
    }

    // Calculate plateAssignments by extracting samples from the 3D plates array
    const plateAssignments = new Map<number, SearchData[]>();
    plates.forEach((plate, plateIndex) => {
        const plateSamples: SearchData[] = [];
        plate.forEach(row => {
            row.forEach(cell => {
                if (cell !== undefined) {
                    plateSamples.push(cell);
                }
            });
        });
        plateAssignments.set(plateIndex, plateSamples);
    });

    return {
        plates,
        plateAssignments
    };
}
