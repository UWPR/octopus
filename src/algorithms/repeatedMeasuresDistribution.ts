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
      `Total samples (${totalSamples}) exceed available well capacity (${totalWellCapacity}). ` +
      `Try increasing the plate dimensions.`
    );
  }

  // Check per-group capacity based on constraint level
  for (const group of groups) {
    if (constraint === 'same-row' && group.size > rowCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the row capacity of ${rowCapacity}. ` +
        `Try increasing the plate dimensions or switching to Same Plate constraint.`
      );
    }
    if (constraint === 'same-plate' && group.size > plateCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the plate capacity of ${plateCapacity}. ` +
        `Try increasing the plate dimensions.`
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
          `Try increasing the plate dimensions or switching to Same Plate constraint.`
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
  for (let gi = 0; gi < sortedMultiGroups.length; gi++) {
    const group = sortedMultiGroups[gi];
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
      const maxPlateCap = Math.max(...plateCapacities);
      if (group.size > maxPlateCap) {
        throw new Error(
          `Unable to fit all subject groups into available plates. ` +
          `Subject ${group.subjectId} (size ${group.size}) exceeds the largest plate capacity (${maxPlateCap}). ` +
          `Try increasing the plate dimensions.`
        );
      } else {
        const unplacedGroups = sortedMultiGroups.slice(gi);
        const unplacedBySize = new Map<number, number>();
        for (const g of unplacedGroups) {
          unplacedBySize.set(g.size, (unplacedBySize.get(g.size) ?? 0) + 1);
        }

        const shapeParts: string[] = [];
        for (const [size, count] of Array.from(unplacedBySize.entries()).sort((a, b) => b[0] - a[0])) {
          const usablePlates = remainingCapacities.filter(c => c >= size).length;
          const slotsInUsablePlates = remainingCapacities
            .filter(c => c >= size)
            .reduce((sum, c) => sum + Math.floor(c / size), 0);
          shapeParts.push(
            `${count} group(s) of size ${size} need plates with ${size}+ wells, ` +
            `but only ${usablePlates} plate(s) qualify (${slotsInUsablePlates} slot(s))`
          );
        }

        throw new Error(
          `Unable to fit all subject groups into available plates. ` +
          `Remaining plate capacities: [${remainingCapacities.join(', ')}]. ` +
          shapeParts.join('; ') + '. ' +
          `Try increasing the plate dimensions or switching to Same Plate constraint.`
        );
      }
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
        `No remaining capacity for singleton sample after placing subject groups. ` +
        `Try adjusting the plate dimensions or switching to Same Plate constraint.`
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


// ─── Helper types for distributeGroupsToRows internals ──────────────────────

interface RowState {
  rowAssignments: Map<number, SubjectGroup[]>;
  remainingCapacities: number[];
}

// ─── Step 1: Feasibility validation ─────────────────────────────────────────

/**
 * Validates that multi-sample groups and singletons can fit into the given rows.
 * Throws descriptive errors if any constraint is violated.
 */
function validateGroupFeasibility(
  multiGroups: SubjectGroup[],
  singletons: SubjectGroup[],
  rowCapacities: number[]
): void {
  const maxRowCap = Math.max(...rowCapacities);

  const oversizedGroup = multiGroups.find(g => g.size > maxRowCap);
  if (oversizedGroup) {
    throw new Error(
      `Subject ${oversizedGroup.subjectId} has ${oversizedGroup.size} samples, ` +
      `but the largest row only has ${maxRowCap} available slots (after QC allocation). ` +
      `Try increasing the plate dimensions or switching to Same Plate constraint.`
    );
  }

  const totalMultiGroupSamples = multiGroups.reduce((sum, g) => sum + g.size, 0);
  const totalCapacity = rowCapacities.reduce((sum, c) => sum + c, 0);
  const totalSamples = totalMultiGroupSamples + singletons.length;
  if (totalSamples > totalCapacity) {
    throw new Error(
      `Total samples (${totalSamples}) exceed total row capacity (${totalCapacity}). ` +
      `Try increasing the plate dimensions.`
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
        `Try increasing the plate dimensions or switching to Same Plate constraint.`
      );
    }
  }
}

// ─── Step 2: Recipe enumeration via backtracking ────────────────────────────

// ─── Shared mutable state for the recipe backtracking search ────────────────

/**
 * Bundles the mutable state shared between the recursive backtracking functions
 * (findRecipeForRow and assignSizesToRow). Passed explicitly so those functions
 * can live at module scope instead of being nested closures.
 */
interface RecipeSearchState {
  /** Distinct group sizes in descending order (e.g. [4, 3, 2]) */
  distinctSizes: number[];
  /** Per-row capacity limits (original, not mutated) */
  rowCapacities: number[];
  /** Number of rows to fill */
  numRows: number;
  /** Working recipe: rowsRecipe[rowIdx] maps groupSize → count assigned to that row */
  rowsRecipe: Map<number, number>[];
  /** How many groups of each size still need to be placed */
  remainingSizeCounts: Map<number, number>;
  /** Accumulated valid recipes */
  validRecipes: Map<number, number>[][];
  /** Canonical keys of already-collected recipes (for deduplication) */
  seenCanonical: Set<string>;
  /** Iteration counter — incremented on each assignSizesToRow call */
  recipeIterations: number;
  /** Max iterations before giving up */
  iterationLimit: number;
  /** Max recipes to collect */
  maxRecipes: number;
  /** When true, the first (largest) size is tried in ascending order (0..max)
   *  instead of descending (max..0), producing different recipe shapes. */
  searchReversed: boolean;
}

/**
 * Builds a canonical string key for a recipe that is invariant to row ordering.
 * Two recipes that are row-permutations of each other produce the same key.
 *
 * Each row is serialized as "size:count,size:count,..." (sizes in descending order,
 * zero-count sizes omitted). The row strings are then sorted lexicographically
 * and joined with "|".
 */
function canonicalRecipeKey(
  recipe: Map<number, number>[],
  distinctSizes: number[]
): string {
  const rowKeys = recipe.map(row => {
    const parts: string[] = [];
    for (const size of distinctSizes) {
      const count = row.get(size) ?? 0;
      if (count > 0) parts.push(`${size}:${count}`);
    }
    return parts.join(',');
  });
  return rowKeys.sort().join('|');
}

/**
 * Recursive backtracking: tries to assign groups of each distinct size to a
 * single row (rowIdx), then recurses to the next row.
 *
 * For each distinct group size (processed largest-first via sizeIdx), it tries
 * every feasible count of that size that fits in the remaining row capacity.
 * After choosing a count, it:
 *   1. Checks total remaining capacity across unvisited rows is sufficient.
 *   2. Checks per-size slot feasibility (each remaining size can still fit
 *      somewhere across the remaining rows).
 *   3. If feasible, recurses to the next size in this row.
 *
 * When all sizes for this row are assigned (sizeIdx === distinctSizes.length),
 * it calls findRecipeForRow for the next row.
 *
 * Uses backtracking: after each recursive attempt, it restores the
 * remainingSizeCounts and rowsRecipe to their pre-attempt values.
 *
 * @param sizeIdx - Index into state.distinctSizes for the current size being assigned
 * @param capLeft - Remaining capacity in the current row after sizes already assigned
 * @param rowIdx  - Which row is currently being filled
 * @param state   - Shared mutable search state
 * @returns true if the maxRecipes limit has been reached (signals caller to stop)
 */
function assignSizesToRow(
  sizeIdx: number,
  capLeft: number,
  rowIdx: number,
  state: RecipeSearchState
): boolean {
  if (++state.recipeIterations > state.iterationLimit) return false;

  // We've assigned a count for every distinct group size in this row
  // (size 4: N groups, size 3: M groups, etc.) — now fill the next row
  if (sizeIdx === state.distinctSizes.length) {
    return findRecipeForRow(rowIdx + 1, state);
  }

  const size = state.distinctSizes[sizeIdx];
  const available = state.remainingSizeCounts.get(size) ?? 0;
  const maxFit = Math.floor(capLeft / size);
  const maxPlace = Math.min(available, maxFit);

  // When searchReversed is true and we're on the first (largest) size,
  // iterate 0..maxPlace instead of maxPlace..0. This explores recipes
  // that pack fewer large groups per row first, producing different
  // recipe shapes than the default descending search.
  const ascending = state.searchReversed && sizeIdx === 0;
  const start = ascending ? 0 : maxPlace;
  const end = ascending ? maxPlace : 0;
  const step = ascending ? 1 : -1;

  for (let count = start; ascending ? count <= end : count >= end; count += step) {
    // Tentatively assign `count` groups of this size to the current row
    state.remainingSizeCounts.set(size, available - count);
    state.rowsRecipe[rowIdx].set(size, count);
    const newCapLeft = capLeft - count * size;

    // Pruning check 1: total remaining group samples must fit in total remaining capacity
    let totalRemainingGroupSamples = 0;
    for (const [s, c] of Array.from(state.remainingSizeCounts.entries())) {
      totalRemainingGroupSamples += c * s;
    }
    const totalRemainingRowCap = state.rowCapacities.slice(rowIdx + 1).reduce((s, c) => s + c, 0) + newCapLeft;

    if (totalRemainingGroupSamples <= totalRemainingRowCap) {
      // Pruning check 2: for each remaining size, enough row-slots must exist
      // (a row can hold floor(cap / size) groups of a given size)
      let feasible = true;
      for (const [s, c] of Array.from(state.remainingSizeCounts.entries())) {
        if (c === 0) continue;
        let slots = Math.floor(newCapLeft / s);
        for (let rr = rowIdx + 1; rr < state.numRows; rr++) {
          slots += Math.floor(state.rowCapacities[rr] / s);
        }
        if (c > slots) { feasible = false; break; }
      }

      if (feasible && assignSizesToRow(sizeIdx + 1, newCapLeft, rowIdx, state)) {
        return true;
      }
    }

    // Backtrack: restore state before trying the next count
    state.remainingSizeCounts.set(size, available);
    state.rowsRecipe[rowIdx].set(size, 0);
  }
  return false;
}

/**
 * Recursive backtracking: attempts to build a complete recipe by assigning
 * group-size counts to each row in sequence (row 0, row 1, ...).
 *
 * Base case (rowIdx === numRows): all rows filled. If all groups are placed
 * (remainingSizeCounts all zero), the recipe is valid. It's deduplicated
 * against previously seen recipes using a canonical key that is invariant
 * to row ordering, so permutations of the same recipe don't waste budget.
 *
 * Recursive case: delegates to assignSizesToRow to try all feasible
 * size-count combinations for the current row.
 *
 * @param rowIdx - The row to fill next (0-based)
 * @param state  - Shared mutable search state
 * @returns true if the maxRecipes limit has been reached
 */
function findRecipeForRow(rowIdx: number, state: RecipeSearchState): boolean {
  // Base case: all rows have been assigned
  if (rowIdx === state.numRows) {
    // Check that every group has been placed
    for (const [, count] of Array.from(state.remainingSizeCounts.entries())) {
      if (count > 0) return false;
    }

    // Deduplicate: recipes that are row-order permutations of each other
    // produce the same canonical key and are skipped
    const key = canonicalRecipeKey(state.rowsRecipe, state.distinctSizes);
    if (state.seenCanonical.has(key)) return false;
    state.seenCanonical.add(key);

    state.validRecipes.push(state.rowsRecipe.map(r => new Map(r)));
    return state.validRecipes.length >= state.maxRecipes;
  }

  // Recursive case: try all feasible size-count assignments for this row
  return assignSizesToRow(0, state.rowCapacities[rowIdx], rowIdx, state);
}

/**
 * Enumerates valid "recipes" — how many groups of each size go in each row —
 * using composition-based backtracking. Collects up to maxRecipes unique recipes
 * within an iteration budget, searching both reversed and forward orderings.
 *
 * Recipes that are row-order permutations of each other are deduplicated
 * (via shared seenCanonical set across passes) so the budget is spent on
 * genuinely different packing strategies.
 *
 * Each pass collects up to recipesPerPass unique recipes. The two passes
 * explore different regions of the search space (reversed spreads large
 * groups evenly; forward packs them tightly), so the combined set of up
 * to maxRecipes recipes has good diversity.
 *
 * @returns Array of valid recipes (each recipe is an array of Maps: rowIdx → (size → count))
 */
function findValidRecipes(
  multiGroups: SubjectGroup[],
  rowCapacities: number[],
  recipesPerPass: number = 50,
  iterationLimit: number = 500_000
): Map<number, number>[][] {
  const sizeCounts = new Map<number, number>();
  for (const g of multiGroups) {
    sizeCounts.set(g.size, (sizeCounts.get(g.size) ?? 0) + 1);
  }

  const state: RecipeSearchState = {
    distinctSizes: Array.from(sizeCounts.keys()).sort((a, b) => b - a),
    rowCapacities: [...rowCapacities],
    numRows: rowCapacities.length,
    rowsRecipe: Array.from({ length: rowCapacities.length }, () => new Map()),
    remainingSizeCounts: new Map(sizeCounts),
    validRecipes: [],
    seenCanonical: new Set(),
    recipeIterations: 0,
    iterationLimit,
    maxRecipes: recipesPerPass,
    searchReversed: false,
  };

  // First pass: reversed search (ascending count for largest size)
  // explores recipes that spread large groups more evenly across rows.
  // Collects up to recipesPerPass unique recipes.
  state.searchReversed = true;
  findRecipeForRow(0, state);

  // Second pass: forward search (descending count for largest size)
  // explores recipes that pack large groups tightly.
  // Collects up to recipesPerPass additional unique recipes (dedup is shared).
  if (state.recipeIterations < iterationLimit) {
    state.searchReversed = false;
    state.maxRecipes = state.validRecipes.length + recipesPerPass;
    for (const [size, count] of Array.from(sizeCounts.entries())) {
      state.remainingSizeCounts.set(size, count);
    }
    for (const recipe of state.rowsRecipe) {
      recipe.clear();
    }
    findRecipeForRow(0, state);
  }

  return state.validRecipes;
}


// ─── Step 3: Recipe scoring by covariate balance ────────────────────────────

/**
 * Scores each recipe by how well its expected covariate distribution matches
 * the global proportions, and returns the best one.
 *
 * @returns The recipe with the lowest covariate imbalance score
 */
function scoreAndSelectRecipe(
  validRecipes: Map<number, number>[][],
  multiGroups: SubjectGroup[],
  globalProportions: Map<string, number>
): Map<number, number>[] {
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

  let bestScore = Infinity;
  for (const recipe of validRecipes) {
    const score = scoreRecipe(recipe);
    if (score < bestScore) {
      bestScore = score;
    }
  }

  // Collect all recipes that tie for the best score, then pick one randomly
  const bestRecipes = validRecipes.filter(r => scoreRecipe(r) === bestScore);
  return bestRecipes[Math.floor(Math.random() * bestRecipes.length)];
}

// ─── Step 4: Assign specific groups to recipe slots ─────────────────────────

/**
 * Given a recipe (size → count per row), assigns specific groups to rows
 * using round-robin interleaving and covariate-balance scoring.
 */
function assignGroupsToRecipeSlots(
  bestRecipe: Map<number, number>[],
  multiGroups: SubjectGroup[],
  globalProportions: Map<string, number>,
  state: RowState
): void {
  const numRows = bestRecipe.length;

  // Build pools of groups by size, shuffled
  const groupsBySizeMap = new Map<number, SubjectGroup[]>();
  for (const g of multiGroups) {
    if (!groupsBySizeMap.has(g.size)) groupsBySizeMap.set(g.size, []);
    groupsBySizeMap.get(g.size)!.push(g);
  }
  for (const [size, gs] of Array.from(groupsBySizeMap.entries())) {
    groupsBySizeMap.set(size, shuffleArray(gs));
  }

  // Collect all (rowIdx, size) slots from the recipe
  const slots: { rowIdx: number; size: number }[] = [];
  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    const recipe = bestRecipe[rowIdx];
    for (const [size, count] of Array.from(recipe.entries())) {
      for (let c = 0; c < count; c++) {
        slots.push({ rowIdx, size });
      }
    }
  }

  // Group slots by size descending, then interleave across rows (round-robin)
  // so each row gets one group before any row gets a second, preventing
  // covariate segregation when one covariate dominates a particular group size.
  const slotsBySize = new Map<number, { rowIdx: number; size: number }[]>();
  for (const slot of slots) {
    if (!slotsBySize.has(slot.size)) slotsBySize.set(slot.size, []);
    slotsBySize.get(slot.size)!.push(slot);
  }
  const sortedSizes = Array.from(slotsBySize.keys()).sort((a, b) => b - a);

  const orderedSlots: { rowIdx: number; size: number }[] = [];
  for (const size of sortedSizes) {
    const sizeSlots = slotsBySize.get(size)!;
    const byRow = new Map<number, number>();
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

  // Helper: get all samples currently assigned to a row
  const getRowSamples = (rowIdx: number): SearchData[] => {
    return state.rowAssignments.get(rowIdx)!.flatMap(g => g.samples);
  };

  // Assign groups to slots, picking the best covariate match each time
  for (const { rowIdx, size } of orderedSlots) {
    const pool = groupsBySizeMap.get(size)!;
    if (pool.length === 1 || globalProportions.size === 0) {
      const group = pool.shift()!;
      state.rowAssignments.get(rowIdx)!.push(group);
      state.remainingCapacities[rowIdx] -= group.size;
    } else {
      const currentSamples = getRowSamples(rowIdx);
      let bestIdx = 0;
      let bestScore = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const score = covariateImbalanceScore(currentSamples, pool[i].samples, globalProportions);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      const group = pool.splice(bestIdx, 1)[0];
      state.rowAssignments.get(rowIdx)!.push(group);
      state.remainingCapacities[rowIdx] -= group.size;
    }
  }
}

// ─── Step 5: Greedy FFD fallback ────────────────────────────────────────────

/**
 * Falls back to greedy first-fit-decreasing placement when the composition
 * solver exhausts its iteration budget without finding valid recipes.
 */
function greedyFFDPlacement(
  sortedMultiGroups: SubjectGroup[],
  globalProportions: Map<string, number>,
  state: RowState
): void {
  // Helper: get all samples currently assigned to a row
  const getRowSamples = (rowIdx: number): SearchData[] => {
    return state.rowAssignments.get(rowIdx)!.flatMap(g => g.samples);
  };

  for (let gi = 0; gi < sortedMultiGroups.length; gi++) {
    const group = sortedMultiGroups[gi];
    const candidateRows: { rowIdx: number; remaining: number }[] = [];
    for (let i = 0; i < state.remainingCapacities.length; i++) {
      if (state.remainingCapacities[i] >= group.size) {
        candidateRows.push({ rowIdx: i, remaining: state.remainingCapacities[i] });
      }
    }

    if (candidateRows.length === 0) {
      // Build a shape-aware error message: explain which unplaced group sizes
      // need rows, how many rows can actually fit each size, and the shortfall.
      const unplacedGroups = sortedMultiGroups.slice(gi);
      const unplacedBySize = new Map<number, number>();
      for (const g of unplacedGroups) {
        unplacedBySize.set(g.size, (unplacedBySize.get(g.size) ?? 0) + 1);
      }

      const shapeParts: string[] = [];
      for (const [size, count] of Array.from(unplacedBySize.entries()).sort((a, b) => b[0] - a[0])) {
        const usableRows = state.remainingCapacities.filter(c => c >= size).length;
        const slotsInUsableRows = state.remainingCapacities
          .filter(c => c >= size)
          .reduce((sum, c) => sum + Math.floor(c / size), 0);
        shapeParts.push(
          `${count} group(s) of size ${size} need rows with ${size}+ wells, ` +
          `but only ${usableRows} row(s) qualify (${slotsInUsableRows} slot(s))`
        );
      }

      throw new Error(
        `Unable to fit all subject groups into available rows. ` +
        `Remaining row capacities: [${state.remainingCapacities.join(', ')}]. ` +
        shapeParts.join('; ') + '. ' +
        `Try increasing the plate dimensions or switching to Same Plate constraint.`
      );
    }

    let bestRowIdx: number;
    if (candidateRows.length === 1 || globalProportions.size === 0) {
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
          remaining: state.remainingCapacities[idx],
        }));
        withCap.sort((a, b) => b.remaining - a.remaining);
        const maxCap = withCap[0].remaining;
        const topCandidates = withCap.filter(c => c.remaining === maxCap).map(c => c.idx);
        bestRowIdx = shuffleArray(topCandidates)[0];
      } else {
        bestRowIdx = bestCandidates[0];
      }
    }

    state.rowAssignments.get(bestRowIdx)!.push(group);
    state.remainingCapacities[bestRowIdx] -= group.size;
  }
}

