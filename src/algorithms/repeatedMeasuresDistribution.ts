import { SearchData, SubjectGroup, GroupingConstraint, GroupValidationResult, RepeatedMeasuresConfig, BlockType } from '../utils/types';
import { shuffleArray, groupByCovariates } from '../utils/utils';
import { greedyPlaceInRow } from './greedySpatialPlacement';
import { distributeToBlocks, calculateExpectedMinimums } from './balancedRandomization';

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
 * from the global expected proportion for each covariate value.
 *
 * @param currentSamples - Samples already assigned to the row/plate
 * @param candidateSamples - Samples being considered for assignment
 * @param globalProportions - Map of covariateKey → proportion across ALL experimental samples
 */
export function covariateImbalanceScore(
  currentSamples: SearchData[],
  candidateSamples: SearchData[],
  globalProportions: Map<string, number>
): number {
  if (globalProportions.size <= 1) return 0;

  const combined = [...currentSamples, ...candidateSamples];
  if (combined.length === 0) return 0;

  // Count occurrences of each covariate key in the combined set
  const counts = new Map<string, number>();
  for (const sample of combined) {
    const key = sample.covariateKey ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = combined.length;
  let score = 0;
  globalProportions.forEach((expectedProportion, key) => {
    const actualProportion = (counts.get(key) ?? 0) / total;
    const deviation = actualProportion - expectedProportion;
    score += deviation * deviation;
  });

  return score;
}

/**
 * Computes the global proportion of each covariate key across all samples.
 * Returns a Map of covariateKey → proportion (count / total).
 */
export function computeGlobalProportions(samples: SearchData[]): Map<string, number> {
  if (samples.length === 0) return new Map();
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = sample.covariateKey ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = samples.length;
  const proportions = new Map<string, number>();
  counts.forEach((count, key) => {
    proportions.set(key, count / total);
  });
  return proportions;
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
 * @param globalProportions - Map of covariateKey → proportion across all experimental samples
 * @returns Map from plate index to array of SubjectGroups assigned to that plate
 * @throws Error if a group cannot fit in any plate
 */
export function distributeGroupsToPlates(
  groups: SubjectGroup[],
  plateCapacities: number[],
  globalProportions: Map<string, number>
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
    if (tiedPlates.length === 1 || globalProportions.size === 0) {
      // No tie or no covariates to break tie — pick from tied plates randomly
      bestPlateIdx = shuffleArray(tiedPlates)[0].plateIdx;
    } else {
      // Break tie by covariate balance: pick the plate where adding this group
      // results in the lowest imbalance score
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedPlates) {
        const currentSamples = getPlateSamples(candidate.plateIdx);
        const score = covariateImbalanceScore(currentSamples, group.samples, globalProportions);
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
    if (tiedPlates.length === 1 || globalProportions.size === 0) {
      bestPlateIdx = shuffleArray(tiedPlates)[0].plateIdx;
    } else {
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedPlates) {
        const currentSamples = getPlateSamples(candidate.plateIdx);
        const score = covariateImbalanceScore(currentSamples, singleton.samples, globalProportions);
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
 * @param globalProportions - Map of covariateKey → proportion across all experimental samples
 * @returns Map from row index to array of SubjectGroups assigned to that row
 * @throws Error if a group cannot fit in any row
 */
export function distributeGroupsToRows(
  groups: SubjectGroup[],
  rowCapacities: number[],
  globalProportions: Map<string, number>
): Map<number, SubjectGroup[]> {
  // Separate multi-sample groups from singletons
  const multiGroups = groups.filter(g => g.size > 1);
  const singletons = groups.filter(g => g.size === 1);

  // Early feasibility checks with informative error messages
  const maxRowCap = Math.max(...rowCapacities);
  const oversizedGroup = multiGroups.find(g => g.size > maxRowCap);
  if (oversizedGroup) {
    throw new Error(
      `Subject ${oversizedGroup.subjectId} has ${oversizedGroup.size} samples, ` +
      `but the largest row only has ${maxRowCap} available slots (after QC allocation). ` +
      `Try using Same Plate constraint, increasing the plate size, or reducing QC samples.`
    );
  }

  const totalMultiGroupSamples = multiGroups.reduce((sum, g) => sum + g.size, 0);
  const totalCapacity = rowCapacities.reduce((sum, c) => sum + c, 0);
  const totalSamples = totalMultiGroupSamples + singletons.length;
  if (totalSamples > totalCapacity) {
    throw new Error(
      `Total samples (${totalSamples}) exceed total row capacity (${totalCapacity}). ` +
      `Try increasing the plate size or adding more plates.`
    );
  }

  // Check if there are enough row "slots" for all multi-sample groups.
  // Each row can hold at most floor(capacity / groupSize) groups of a given size.
  const groupsBySize = new Map<number, number>();
  for (const g of multiGroups) {
    groupsBySize.set(g.size, (groupsBySize.get(g.size) ?? 0) + 1);
  }
  for (const [groupSize, groupCount] of Array.from(groupsBySize.entries())) {
    const totalSlots = rowCapacities.reduce((sum, cap) => sum + Math.floor(cap / groupSize), 0);
    if (groupCount > totalSlots) {
      throw new Error(
        `Cannot fit ${groupCount} subject groups of size ${groupSize} into the available rows. ` +
        `The rows can hold at most ${totalSlots} groups of this size (max ${Math.floor(maxRowCap / groupSize)} per row). ` +
        `Try using Same Plate constraint, increasing the plate size, or reducing QC samples.`
      );
    }
  }

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

  // Attempt greedy FFD placement; fall back to backtracking if it fails
  let greedySucceeded = true;
  try {
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
      if (tiedRows.length === 1 || globalProportions.size === 0) {
        bestRowIdx = shuffleArray(tiedRows)[0].rowIdx;
      } else {
        // Break tie by covariate balance
        let bestScore = Infinity;
        let bestCandidates: number[] = [];
        for (const candidate of tiedRows) {
          const currentSamples = getRowSamples(candidate.rowIdx);
          const score = covariateImbalanceScore(currentSamples, group.samples, globalProportions);
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
  } catch (greedyError) {
    // Greedy FFD failed — attempt backtracking fallback
    greedySucceeded = false;

    // Reset row assignments and capacities for the backtracking attempt
    for (let i = 0; i < rowCapacities.length; i++) {
      rowAssignments.set(i, []);
    }
    for (let i = 0; i < rowCapacities.length; i++) {
      remainingCapacities[i] = rowCapacities[i];
    }

    // Backtracking bin-packing search
    const btGroups = sortGroupsByDescendingSize(multiGroups);
    const assignment: number[] = new Array(btGroups.length).fill(-1);
    const btCapacities = [...rowCapacities];
    const ITERATION_LIMIT = 100_000;
    let iterations = 0;

    // Precompute suffix sums of group sizes for feasibility pruning
    const suffixSums = new Array(btGroups.length + 1).fill(0);
    for (let i = btGroups.length - 1; i >= 0; i--) {
      suffixSums[i] = suffixSums[i + 1] + btGroups[i].size;
    }

    const backtrack = (idx: number): boolean => {
      if (idx === btGroups.length) return true; // all groups placed
      const groupSize = btGroups[idx].size;

      // Feasibility prune: remaining total capacity must fit remaining groups
      const totalRemainingCap = btCapacities.reduce((s, c) => s + c, 0);
      if (totalRemainingCap < suffixSums[idx]) return false;

      // Track which capacity values we've already tried to prune symmetric rows
      const triedCapacities = new Set<number>();
      for (let r = 0; r < btCapacities.length; r++) {
        if (++iterations > ITERATION_LIMIT) return false;
        if (btCapacities[r] < groupSize) continue;
        // Prune: skip rows with identical remaining capacity (symmetric)
        if (triedCapacities.has(btCapacities[r])) continue;
        triedCapacities.add(btCapacities[r]);

        btCapacities[r] -= groupSize;
        assignment[idx] = r;
        if (backtrack(idx + 1)) return true;
        btCapacities[r] += groupSize;
        assignment[idx] = -1;
      }
      return false;
    };

    if (!backtrack(0)) {
      // Backtracking also failed — throw the original greedy error
      throw greedyError;
    }

    // Rebuild rowAssignments and remainingCapacities from backtracking solution
    for (let i = 0; i < rowCapacities.length; i++) {
      rowAssignments.set(i, []);
      remainingCapacities[i] = rowCapacities[i];
    }
    for (let i = 0; i < btGroups.length; i++) {
      const rowIdx = assignment[i];
      rowAssignments.get(rowIdx)!.push(btGroups[i]);
      remainingCapacities[rowIdx] -= btGroups[i].size;
    }
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
    if (tiedRows.length === 1 || globalProportions.size === 0) {
      bestRowIdx = shuffleArray(tiedRows)[0].rowIdx;
    } else {
      let bestScore = Infinity;
      let bestCandidates: number[] = [];
      for (const candidate of tiedRows) {
        const currentSamples = getRowSamples(candidate.rowIdx);
        const score = covariateImbalanceScore(currentSamples, singleton.samples, globalProportions);
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

/**
 * Distributes `count` items across `numBuckets` buckets proportionally.
 * Each bucket gets floor(count / numBuckets). Remainder is distributed
 * one-per-bucket to randomly selected buckets.
 *
 * @returns Array of length numBuckets with the count allocated to each.
 */
function distributeProportionally(count: number, numBuckets: number): number[] {
  const base = Math.floor(count / numBuckets);
  const remainder = count % numBuckets;
  const result = new Array(numBuckets).fill(base);

  // Distribute remainder one-per-bucket to randomly selected buckets
  const indices = shuffleArray(Array.from({ length: numBuckets }, (_, i) => i));
  for (let i = 0; i < remainder; i++) {
    result[indices[i]] += 1;
  }

  return result;
}

/**
 * Distributes QC samples proportionally by covariateKey across plates and rows.
 *
 * For each QC covariate group:
 *   - Plate level: each plate gets floor(groupCount / numPlates), remainder
 *     distributed randomly (one extra per plate).
 *   - Row level: within each plate, each row gets floor(plateAlloc / numRows),
 *     remainder distributed randomly (one extra per row).
 *
 * @param qcSamples - All QC samples (isQC === true), already shuffled
 * @param numPlates - Number of plates
 * @param numRows - Number of rows per plate
 * @returns 3D array [plate][row] → SearchData[] of QC samples assigned to that slot
 */
export function distributeQcByCovariate(
  qcSamples: SearchData[],
  numPlates: number,
  numRows: number
): SearchData[][][] {
  // Initialize empty 3D structure
  const result: SearchData[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: numRows }, () => [])
  );

  if (qcSamples.length === 0) return result;

  // Group QC samples by covariateKey (undefined/empty → "")
  const groups = new Map<string, SearchData[]>();
  for (const sample of qcSamples) {
    const key = sample.covariateKey || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sample);
  }

  // For each covariate group, distribute across plates then rows
  groups.forEach((groupSamples) => {
    const plateCounts = distributeProportionally(groupSamples.length, numPlates);

    let sampleIdx = 0;
    for (let p = 0; p < numPlates; p++) {
      const rowCounts = distributeProportionally(plateCounts[p], numRows);
      for (let r = 0; r < numRows; r++) {
        for (let q = 0; q < rowCounts[r]; q++) {
          result[p][r].push(groupSamples[sampleIdx++]);
        }
      }
    }
  });

  return result;
}


/**
 * Top-level entry point for group-aware randomization.
 *
 * Separates QC samples from experimental samples, pre-allocates QC slots per row
 * (even distribution), calculates effective row/plate capacities, then calls
 * distributeGroupsToPlates and distributeGroupsToRows per plate.
 * Uses greedyPlaceInRow for column placement within each row.
 *
 * Returns { plates, plateAssignments } matching the existing return type.
 */
export function groupAwareRandomization(
  searches: SearchData[],
  selectedCovariates: string[],
  repeatedMeasuresConfig: RepeatedMeasuresConfig,
  keepEmptyInLastPlate: boolean,
  numRows: number,
  numColumns: number
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments?: Map<number, SearchData[]>;
} {
  const { subjectColumn, groupingConstraint } = repeatedMeasuresConfig;

  if (!subjectColumn) {
    throw new Error('groupAwareRandomization requires a subjectColumn to be set');
  }

  const totalSamples = searches.length;
  const plateSize = numRows * numColumns;
  const numPlates = Math.ceil(totalSamples / plateSize);

  console.log(`Starting group-aware randomization for ${totalSamples} samples, ` +
    `${numPlates} plate(s), constraint: ${groupingConstraint}`);

  // Step 1: Separate QC samples from experimental samples and distribute by covariate
  const qcSamples = shuffleArray(searches.filter(s => s.isQC === true));
  const experimentalSamples = searches.filter(s => s.isQC !== true);

  console.log(`QC samples: ${qcSamples.length}, Experimental samples: ${experimentalSamples.length}`);

  // Ensure covariateKey is set on experimental samples (needed for groupByCovariates in same-plate branch)
  for (const sample of experimentalSamples) {
    if (!sample.covariateKey && selectedCovariates.length > 0) {
      sample.covariateKey = selectedCovariates.map(cov => sample.metadata[cov] || 'N/A').join('|');
    }
  }

  // Distribute QC samples proportionally by covariateKey across plates and rows
  const qcPerPlateRow = distributeQcByCovariate(qcSamples, numPlates, numRows);

  // Step 2: Build subject groups from experimental samples
  const subjectGroups = buildSubjectGroups(experimentalSamples, subjectColumn);

  // Step 4: Calculate effective capacities (subtract covariate-aware QC allocations)
  // Effective row capacity = numColumns - qcPerPlateRow[p][r].length
  // Effective plate capacity = sum of effective row capacities for that plate
  const effectivePlateCapacities: number[] = [];
  const effectiveRowCapacitiesPerPlate: number[][] = [];

  for (let p = 0; p < numPlates; p++) {
    const rowCaps: number[] = [];
    let plateCap = 0;
    for (let r = 0; r < numRows; r++) {
      const effectiveRowCap = numColumns - qcPerPlateRow[p][r].length;
      rowCaps.push(effectiveRowCap);
      plateCap += effectiveRowCap;
    }
    effectiveRowCapacitiesPerPlate.push(rowCaps);
    effectivePlateCapacities.push(plateCap);
  }

  // If keepEmptyInLastPlate, reduce last plate's effective capacity
  // to only what's needed for remaining experimental samples
  const totalExperimental = experimentalSamples.length;
  if (keepEmptyInLastPlate && numPlates > 1) {
    const capacityBeforeLast = effectivePlateCapacities.slice(0, numPlates - 1)
      .reduce((sum, c) => sum + c, 0);
    const remainingForLast = Math.max(0, totalExperimental - capacityBeforeLast);
    if (remainingForLast < effectivePlateCapacities[numPlates - 1]) {
      effectivePlateCapacities[numPlates - 1] = remainingForLast;
    }
  }

  console.log(`Effective plate capacities: [${effectivePlateCapacities.join(', ')}]`);

  // Step 5: Compute global proportions for covariate balance scoring
  const globalProportions = selectedCovariates.length > 0
    ? computeGlobalProportions(experimentalSamples)
    : new Map<string, number>();

  // Step 6: Distribute subject groups to plates
  const plateGroupAssignments = distributeGroupsToPlates(
    subjectGroups,
    effectivePlateCapacities,
    globalProportions
  );

  // Step 7: Initialize plate data structures
  const plates: (SearchData | undefined)[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: numRows }, () => new Array(numColumns).fill(undefined))
  );
  const plateAssignments = new Map<number, SearchData[]>();

  // Step 8: For each plate, distribute groups to rows, then place in columns
  for (let plateIdx = 0; plateIdx < numPlates; plateIdx++) {
    const plateGroups = plateGroupAssignments.get(plateIdx) ?? [];
    const allPlateSamples: SearchData[] = [];

    if (groupingConstraint === 'same-row') {
      // Row-level distribution: groups must stay in the same row
      const rowGroupAssignments = distributeGroupsToRows(
        plateGroups,
        effectiveRowCapacitiesPerPlate[plateIdx],
        globalProportions
      );

      // Place samples in each row
      for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
        const rowGroups = rowGroupAssignments.get(rowIdx) ?? [];
        const rowSamples = rowGroups.flatMap(g => g.samples);
        const qcForRow = qcPerPlateRow[plateIdx][rowIdx];
        const allRowSamples = [...rowSamples, ...qcForRow];

        allPlateSamples.push(...allRowSamples);

        greedyPlaceInRow(
          allRowSamples,
          plates[plateIdx],
          rowIdx,
          numColumns,
          keepEmptyInLastPlate
        );
      }
    } else {
      // Same-plate constraint: groups are on the same plate but rows are flexible.
      // Use the same distributeToBlocks logic as balanced block randomization
      // for covariate-balanced row distribution.
      const experimentalPlateSamples = shuffleArray(plateGroups.flatMap(g => g.samples));
      const plateGroups2 = groupByCovariates(experimentalPlateSamples, selectedCovariates);

      // Use the effective row capacities that already account for QC allocations
      // (not assignBlockCapacities, which assumes full numColumns per row)
      const rowCapacities = effectiveRowCapacitiesPerPlate[plateIdx];

      const maxEffectiveRowCapacity = Math.max(...rowCapacities);
      const expectedRowMinimums = calculateExpectedMinimums(
        rowCapacities,
        plateGroups2,
        maxEffectiveRowCapacity,
        BlockType.ROW
      );

      const rowAssignments = distributeToBlocks(
        plateGroups2,
        rowCapacities,
        maxEffectiveRowCapacity,
        selectedCovariates,
        BlockType.ROW,
        expectedRowMinimums
      );

      for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
        const rowSamples = rowAssignments.get(rowIdx) ?? [];
        const qcForRow = qcPerPlateRow[plateIdx][rowIdx];
        const allRowSamples = [...rowSamples, ...qcForRow];

        allPlateSamples.push(...allRowSamples);

        greedyPlaceInRow(
          allRowSamples,
          plates[plateIdx],
          rowIdx,
          numColumns,
          keepEmptyInLastPlate
        );
      }
    }

    plateAssignments.set(plateIdx, allPlateSamples);
  }

  return { plates, plateAssignments };
}
