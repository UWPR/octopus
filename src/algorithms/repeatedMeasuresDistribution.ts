import { SearchData, SubjectGroup, GroupingConstraint, GroupValidationResult } from '../utils/types';
import { shuffleArray } from '../utils/utils';

/**
 * Groups samples by the selected subject column value.
 * Samples with empty/missing subject column values become singletons (group size 1).
 * Returns an array of SubjectGroup objects.
 */
export function buildSubjectGroups(
  samples: SearchData[],
  subjectColumn: string
): SubjectGroup[] {
  const groupMap = new Map<string, SearchData[]>();
  const singletons: SubjectGroup[] = [];

  for (const sample of samples) {
    const subjectValue = sample.metadata[subjectColumn]?.trim() ?? '';

    if (subjectValue === '') {
      // Empty/missing subject column values become singletons
      singletons.push({
        subjectId: `__singleton_${singletons.length}`,
        samples: [sample],
        size: 1,
      });
    } else {
      if (!groupMap.has(subjectValue)) {
        groupMap.set(subjectValue, []);
      }
      groupMap.get(subjectValue)!.push(sample);
    }
  }

  const groups: SubjectGroup[] = [];
  groupMap.forEach((groupSamples, subjectId) => {
    groups.push({
      subjectId,
      samples: groupSamples,
      size: groupSamples.length,
    });
  });

  return [...groups, ...singletons];
}

/**
 * Validates that all subject groups fit within the chosen constraint level.
 * Checks each group size against row capacity (Same Row) or plate capacity (Same Plate).
 * Checks total sample count against total well capacity.
 * Returns GroupValidationResult with errors and warnings.
 */