// ─── Step 6: Singleton distribution ─────────────────────────────────────────

/**
 * Distributes singleton groups (size 1) to fill remaining row capacity,
 * preferring rows with the most remaining capacity and best covariate balance.
 */
function distributeSingletons(
  singletons: SubjectGroup[],
  globalProportions: Map<string, number>,
  state: RowState
): void {
  // Helper: get all samples currently assigned to a row
  const getRowSamples = (rowIdx: number): SearchData[] => {
    return state.rowAssignments.get(rowIdx)!.flatMap(g => g.samples);
  };

  const sortedSingletons = shuffleArray([...singletons]);
  for (const singleton of sortedSingletons) {
    const candidateRows: { rowIdx: number; remaining: number }[] = [];
    for (let i = 0; i < state.remainingCapacities.length; i++) {
      if (state.remainingCapacities[i] >= 1) {
        candidateRows.push({ rowIdx: i, remaining: state.remainingCapacities[i] });
      }
    }

    if (candidateRows.length === 0) {
      throw new Error(
        `Unable to fit all samples into available rows. ` +
        `No remaining capacity for singleton sample after placing subject groups. ` +
        `Try adjusting the plate dimensions or switching to Same Plate constraint.`
      );
    }

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

    state.rowAssignments.get(bestRowIdx)!.push(singleton);
    state.remainingCapacities[bestRowIdx] -= 1;
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Distributes subject groups to rows using composition-based backtracking (primary)
 * with greedy FFD as fallback.
 *
 * Pipeline:
 *  1. validateGroupFeasibility — early checks with descriptive errors
 *  2. findValidRecipes — backtracking enumeration of size-based recipes
 *  3. scoreAndSelectRecipe — pick the recipe with best covariate balance
 *  4. assignGroupsToRecipeSlots — assign specific groups via round-robin interleaving
 *  5. greedyFFDPlacement — fallback if no recipes found within iteration budget
 *  6. distributeSingletons — fill remaining capacity with size-1 groups
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
  const multiGroups = groups.filter(g => g.size > 1);
  const singletons = groups.filter(g => g.size === 1);

  // Step 1: Validate feasibility
  validateGroupFeasibility(multiGroups, singletons, rowCapacities);

  // Initialize shared row state
  const state: RowState = {
    rowAssignments: new Map<number, SubjectGroup[]>(),
    remainingCapacities: [...rowCapacities],
  };
  for (let i = 0; i < rowCapacities.length; i++) {
    state.rowAssignments.set(i, []);
  }

  // Step 2: Try composition-based solver
  const validRecipes = findValidRecipes(multiGroups, rowCapacities);

  if (validRecipes.length > 0) {
    // Step 3: Score and select best recipe
    const bestRecipe = scoreAndSelectRecipe(validRecipes, multiGroups, globalProportions);

    // Step 4: Assign specific groups to recipe slots
    assignGroupsToRecipeSlots(bestRecipe, multiGroups, globalProportions, state);
  } else {
    // Step 5: Fallback to greedy FFD
    const sortedMultiGroups = sortGroupsByDescendingSize(multiGroups);
    greedyFFDPlacement(sortedMultiGroups, globalProportions, state);
  }

  // Step 6: Fill remaining capacity with singletons
  distributeSingletons(singletons, globalProportions, state);

  return state.rowAssignments;
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
      // (not assignBlockCapacities, which assumes full numColumns per row).
      // Note: Σ rowCapacities can exceed the experimental sample count on this
      // plate when the layout has empty wells; Hamilton handles that as the
      // under-capacity case. See docs/expected-minimums-architecture.md for the
      // asymmetry between this caller and the standard-flow row pass.
      const rowCapacities = effectiveRowCapacitiesPerPlate[plateIdx];

      const maxEffectiveRowCapacity = Math.max(...rowCapacities);
      const expectedRowMinimums = calculateExpectedMinimums(
        rowCapacities,
        plateGroups2,
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
