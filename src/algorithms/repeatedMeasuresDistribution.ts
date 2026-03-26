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
  totalWellCapacity: number,
  numRows?: number,
  numQcSamples?: number
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

  // For same-row: check if multi-sample groups can fit across all plates
  if (constraint === 'same-row' && numRows !== undefined) {
    const numPlates = Math.ceil((totalSamples + (numQcSamples ?? 0)) / plateCapacity);
    const qcPerRow = numQcSamples ? Math.ceil(numQcSamples / (numPlates * numRows)) : 0;
    const effectiveRowCap = rowCapacity - qcPerRow;

    // Count groups by size
    const groupsBySize = new Map<number, number>();
    const multiGroups = groups.filter(g => g.size > 1);
    for (const g of multiGroups) {
      groupsBySize.set(g.size, (groupsBySize.get(g.size) ?? 0) + 1);
    }

    // Check slot feasibility across all plates
    const totalRows = numPlates * numRows;
    for (const [groupSize, groupCount] of Array.from(groupsBySize.entries())) {
      const slotsPerRow = Math.floor(effectiveRowCap / groupSize);
      const totalSlots = totalRows * slotsPerRow;
      if (groupCount > totalSlots) {
        errors.push(
          `Cannot fit ${groupCount} subject groups of size ${groupSize} into available rows. ` +
          `With ${numPlates} plate(s) × ${numRows} rows, each row can hold ${slotsPerRow} group(s) of this size ` +
          `(${effectiveRowCap} effective slots per row after QC). ` +
          `Try using Same Plate constraint, increasing the plate size, or reducing QC samples.`
        );
      }
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
export function sortGroupsByDescendingSize(groups: SubjectGroup[]): SubjectGroup[] {
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
 * @param plateRowSlotLimits - Optional per-plate limit on how many multi-sample groups can be assigned
 *   (for same-row constraint: each row holds floor(rowCap / groupSize) groups)
 * @returns Map from plate index to array of SubjectGroups assigned to that plate
 * @throws Error if a group cannot fit in any plate
 */
export function distributeGroupsToPlates(
  groups: SubjectGroup[],
  plateCapacities: number[],
  globalProportions: Map<string, number>,
  plateRowSlotLimits?: number[]
): Map<number, SubjectGroup[]> {
  // Separate multi-sample groups from singletons
  const multiGroups = groups.filter(g => g.size > 1);
  const singletons = groups.filter(g => g.size === 1);

  // Sort multi-sample groups by size descending with randomized tie-breaking
  const sortedMultiGroups = sortGroupsByDescendingSize(multiGroups);

  // Initialize plate assignments and remaining capacities
  const plateAssignments = new Map<number, SubjectGroup[]>();
  const remainingCapacities = [...plateCapacities];
  const remainingRowSlots = plateRowSlotLimits ? [...plateRowSlotLimits] : undefined;
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
        // If row-slot limits are set, also check that the plate has remaining row-slots
        if (remainingRowSlots && remainingRowSlots[i] <= 0) continue;
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
    if (remainingRowSlots) {
      remainingRowSlots[bestPlateIdx] -= 1;
    }
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
 * Scores a recipe by how many distinct group sizes each row contains.
 * Higher score = more mixed-size rows = better covariate diversity.
 *
 * @param recipe - Array of Maps, one per row, mapping group size to count
 * @returns Sum of distinct sizes with count > 0 across all rows
 */
export function sizeDiversityScore(recipe: Map<number, number>[]): number {
  let score = 0;
  for (const rowRecipe of recipe) {
    for (const [, count] of Array.from(rowRecipe.entries())) {
      if (count > 0) score++;
    }
  }
  return score;
}

/**
 * Distributes subject groups to rows using composition-based backtracking (primary)
 * with greedy FFD as fallback.
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

  // Primary strategy: Composition-based backtracking solver.
  // Phase 1: Find valid "recipes" — how many groups of each size go in each row.
  //          This uses size-based enumeration for tractability.
  // Phase 1b: Score recipes by covariate balance using the group type pool.
  // Phase 2: Assign specific groups to rows, picking groups that best balance covariates.
  // Falls back to greedy FFD if the composition solver exhausts its iteration budget.

  let compositionSolverSucceeded = false;

  // Build group types for covariate-aware scoring
  const groupTypeCounts = new Map<string, { covariateKey: string; size: number; count: number }>();
  for (const g of multiGroups) {
    const covKey = g.samples[0]?.covariateKey ?? '';
    const typeKey = `${covKey}#${g.size}`;
    const existing = groupTypeCounts.get(typeKey);
    if (existing) {
      existing.count++;
    } else {
      groupTypeCounts.set(typeKey, { covariateKey: covKey, size: g.size, count: 1 });
    }
  }

  // Count groups by size (descending order of sizes) — for recipe enumeration
  const sizeCounts = new Map<number, number>();
  for (const g of multiGroups) {
    sizeCounts.set(g.size, (sizeCounts.get(g.size) ?? 0) + 1);
  }
  const distinctSizes = Array.from(sizeCounts.keys()).sort((a, b) => b - a);

  // Phase 1: Composition-based backtracking on size counts.
  const numRowsTotal = rowCapacities.length;
  const rowRecipes: Map<number, number>[] = Array.from({ length: numRowsTotal }, () => new Map());
  const remainingSizeCounts = new Map(sizeCounts);
  const btRowCaps = [...rowCapacities];
  const RECIPE_ITERATION_LIMIT = 500_000;
  let recipeIterations = 0;

  const MAX_RECIPES = 50;
  const validRecipes: Map<number, number>[][] = [];

  let searchReversed = false;

  const findRecipe = (rowIdx: number): boolean => {
    if (rowIdx === numRowsTotal) {
      for (const [, count] of Array.from(remainingSizeCounts.entries())) {
        if (count > 0) return false;
      }
      validRecipes.push(rowRecipes.map(r => new Map(r)));
      return validRecipes.length >= MAX_RECIPES;
    }

    const assignSizes = (sizeIdx: number, capLeft: number): boolean => {
      if (++recipeIterations > RECIPE_ITERATION_LIMIT) return false;

      if (sizeIdx === distinctSizes.length) {
        return findRecipe(rowIdx + 1);
      }

      const size = distinctSizes[sizeIdx];
      const available = remainingSizeCounts.get(size) ?? 0;
      const maxFit = Math.floor(capLeft / size);
      const maxPlace = Math.min(available, maxFit);

      const ascending = searchReversed && sizeIdx === 0;
      const start = ascending ? 0 : maxPlace;
      const end = ascending ? maxPlace : 0;
      const step = ascending ? 1 : -1;
      for (let count = start; ascending ? count <= end : count >= end; count += step) {
        remainingSizeCounts.set(size, available - count);
        rowRecipes[rowIdx].set(size, count);
        const newCapLeft = capLeft - count * size;

        let totalRemainingGroupSamples = 0;
        for (const [s, c] of Array.from(remainingSizeCounts.entries())) {
          totalRemainingGroupSamples += c * s;
        }

        const totalRemainingRowCap = btRowCaps.slice(rowIdx + 1).reduce((s, c) => s + c, 0) + newCapLeft;
        if (totalRemainingGroupSamples <= totalRemainingRowCap) {
          let feasible = true;
          for (const [s, c] of Array.from(remainingSizeCounts.entries())) {
            if (c === 0) continue;
            let slots = Math.floor(newCapLeft / s);
            for (let rr = rowIdx + 1; rr < numRowsTotal; rr++) {
              slots += Math.floor(btRowCaps[rr] / s);
            }
            if (c > slots) { feasible = false; break; }
          }

          if (feasible && assignSizes(sizeIdx + 1, newCapLeft)) {
            return true;
          }
        }

        remainingSizeCounts.set(size, available);
        rowRecipes[rowIdx].set(size, 0);
      }
      return false;
    };

    return assignSizes(0, btRowCaps[rowIdx]);
  };

  searchReversed = true;
  findRecipe(0);

  if (validRecipes.length < MAX_RECIPES && recipeIterations < RECIPE_ITERATION_LIMIT) {
    searchReversed = false;
    for (const [size, count] of Array.from(sizeCounts.entries())) {
      remainingSizeCounts.set(size, count);
    }
    for (const recipe of rowRecipes) {
      recipe.clear();
    }
    findRecipe(0);
  }

  if (validRecipes.length > 0) {
    compositionSolverSucceeded = true;

    // Phase 1b: Score recipes by covariate balance.
    // For each recipe, compute the best achievable covariate composition per row
    // by optimally distributing group types to size slots.
    // Build pool: for each size, which (covariateKey, count) pairs exist
    const poolBySizeCov = new Map<number, Map<string, number>>();
    for (const g of multiGroups) {
      const covKey = g.samples[0]?.covariateKey ?? '';
      if (!poolBySizeCov.has(g.size)) poolBySizeCov.set(g.size, new Map());
      const covMap = poolBySizeCov.get(g.size)!;
      covMap.set(covKey, (covMap.get(covKey) ?? 0) + 1);
    }

    const scoreRecipe = (recipe: Map<number, number>[]): number => {
      if (globalProportions.size === 0) return 0;
      let totalScore = 0;
      for (const rowRecipe of recipe) {
        const expectedCovSamples = new Map<string, number>();
        let totalRowSamples = 0;
        for (const [size, slotCount] of Array.from(rowRecipe.entries())) {
          if (slotCount === 0) continue;
          const covPool = poolBySizeCov.get(size);
          if (!covPool) continue;
          let totalGroupsOfSize = 0;
          covPool.forEach(count => { totalGroupsOfSize += count; });
          if (totalGroupsOfSize === 0) continue;
          for (const [covKey, poolCount] of Array.from(covPool.entries())) {
            const expectedGroups = slotCount * (poolCount / totalGroupsOfSize);
            const expectedSamples = expectedGroups * size;
            expectedCovSamples.set(covKey, (expectedCovSamples.get(covKey) ?? 0) + expectedSamples);
            totalRowSamples += expectedSamples;
          }
        }
        if (totalRowSamples === 0) continue;
        for (const [covKey, globalProp] of Array.from(globalProportions.entries())) {
          const actualProp = (expectedCovSamples.get(covKey) ?? 0) / totalRowSamples;
          totalScore += (actualProp - globalProp) ** 2;
        }
      }
      return totalScore;
    };

    let bestRecipe = validRecipes[0];
    let bestScore = scoreRecipe(bestRecipe);
    for (let i = 1; i < validRecipes.length; i++) {
      const score = scoreRecipe(validRecipes[i]);
      if (score < bestScore) {
        bestScore = score;
        bestRecipe = validRecipes[i];
      }
    }

    // Phase 2: Assign specific groups to rows based on the best recipe,
    // using covariate balance to spread different covariate groups across rows.
    const groupsBySizeMap = new Map<number, SubjectGroup[]>();
    for (const g of multiGroups) {
      if (!groupsBySizeMap.has(g.size)) groupsBySizeMap.set(g.size, []);
      groupsBySizeMap.get(g.size)!.push(g);
    }
    for (const [size, gs] of Array.from(groupsBySizeMap.entries())) {
      groupsBySizeMap.set(size, shuffleArray(gs));
    }

    // Collect all (rowIdx, size) slots from the recipe, then assign groups
    // one at a time picking the group that best balances each row's covariates.
    // Sort by size descending, then interleave across rows (round-robin) so that
    // each row gets one group before any row gets a second, preventing covariate
    // segregation when one covariate dominates a particular group size.
    const slots: { rowIdx: number; size: number }[] = [];
    for (let rowIdx = 0; rowIdx < numRowsTotal; rowIdx++) {
      const recipe = bestRecipe[rowIdx];
      for (const [size, count] of Array.from(recipe.entries())) {
        for (let c = 0; c < count; c++) {
          slots.push({ rowIdx, size });
        }
      }
    }

    // Group slots by size descending, then within each size group, sort by row index
    // and interleave: first pass assigns slot 0 for each row, second pass assigns slot 1, etc.
    const slotsBySize = new Map<number, { rowIdx: number; size: number }[]>();
    for (const slot of slots) {
      if (!slotsBySize.has(slot.size)) slotsBySize.set(slot.size, []);
      slotsBySize.get(slot.size)!.push(slot);
    }
    const sortedSizes = Array.from(slotsBySize.keys()).sort((a, b) => b - a);

    const orderedSlots: { rowIdx: number; size: number }[] = [];
    for (const size of sortedSizes) {
      const sizeSlots = slotsBySize.get(size)!;
      // Group by row, then interleave: row0-slot0, row1-slot0, row2-slot0, row0-slot1, ...
      const byRow = new Map<number, number>(); // rowIdx → count of slots for this size
      for (const s of sizeSlots) {
        byRow.set(s.rowIdx, (byRow.get(s.rowIdx) ?? 0) + 1);
      }
      const maxPerRow = Math.max(...Array.from(byRow.values()));
      const rowIndices = shuffleArray(Array.from(byRow.keys()));
      for (let pass = 0; pass < maxPerRow; pass++) {
        for (const rowIdx of rowIndices) {
          if ((byRow.get(rowIdx) ?? 0) > pass) {
            orderedSlots.push({ rowIdx, size });
          }
        }
      }
    }

    for (const { rowIdx, size } of orderedSlots) {
      const pool = groupsBySizeMap.get(size)!;
      if (pool.length === 1 || globalProportions.size === 0) {
        const group = pool.shift()!;
        rowAssignments.get(rowIdx)!.push(group);
        remainingCapacities[rowIdx] -= group.size;
      } else {
        // Pick the group from the pool that best balances this row's covariates
        const currentSamples = getRowSamples(rowIdx);
        let bestIdx = 0;
        let bestScoreP2 = Infinity;
        for (let i = 0; i < pool.length; i++) {
          const score = covariateImbalanceScore(currentSamples, pool[i].samples, globalProportions);
          if (score < bestScoreP2) {
            bestScoreP2 = score;
            bestIdx = i;
          }
        }
        const group = pool.splice(bestIdx, 1)[0];
        rowAssignments.get(rowIdx)!.push(group);
        remainingCapacities[rowIdx] -= group.size;
      }
    }
  }

  if (!compositionSolverSucceeded) {
    // Composition solver found no valid recipes (iteration budget exhausted).
    // Fall back to greedy FFD placement.
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

      let bestRowIdx: number;
      if (candidateRows.length === 1 || globalProportions.size === 0) {
        // No covariates to balance — pick the row with most remaining capacity
        candidateRows.sort((a, b) => b.remaining - a.remaining);
        const maxRemaining = candidateRows[0].remaining;
        const tiedRows = candidateRows.filter(r => r.remaining === maxRemaining);
        bestRowIdx = shuffleArray(tiedRows)[0].rowIdx;
      } else {
        // Use covariate balance as primary criterion across ALL feasible rows.
        let bestScore = Infinity;
        let bestCandidates: number[] = [];
        for (const candidate of candidateRows) {
          const currentSamples = getRowSamples(candidate.rowIdx);
          const score = covariateImbalanceScore(currentSamples, group.samples, globalProportions);
          if (score < bestScore) {
            bestScore = score;
            bestCandidates = [candidate.rowIdx];
          } else if (score === bestScore) {
            bestCandidates.push(candidate.rowIdx);
          }
        }
        // Among equally-scored rows, prefer the one with most remaining capacity
        if (bestCandidates.length > 1) {
          const withCap = bestCandidates.map(idx => ({
            idx,
            remaining: remainingCapacities[idx],
          }));
          withCap.sort((a, b) => b.remaining - a.remaining);
          const maxCap = withCap[0].remaining;
          const topCandidates = withCap.filter(c => c.remaining === maxCap).map(c => c.idx);
          bestRowIdx = shuffleArray(topCandidates)[0];
        } else {
          bestRowIdx = bestCandidates[0];
        }
      }

      rowAssignments.get(bestRowIdx)!.push(group);
      remainingCapacities[bestRowIdx] -= group.size;
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

  // Step 1: Separate QC samples from experimental samples and distribute by covariate
  const qcSamples = shuffleArray(searches.filter(s => s.isQC === true));
  const experimentalSamples = searches.filter(s => s.isQC !== true);

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
  // to only what's needed for remaining experimental samples.
  // Disabled for same-row constraint: row-slot geometry already constrains
  // distribution tightly, and reducing capacity causes singleton imbalance.
  const totalExperimental = experimentalSamples.length;
  if (keepEmptyInLastPlate && numPlates > 1 && groupingConstraint !== 'same-row') {
    const capacityBeforeLast = effectivePlateCapacities.slice(0, numPlates - 1)
      .reduce((sum, c) => sum + c, 0);
    const remainingForLast = Math.max(0, totalExperimental - capacityBeforeLast);
    if (remainingForLast < effectivePlateCapacities[numPlates - 1]) {
      effectivePlateCapacities[numPlates - 1] = remainingForLast;
    }
  }

  // For same-row constraint, compute per-plate row-slot limits.
  // These limit how many multi-sample groups each plate can accept,
  // independent of total well capacity.
  // Use the minimum group size (not max) to compute an upper bound on
  // how many groups each plate can hold. The actual per-size feasibility
  // is validated later by distributeGroupsToRows which has its own
  // per-size checks and backtracking.
  let plateRowSlotLimits: number[] | undefined;
  if (groupingConstraint === 'same-row') {
    const multiGroups = subjectGroups.filter(g => g.size > 1);
    if (multiGroups.length > 0) {
      const minGroupSize = Math.min(...multiGroups.map(g => g.size));
      plateRowSlotLimits = [];
      for (let p = 0; p < numPlates; p++) {
        const rowCaps = effectiveRowCapacitiesPerPlate[p];
        const totalRowSlots = rowCaps.reduce((sum, cap) => sum + Math.floor(cap / minGroupSize), 0);
        plateRowSlotLimits.push(totalRowSlots);
      }
    }
  }

  // Step 5: Compute global proportions for covariate balance scoring
  const globalProportions = selectedCovariates.length > 0
    ? computeGlobalProportions(experimentalSamples)
    : new Map<string, number>();

  // Step 6: Distribute subject groups to plates
  const plateGroupAssignments = distributeGroupsToPlates(
    subjectGroups,
    effectivePlateCapacities,
    globalProportions,
    plateRowSlotLimits
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

      // Reorder rows to minimize vertical adjacency of same covariate groups.
      // Build a covariate signature for each row, then greedily sequence rows
      // so that adjacent rows have maximally different covariate compositions.
      const rowIndices = Array.from({ length: numRows }, (_, i) => i);
      const rowSignatures: Map<string, number>[] = [];
      for (let r = 0; r < numRows; r++) {
        const sig = new Map<string, number>();
        const groups = rowGroupAssignments.get(r) ?? [];
        for (const g of groups) {
          for (const s of g.samples) {
            const key = s.covariateKey ?? '';
            sig.set(key, (sig.get(key) ?? 0) + 1);
          }
        }
        rowSignatures.push(sig);
      }

      // Greedy sequencing: start with a random row, then always pick the most
      // different remaining row (measured by overlap of covariate keys).
      const remaining = new Set(rowIndices);
      const orderedRows: number[] = [];
      // Start with a random row
      const startIdx = shuffleArray(Array.from(remaining))[0];
      orderedRows.push(startIdx);
      remaining.delete(startIdx);

      while (remaining.size > 0) {
        const prevSig = rowSignatures[orderedRows[orderedRows.length - 1]];
        let bestRow = -1;
        let bestDiff = -1;
        const candidates = shuffleArray(Array.from(remaining));
        for (const r of candidates) {
          const sig = rowSignatures[r];
          // Difference = sum of absolute differences in covariate counts
          const allKeys = new Set(Array.from(prevSig.keys()).concat(Array.from(sig.keys())));
          let diff = 0;
          allKeys.forEach(key => {
            diff += Math.abs((prevSig.get(key) ?? 0) - (sig.get(key) ?? 0));
          });
          if (diff > bestDiff) {
            bestDiff = diff;
            bestRow = r;
          }
        }
        orderedRows.push(bestRow);
        remaining.delete(bestRow);
      }

      // Place samples using the reordered row sequence
      for (let physicalRow = 0; physicalRow < numRows; physicalRow++) {
        const logicalRow = orderedRows[physicalRow];
        const rowGroups = rowGroupAssignments.get(logicalRow) ?? [];
        const rowSamples = rowGroups.flatMap(g => g.samples);
        // Move QC samples with their logical row to preserve capacity assumptions
        const qcForRow = qcPerPlateRow[plateIdx][logicalRow];
        const allRowSamples = [...rowSamples, ...qcForRow];

        allPlateSamples.push(...allRowSamples);

        greedyPlaceInRow(
          allRowSamples,
          plates[plateIdx],
          physicalRow,
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