export function validateSubjectGroups(
  groups: SubjectGroup[],
  constraint: GroupingConstraint,
  rowCapacity: number,
  plateCapacity: number,
  totalWellCapacity: number
): GroupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const totalSamples = groups.reduce((sum, g) => sum + g.size, 0);

  // Check total capacity
  if (totalSamples > totalWellCapacity) {
    errors.push(
      `Total samples (${totalSamples}) exceed available well capacity (${totalWellCapacity}).`
    );
  }

  // Check per-group capacity based on constraint level
  for (const group of groups) {
    if (constraint === 'same-row' && group.size > rowCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the row capacity of ${rowCapacity}. Reduce group size or switch to Same Plate constraint.`
      );
    }
    if (constraint === 'same-plate' && group.size > plateCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the plate capacity of ${plateCapacity}.`
      );
    }
  }

  // Warn if many singletons
  const singletonCount = groups.filter(g => g.subjectId.startsWith('__singleton_')).length;
  if (singletonCount > 0 && singletonCount > groups.length / 2) {
    warnings.push(
      `${singletonCount} out of ${groups.length} groups are singletons (empty subject ID). Consider checking your subject column selection.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculates a covariate imbalance score for a set of samples.
 * Lower score = better balance. The score is the sum of squared deviations
 * from the expected proportion for each covariate value.
 */
function covariateImbalanceScore(
  currentSamples: SearchData[],
  candidateSamples: SearchData[],
  selectedCovariates: string[]
): number {
  if (selectedCovariates.length === 0) return 0;

  const combined = [...currentSamples, ...candidateSamples];
  if (combined.length === 0) return 0;

  // Count occurrences of each covariate combination
  const counts = new Map<string, number>();
  for (const sample of combined) {
    const key = selectedCovariates.map(c => sample.metadata[c] ?? '').join('|');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Ideal: each covariate combination has equal proportion
  const total = combined.length;
  const numGroups = counts.size;
  if (numGroups <= 1) return 0;

  const expectedProportion = 1 / numGroups;
  let score = 0;
  counts.forEach(count => {
    const actualProportion = count / total;
    const deviation = actualProportion - expectedProportion;
    score += deviation * deviation;
  });

  return score;
}

/**
 * Sorts subject groups by size descending, shuffling groups of equal size
 * for randomness (first-fit-decreasing strategy).
 */
function sortGroupsByDescendingSize(groups: SubjectGroup[]): SubjectGroup[] {
  // Group by size
  const sizeMap = new Map<number, SubjectGroup[]>();
  for (const group of groups) {
    if (!sizeMap.has(group.size)) {
      sizeMap.set(group.size, []);
    }
    sizeMap.get(group.size)!.push(group);
  }

  // Sort sizes descending, shuffle within each size
  const sortedSizes = Array.from(sizeMap.keys()).sort((a, b) => b - a);
  const result: SubjectGroup[] = [];
  for (const size of sortedSizes) {
    result.push(...shuffleArray(sizeMap.get(size)!));
  }
  return result;
}

/**
 * Distributes subject groups to plates using first-fit-decreasing bin packing.
 *
 * - Sorts groups by size descending, shuffling equal-sized groups
 * - For each group, finds the plate with most remaining capacity that fits the group
 * - Among equal-capacity plates, prefers the one that improves treatment covariate balance
 * - After all multi-sample groups are placed, distributes singletons to fill remaining capacity
 *
 * @param groups - Subject groups to distribute (including singletons)
 * @param plateCapacities - Available capacity for each plate (array index = plate index)
 * @param selectedCovariates - Treatment covariate column names for balance scoring
 * @returns Map from plate index to array of SubjectGroups assigned to that plate
 * @throws Error if a group cannot fit in any plate
 */
export function distributeGroupsToPlates(
  groups: SubjectGroup[],
  plateCapacities: number[],
  selectedCovariates: string[]
): Map<number, SubjectGroup[]> {
  // Separate multi-sample groups from singletons
  const multiGroups = groups.filter(g => g.size > 1);
  const singletons = groups.filter(g => g.size === 1);

  // Sort multi-sample groups by size descending with randomized tie-breaking
  const sortedMultiGroups = sortGroupsByDescendingSize(multiGroups);

  // Initialize plate assignments and remaining capacities
  const plateAssignments = new Map<number, SubjectGroup[]>();
  const remainingCapacities = [...plateCapacities];
  for (let i = 0; i < plateCapacities.length; i++) {
    plateAssignments.set(i, []);
  }

  // Helper: get all samples currently assigned to a plate
  const getPlateSamples = (plateIdx: number): SearchData[] => {
    return plateAssignments.get(plateIdx)!.flatMap(g => g.samples);
  };

  // Place multi-sample groups using FFD
  for (const group of sortedMultiGroups) {
    // Find plates that can fit this group, sorted by remaining capacity descending
    const candidatePlates: { plateIdx: number; remaining: number }[] = [];
    for (let i = 0; i < remainingCapacities.length; i++) {
      if (remainingCapacities[i] >= group.size) {
        candidatePlates.push({ plateIdx: i, remaining: remainingCapacities[i] });
      }
    }

    if (candidatePlates.length === 0) {
      throw new Error(
        `Unable to fit all subject groups into available plates. ` +
        `Subject ${group.subjectId} (size ${group.size}) cannot fit in any plate. ` +
        `Add more plates or reduce group sizes.`
      );
    }

    // Sort candidates by remaining capacity descending
    candidatePlates.sort((a, b) => b.remaining - a.remaining);

    // Find the max remaining capacity
    const maxRemaining = candidatePlates[0].remaining;
    const tiedPlates = candidatePlates.filter(p => p.remaining === maxRemaining);

    let bestPlateIdx: number;
    if (tiedPlates.length === 1 || selectedCovariates.length === 0) {
      // No tie or no covariates to break tie — pick from tied plates randomly
      bestPlateIdx = shuffleArray(tiedPlates)[0].plateIdx;
    } else {
      // Break tie by covariate balance: pick the plate where adding this group
      // results in the lowest imbalance score
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedPlates) {
        const currentSamples = getPlateSamples(candidate.plateIdx);
        const score = covariateImbalanceScore(currentSamples, group.samples, selectedCovariates);
        if (score < bestScore) {
          bestScore = score;
          bestCandidates = [candidate.plateIdx];
        } else if (score === bestScore) {
          bestCandidates.push(candidate.plateIdx);
        }
      }
      // Randomize among equally-scored plates
      bestPlateIdx = shuffleArray(bestCandidates)[0];
    }

    plateAssignments.get(bestPlateIdx)!.push(group);
    remainingCapacities[bestPlateIdx] -= group.size;
  }

  // Distribute singletons to fill remaining capacity, preferring covariate balance
  const sortedSingletons = shuffleArray([...singletons]);
  for (const singleton of sortedSingletons) {
    // Find plates with remaining capacity
    const candidatePlates: { plateIdx: number; remaining: number }[] = [];
    for (let i = 0; i < remainingCapacities.length; i++) {
      if (remainingCapacities[i] >= 1) {
        candidatePlates.push({ plateIdx: i, remaining: remainingCapacities[i] });
      }
    }

    if (candidatePlates.length === 0) {
      throw new Error(
        `Unable to fit all samples into available plates. ` +
        `No remaining capacity for singleton sample.`
      );
    }

    // Sort by remaining capacity descending
    candidatePlates.sort((a, b) => b.remaining - a.remaining);
    const maxRemaining = candidatePlates[0].remaining;
    const tiedPlates = candidatePlates.filter(p => p.remaining === maxRemaining);

    let bestPlateIdx: number;
    if (tiedPlates.length === 1 || selectedCovariates.length === 0) {
      bestPlateIdx = shuffleArray(tiedPlates)[0].plateIdx;
    } else {
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedPlates) {
        const currentSamples = getPlateSamples(candidate.plateIdx);
        const score = covariateImbalanceScore(currentSamples, singleton.samples, selectedCovariates);
        if (score < bestScore) {
          bestScore = score;
          bestCandidates = [candidate.plateIdx];
        } else if (score === bestScore) {
          bestCandidates.push(candidate.plateIdx);
        }
      }
      bestPlateIdx = shuffleArray(bestCandidates)[0];
    }

    plateAssignments.get(bestPlateIdx)!.push(singleton);
    remainingCapacities[bestPlateIdx] -= 1;
  }

  return plateAssignments;
}


/**
 * Distributes subject groups to rows within a plate using first-fit-decreasing bin packing.
 *
 * - Sorts groups by size descending, shuffling equal-sized groups
 * - For each group, finds rows with enough remaining capacity
 * - Among candidate rows, prefers the row that improves treatment covariate balance
 * - After all multi-sample groups are placed, distributes singletons to fill remaining row capacity
 *
 * @param groups - Subject groups to distribute (including singletons)
 * @param rowCapacities - Available capacity for each row (array index = row index)
 * @param selectedCovariates - Treatment covariate column names for balance scoring
 * @returns Map from row index to array of SubjectGroups assigned to that row
 * @throws Error if a group cannot fit in any row
 */
export function distributeGroupsToRows(
  groups: SubjectGroup[],
  rowCapacities: number[],
  selectedCovariates: string[]
): Map<number, SubjectGroup[]> {
  // Separate multi-sample groups from singletons
  const multiGroups = groups.filter(g => g.size > 1);
  const singletons = groups.filter(g => g.size === 1);

  // Sort multi-sample groups by size descending with randomized tie-breaking
  const sortedMultiGroups = sortGroupsByDescendingSize(multiGroups);

  // Initialize row assignments and remaining capacities
  const rowAssignments = new Map<number, SubjectGroup[]>();
  const remainingCapacities = [...rowCapacities];
  for (let i = 0; i < rowCapacities.length; i++) {
    rowAssignments.set(i, []);
  }

  // Helper: get all samples currently assigned to a row
  const getRowSamples = (rowIdx: number): SearchData[] => {
    return rowAssignments.get(rowIdx)!.flatMap(g => g.samples);
  };

  // Place multi-sample groups using FFD
  for (const group of sortedMultiGroups) {
    // Find rows that can fit this group
    const candidateRows: { rowIdx: number; remaining: number }[] = [];
    for (let i = 0; i < remainingCapacities.length; i++) {
      if (remainingCapacities[i] >= group.size) {
        candidateRows.push({ rowIdx: i, remaining: remainingCapacities[i] });
      }
    }

    if (candidateRows.length === 0) {
      throw new Error(
        `Unable to fit all subject groups into available rows. ` +
        `Subject ${group.subjectId} (size ${group.size}) cannot fit in any row. ` +
        `Consider using Same Plate constraint instead.`
      );
    }

    // Sort candidates by remaining capacity descending
    candidateRows.sort((a, b) => b.remaining - a.remaining);

    // Find the max remaining capacity
    const maxRemaining = candidateRows[0].remaining;
    const tiedRows = candidateRows.filter(r => r.remaining === maxRemaining);

    let bestRowIdx: number;
    if (tiedRows.length === 1 || selectedCovariates.length === 0) {
      bestRowIdx = shuffleArray(tiedRows)[0].rowIdx;
    } else {
      // Break tie by covariate balance
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedRows) {
        const currentSamples = getRowSamples(candidate.rowIdx);
        const score = covariateImbalanceScore(currentSamples, group.samples, selectedCovariates);
        if (score < bestScore) {
          bestScore = score;
          bestCandidates = [candidate.rowIdx];
        } else if (score === bestScore) {
          bestCandidates.push(candidate.rowIdx);
        }
      }
      bestRowIdx = shuffleArray(bestCandidates)[0];
    }

    rowAssignments.get(bestRowIdx)!.push(group);
    remainingCapacities[bestRowIdx] -= group.size;
  }

  // Distribute singletons to fill remaining row capacity, preferring covariate balance
  const sortedSingletons = shuffleArray([...singletons]);
  for (const singleton of sortedSingletons) {
    const candidateRows: { rowIdx: number; remaining: number }[] = [];
    for (let i = 0; i < remainingCapacities.length; i++) {
      if (remainingCapacities[i] >= 1) {
        candidateRows.push({ rowIdx: i, remaining: remainingCapacities[i] });
      }
    }

    if (candidateRows.length === 0) {
      throw new Error(
        `Unable to fit all samples into available rows. ` +
        `No remaining capacity for singleton sample.`
      );
    }

    // Sort by remaining capacity descending
    candidateRows.sort((a, b) => b.remaining - a.remaining);
    const maxRemaining = candidateRows[0].remaining;
    const tiedRows = candidateRows.filter(r => r.remaining === maxRemaining);

    let bestRowIdx: number;
    if (tiedRows.length === 1 || selectedCovariates.length === 0) {
      bestRowIdx = shuffleArray(tiedRows)[0].rowIdx;
    } else {
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedRows) {
        const currentSamples = getRowSamples(candidate.rowIdx);
        const score = covariateImbalanceScore(currentSamples, singleton.samples, selectedCovariates);
        if (score < bestScore) {
          bestScore = score;
          bestCandidates = [candidate.rowIdx];
        } else if (score === bestScore) {
          bestCandidates.push(candidate.rowIdx);
        }
      }
      bestRowIdx = shuffleArray(bestCandidates)[0];
    }

    rowAssignments.get(bestRowIdx)!.push(singleton);
    remainingCapacities[bestRowIdx] -= 1;
  }

  return rowAssignments;
}

