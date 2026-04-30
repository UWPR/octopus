import { SearchData, SubjectGroup, RepeatedMeasuresConfig, GroupingConstraint } from '../utils/types';
import {
  covariateImbalanceScore,
  buildSubjectGroups,
  validateSubjectGroups,
  computeGlobalProportions,
  distributeGroupsToPlates,
  distributeGroupsToRows,
  distributeQcByCovariate,
  sortGroupsByDescendingSize,
} from './repeatedMeasuresDistribution';
import { greedyPlaceInRow } from './greedySpatialPlacement';
import { shuffleArray } from '../utils/utils';

/**
 * Represents an equivalence class of patient groups:
 * all groups with the same covariateKey and group size.
 * Under equivalence collapse, patients within the same GroupType
 * are interchangeable for DP state purposes.
 */
export interface GroupType {
  covariateKey: string;        // e.g. "Responder|T1"
  groupSize: number;          // number of samples per patient group (e.g. 3 timepoints)
  count: number;              // how many patient groups share this (covariateKey, groupSize) pair
  groups: SubjectGroup[];     // the actual groups (for final assignment)
}

/**
 * Collapses patient groups into equivalence classes by (covariateKey, groupSize).
 * Groups with the same covariateKey and size are interchangeable for DP optimization.
 *
 * The covariateKey for each group is derived from the first sample's covariateKey property.
 * Uses '#' as delimiter: "covariateKey#groupSize" (e.g. "Responder|T1#3").
 *
 * Returns sorted by total weight descending (groupSize × count), so heaviest types come first.
 */
export function buildGroupTypes(groups: SubjectGroup[]): GroupType[] {
  const typeMap = new Map<string, GroupType>();

  for (const group of groups) {
    const covariateKey = group.samples[0]?.covariateKey ?? '';
    const key = `${covariateKey}#${group.size}`;

    const existing = typeMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.groups.push(group);
    } else {
      typeMap.set(key, {
        covariateKey,
        groupSize: group.size,
        count: 1,
        groups: [group],
      });
    }
  }

  const result = Array.from(typeMap.values());

  // Sort by total weight descending (groupSize × count)
  result.sort((a, b) => (b.groupSize * b.count) - (a.groupSize * a.count));

  return result;
}

/**
 * Serializes a composition vector (Map<covariateKey, sampleCount>) into a canonical
 * string for use as a DP memo key. Keys are sorted alphabetically for determinism.
 *
 * Example: { "NonResp|T1" → 3, "Resp|T1" → 4 } → "NonResp|T1:3,Resp|T1:4"
 * Empty map → ""
 */
export function serializeComposition(composition: Map<string, number>): string {
  if (composition.size === 0) return '';
  return Array.from(composition.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}:${count}`)
    .join(',');
}

/**
 * Isolated scoring function for DP optimization.
 * Thin wrapper around covariateImbalanceScore for a single sample set.
 * Isolating it here means swapping to TVD or another metric requires changing only this function.
 */
export function rowImbalanceScore(
  samples: SearchData[],
  globalProportions: Map<string, number>
): number {
  return covariateImbalanceScore([], samples, globalProportions);
}

/**
 * Assigns patient groups to rows within a single plate using exact DP.
 *
 * State: (rowIndex, remainingGroupMultiset) where the multiset tracks how many
 * of each GroupType remain unassigned. Memo key: "rowIdx|serializedRemainingCounts".
 *
 * For each row, enumerates all valid subsets of remaining group types that fit
 * within the row's capacity. Scores each row using rowImbalanceScore. Minimizes
 * the total sum of row-level scores.
 *
 * Pruning strategies:
 * - Capacity_Prune: abandon when remaining groups can't fit in remaining rows
 * - Score_Prune: abandon when partial score >= best complete solution
 * - Feasibility_Prune: abandon when a remaining group size can't fit in any remaining row
 * - Equivalence_Collapse: memo key uses type counts (not patient identities)
 *
 * @param groupTypes - Equivalence classes of patient groups for this plate
 * @param rowCapacities - Available capacity for each row
 * @param globalProportions - Study-wide covariate proportions
 * @param iterationBudget - Max DP states to explore before giving up (default 100,000)
 * @returns assignment map and whether budget was exhausted
 */
export function innerDP(
  groupTypes: GroupType[],
  rowCapacities: number[],
  globalProportions: Map<string, number>,
  iterationBudget: number = 100000,
  greedyBaseline?: { score: number; assignment: Map<number, SubjectGroup[]> }
): { assignment: Map<number, SubjectGroup[]>; exhausted: boolean } {
  const numRows = rowCapacities.length;
  const numTypes = groupTypes.length;

  // Build type keys for serialization: "covariateKey#groupSize"
  const typeKeys = groupTypes.map(gt => `${gt.covariateKey}#${gt.groupSize}`);

  // Initial remaining counts
  const initialRemaining = new Map<string, number>();
  for (let i = 0; i < numTypes; i++) {
    initialRemaining.set(typeKeys[i], groupTypes[i].count);
  }

  // Memo: stores best achievable score from a given state
  const memo = new Map<string, number>();

  // Track best complete assignment found — seed with greedy baseline if provided
  const best: { score: number; choices: Map<string, number>[] | null } = {
    score: greedyBaseline ? greedyBaseline.score : Infinity,
    choices: null,  // greedy assignment is tracked separately
  };

  // Keep the greedy assignment as fallback if DP can't beat it
  let useGreedyFallback = !!greedyBaseline;

  // Current assignment being built during recursion
  const currentChoices: Map<string, number>[] = Array.from({ length: numRows }, () => new Map());

  let iterations = 0;
  let exhausted = false;

  /**
   * Build a memo key from rowIndex and remaining type counts.
   * Format: "rowIdx|typeKey1:count1,typeKey2:count2,..."
   */
  function buildMemoKey(rowIdx: number, remaining: Map<string, number>): string {
    return `${rowIdx}|${serializeComposition(remaining)}`;
  }

  /**
   * Build SearchData[] samples for a given subset selection.
   * For scoring purposes, we create synthetic samples from group types.
   */
  function buildSamplesForSubset(subset: Map<string, number>): SearchData[] {
    const samples: SearchData[] = [];
    for (let i = 0; i < numTypes; i++) {
      const count = subset.get(typeKeys[i]) ?? 0;
      if (count === 0) continue;
      const gt = groupTypes[i];
      // Take count groups of this type, each contributing groupSize samples
      // For scoring, we need samples with the correct covariateKey
      for (let c = 0; c < count; c++) {
        for (let s = 0; s < gt.groupSize; s++) {
          samples.push({ name: '', metadata: {}, covariateKey: gt.covariateKey });
        }
      }
    }
    return samples;
  }

  /**
   * Compute total remaining sample weight from remaining counts.
   */
  function totalRemainingWeight(remaining: Map<string, number>): number {
    let total = 0;
    for (let i = 0; i < numTypes; i++) {
      const count = remaining.get(typeKeys[i]) ?? 0;
      total += count * groupTypes[i].groupSize;
    }
    return total;
  }

  /**
   * Recursive DP: find the best score achievable from (rowIdx, remaining).
   * Returns the best total score from rowIdx onward, or Infinity if infeasible.
   */
  function solve(
    rowIdx: number,
    remaining: Map<string, number>,
    partialScore: number
  ): number {
    // Budget check
    if (exhausted) return Infinity;
    iterations++;
    if (iterations > iterationBudget) {
      exhausted = true;
      return Infinity;
    }

    // Base case: all rows assigned
    if (rowIdx === numRows) {
      // Check all groups are placed
      for (let i = 0; i < numTypes; i++) {
        if ((remaining.get(typeKeys[i]) ?? 0) > 0) return Infinity;
      }
      // Complete assignment found
      if (partialScore < best.score) {
        best.score = partialScore;
        best.choices = currentChoices.map(m => new Map(m));
        useGreedyFallback = false;
      }
      return 0;
    }

    // Memo lookup
    const memoKey = buildMemoKey(rowIdx, remaining);
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;

    // --- Capacity_Prune ---
    const remWeight = totalRemainingWeight(remaining);
    const remainingRowCapacity = rowCapacities.slice(rowIdx).reduce((s, c) => s + c, 0);
    if (remWeight > remainingRowCapacity) {
      memo.set(memoKey, Infinity);
      return Infinity;
    }

    // --- Feasibility_Prune ---
    for (let i = 0; i < numTypes; i++) {
      const count = remaining.get(typeKeys[i]) ?? 0;
      if (count === 0) continue;
      const size = groupTypes[i].groupSize;
      // Check that at least one remaining row can fit this group size
      let canFit = false;
      for (let r = rowIdx; r < numRows; r++) {
        if (rowCapacities[r] >= size) {
          canFit = true;
          break;
        }
      }
      if (!canFit) {
        memo.set(memoKey, Infinity);
        return Infinity;
      }
    }

    const rowCap = rowCapacities[rowIdx];
    let bestFromHere = Infinity;

    // Enumerate all valid subsets of remaining group types that fit in this row.
    // Recursive enumeration over type indices: for each type, choose 0..min(remaining, floor(cap/size)).
    const subset = new Map<string, number>();
    for (let i = 0; i < numTypes; i++) {
      subset.set(typeKeys[i], 0);
    }

    function enumerateSubsets(typeIdx: number, capLeft: number): void {
      if (exhausted) return;

      if (typeIdx === numTypes) {
        // We have a complete subset for this row — score it and recurse
        const samples = buildSamplesForSubset(subset);
        const rowScore = rowImbalanceScore(samples, globalProportions);

        // --- Score_Prune ---
        if (partialScore + rowScore >= best.score) return;

        // Build new remaining after removing this subset
        const newRemaining = new Map(remaining);
        for (let i = 0; i < numTypes; i++) {
          const chosen = subset.get(typeKeys[i]) ?? 0;
          if (chosen > 0) {
            newRemaining.set(typeKeys[i], (remaining.get(typeKeys[i]) ?? 0) - chosen);
          }
        }

        // Save current choice for this row
        currentChoices[rowIdx] = new Map(subset);

        const futureScore = solve(rowIdx + 1, newRemaining, partialScore + rowScore);
        const totalFromHere = rowScore + futureScore;

        if (totalFromHere < bestFromHere) {
          bestFromHere = totalFromHere;
        }

        return;
      }

      const key = typeKeys[typeIdx];
      const available = remaining.get(key) ?? 0;
      const size = groupTypes[typeIdx].groupSize;
      const maxFit = size > 0 ? Math.floor(capLeft / size) : 0;
      const maxPlace = Math.min(available, maxFit);

      for (let count = 0; count <= maxPlace; count++) {
        if (exhausted) return;
        subset.set(key, count);
        enumerateSubsets(typeIdx + 1, capLeft - count * size);
      }
      // Reset for backtracking
      subset.set(key, 0);
    }

    enumerateSubsets(0, rowCap);

    memo.set(memoKey, bestFromHere);
    return bestFromHere;
  }

  // Run the DP
  solve(0, initialRemaining, 0);

  // If DP didn't beat the greedy baseline, return the greedy assignment
  if (useGreedyFallback && greedyBaseline) {
    return { assignment: greedyBaseline.assignment, exhausted };
  }

  // Build the assignment from best.choices
  const assignment = new Map<number, SubjectGroup[]>();
  for (let r = 0; r < numRows; r++) {
    assignment.set(r, []);
  }

  if (best.choices) {
    // Clone group pools so we can pop from them
    const groupPools = new Map<string, SubjectGroup[]>();
    for (let i = 0; i < numTypes; i++) {
      groupPools.set(typeKeys[i], [...groupTypes[i].groups]);
    }

    for (let r = 0; r < numRows; r++) {
      const choices = best.choices[r];
      for (let i = 0; i < numTypes; i++) {
        const count = choices.get(typeKeys[i]) ?? 0;
        const pool = groupPools.get(typeKeys[i])!;
        for (let c = 0; c < count; c++) {
          const group = pool.pop()!;
          assignment.get(r)!.push(group);
        }
      }
    }
  }

  return { assignment, exhausted };
}

/**
 * Assigns patient groups to plates using exact DP.
 *
 * State: (groupTypeIndex, plateCompositions) where plateCompositions is an array
 * of composition vectors (Map<covariateKey, sampleCount>), one per plate.
 *
 * Processes group types one at a time (already sorted heaviest first by buildGroupTypes).
 * For each group type with count=N and numPlates=P, enumerates all ways to split N
 * into P non-negative integers that sum to N, where each plate's allocation doesn't
 * exceed its remaining capacity.
 *
 * Memo key: "groupTypeIdx#plate0Composition#plate1Composition" where '#' separates
 * the index and each plate's serialized composition.
 *
 * Scoring: For each plate, build synthetic samples from the plate's composition vector
 * and score using rowImbalanceScore. Total score is sum across all plates.
 *
 * Pruning strategies:
 * - Capacity_Prune: skip allocation if placing k groups on plate p exceeds capacity
 * - Score_Prune: abandon branch when partial score >= best complete solution
 * - Equivalence_Collapse: memo key uses composition vectors (not patient identities)
 *
 * @param groupTypes - Equivalence classes of patient groups (sorted by total weight desc)
 * @param plateCapacities - Available sample capacity for each plate
 * @param globalProportions - Study-wide covariate proportions
 * @param iterationBudget - Max DP states to explore before giving up (default 50,000)
 * @returns assignment map (plateIndex → SubjectGroup[]) and whether budget was exhausted
 */
export function outerDP(
  groupTypes: GroupType[],
  plateCapacities: number[],
  globalProportions: Map<string, number>,
  iterationBudget: number = 50000,
  greedyBaseline?: { score: number; assignment: Map<number, SubjectGroup[]> }
): { assignment: Map<number, SubjectGroup[]>; exhausted: boolean } {
  const numPlates = plateCapacities.length;
  const numTypes = groupTypes.length;

  // Initialize empty plate compositions and sample counts
  const initialCompositions: Map<string, number>[] = Array.from(
    { length: numPlates },
    () => new Map()
  );
  const initialSampleCounts = new Array(numPlates).fill(0);

  // Memo: stores best achievable score from a given state
  const memo = new Map<string, number>();

  // Track best complete assignment found — seed with greedy baseline if provided
  const best: { score: number; allocations: number[][] | null } = {
    score: greedyBaseline ? greedyBaseline.score : Infinity,
    allocations: null,
  };

  // Keep the greedy assignment as fallback if DP can't beat it
  let useGreedyFallback = !!greedyBaseline;

  // Current allocation being built during recursion
  const currentAllocations: number[][] = Array.from(
    { length: numTypes },
    () => new Array(numPlates).fill(0)
  );

  let iterations = 0;
  let exhausted = false;

  /**
   * Build memo key from groupTypeIndex and plate compositions.
   * Format: "groupTypeIdx#plate0Composition#plate1Composition#..."
   */
  function buildMemoKey(
    gtIdx: number,
    compositions: Map<string, number>[]
  ): string {
    const parts = [String(gtIdx)];
    for (let p = 0; p < numPlates; p++) {
      parts.push(serializeComposition(compositions[p]));
    }
    return parts.join('#');
  }

  /**
   * Build synthetic SearchData[] samples from a plate's composition vector for scoring.
   */
  function buildSamplesFromComposition(
    composition: Map<string, number>
  ): SearchData[] {
    const samples: SearchData[] = [];
    composition.forEach((count, covKey) => {
      for (let i = 0; i < count; i++) {
        samples.push({ name: '', metadata: {}, covariateKey: covKey });
      }
    });
    return samples;
  }

  /**
   * Compute total score across all plates from their composition vectors.
   */
  function scorePlates(compositions: Map<string, number>[]): number {
    let total = 0;
    for (let p = 0; p < numPlates; p++) {
      const samples = buildSamplesFromComposition(compositions[p]);
      if (samples.length > 0) {
        total += rowImbalanceScore(samples, globalProportions);
      }
    }
    return total;
  }

  /**
   * Recursive DP: process group types one at a time, distributing each type's
   * count across plates. Returns best total score from gtIdx onward.
   */
  function solve(
    gtIdx: number,
    compositions: Map<string, number>[],
    sampleCounts: number[],
    partialScore: number
  ): number {
    // Budget check
    if (exhausted) return Infinity;
    iterations++;
    if (iterations > iterationBudget) {
      exhausted = true;
      return Infinity;
    }

    // Base case: all group types assigned
    if (gtIdx === numTypes) {
      // Score the final plate compositions
      const finalScore = scorePlates(compositions);

      if (finalScore < best.score) {
        best.score = finalScore;
        best.allocations = currentAllocations.map(row => [...row]);
        useGreedyFallback = false;
      }
      return finalScore;
    }

    // Memo lookup
    const memoKey = buildMemoKey(gtIdx, compositions);
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;

    // --- Capacity_Prune: check total remaining groups fit in total remaining capacity ---
    let totalRemainingWeight = 0;
    for (let t = gtIdx; t < numTypes; t++) {
      totalRemainingWeight += groupTypes[t].count * groupTypes[t].groupSize;
    }
    const totalRemainingCapacity = sampleCounts.reduce(
      (sum, sc, p) => sum + (plateCapacities[p] - sc),
      0
    );
    if (totalRemainingWeight > totalRemainingCapacity) {
      memo.set(memoKey, Infinity);
      return Infinity;
    }

    const gt = groupTypes[gtIdx];
    const totalCount = gt.count;
    const sampleWeight = gt.groupSize; // samples per group
    let bestFromHere = Infinity;

    /**
     * Enumerate all ways to distribute totalCount groups across plates.
     * For plate 0, try 0..totalCount. For plate 1, try 0..(totalCount - allocated_to_0). Etc.
     * allocation[p] = number of groups of this type assigned to plate p.
     */
    const allocation = new Array(numPlates).fill(0);

    function enumerate(plateIdx: number, remaining: number): void {
      if (exhausted) return;

      if (plateIdx === numPlates) {
        // All groups of this type must be distributed
        if (remaining !== 0) return;

        // Apply allocation to compositions
        const newCompositions = compositions.map(m => new Map(m));
        const newSampleCounts = [...sampleCounts];
        for (let p = 0; p < numPlates; p++) {
          if (allocation[p] > 0) {
            const addedSamples = allocation[p] * sampleWeight;
            const current = newCompositions[p].get(gt.covariateKey) ?? 0;
            newCompositions[p].set(gt.covariateKey, current + addedSamples);
            newSampleCounts[p] += addedSamples;
          }
        }

        // --- Score_Prune: compute current plate scores as proxy ---
        const currentScore = scorePlates(newCompositions);
        if (currentScore >= best.score) return;

        // Save current allocation for this group type
        currentAllocations[gtIdx] = [...allocation];

        const futureScore = solve(
          gtIdx + 1,
          newCompositions,
          newSampleCounts,
          currentScore
        );

        if (futureScore < bestFromHere) {
          bestFromHere = futureScore;
        }
        return;
      }

      // For the last plate, it must take all remaining
      if (plateIdx === numPlates - 1) {
        const k = remaining;
        // --- Capacity_Prune: check plate can hold k groups ---
        if (sampleCounts[plateIdx] + k * sampleWeight > plateCapacities[plateIdx]) {
          return;
        }
        allocation[plateIdx] = k;
        enumerate(plateIdx + 1, 0);
        allocation[plateIdx] = 0;
        return;
      }

      // Try placing 0..remaining groups on this plate
      const plateRemCap = plateCapacities[plateIdx] - sampleCounts[plateIdx];
      const maxFit = sampleWeight > 0 ? Math.floor(plateRemCap / sampleWeight) : 0;
      const maxPlace = Math.min(remaining, maxFit);

      for (let k = 0; k <= maxPlace; k++) {
        if (exhausted) return;
        allocation[plateIdx] = k;
        enumerate(plateIdx + 1, remaining - k);
      }
      allocation[plateIdx] = 0;
    }

    enumerate(0, totalCount);

    memo.set(memoKey, bestFromHere);
    return bestFromHere;
  }

  // Run the DP
  solve(0, initialCompositions, initialSampleCounts, 0);

  // If DP didn't beat the greedy baseline, return the greedy assignment
  if (useGreedyFallback && greedyBaseline) {
    return { assignment: greedyBaseline.assignment, exhausted };
  }

  // Build the assignment from best.allocations
  const assignment = new Map<number, SubjectGroup[]>();
  for (let p = 0; p < numPlates; p++) {
    assignment.set(p, []);
  }

  if (best.allocations) {
    // Clone group pools so we can pop from them
    const groupPools: SubjectGroup[][] = groupTypes.map(gt => [...gt.groups]);

    for (let t = 0; t < numTypes; t++) {
      for (let p = 0; p < numPlates; p++) {
        const count = best.allocations[t][p];
        for (let c = 0; c < count; c++) {
          const group = groupPools[t].pop()!;
          assignment.get(p)!.push(group);
        }
      }
    }
  }

  return { assignment, exhausted };
}


/**
 * Greedy row reordering to minimize vertical adjacency of same covariate groups.
 * Replicates the row reordering logic from groupAwareRandomization.
 *
 * Algorithm:
 * 1. Build a covariate signature for each row — a Map of covariateKey → sample count
 * 2. Start with a random row (shuffled for tie-breaking)
 * 3. Greedily pick the next row whose covariate signature is most different from
 *    the previous row (measured by sum of absolute differences in covariate counts)
 * 4. Break ties by shuffling candidates (randomized tie-breaking), then by row index
 *
 * @param rowAssignments - Map from row index to the SubjectGroups assigned to that row
 * @param numRows - Total number of rows (0..numRows-1)
 * @returns Permutation of [0, 1, ..., numRows-1] representing the new row ordering
 */
export function reorderRows(
  rowAssignments: Map<number, SubjectGroup[]>,
  numRows: number
): number[] {
  if (numRows <= 1) return Array.from({ length: numRows }, (_, i) => i);

  // Build covariate signature for each row: Map<covariateKey, sampleCount>
  const rowSignatures: Map<string, number>[] = [];
  for (let r = 0; r < numRows; r++) {
    const sig = new Map<string, number>();
    const groups = rowAssignments.get(r) ?? [];
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
  const remaining = new Set(Array.from({ length: numRows }, (_, i) => i));
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
      if (diff > bestDiff || (diff === bestDiff && (bestRow === -1 || r < bestRow))) {
        bestDiff = diff;
        bestRow = r;
      }
    }

    orderedRows.push(bestRow);
    remaining.delete(bestRow);
  }

  return orderedRows;
}


/**
 * Computes the total row-level imbalance score for a row assignment.
 * Used to score greedy baselines for comparison with DP results.
 */
function computeAssignmentScore(
  assignment: Map<number, SubjectGroup[]>,
  globalProportions: Map<string, number>
): number {
  let total = 0;
  assignment.forEach(groups => {
    const samples = groups.flatMap(g => g.samples);
    if (samples.length > 0) {
      total += rowImbalanceScore(samples, globalProportions);
    }
  });
  return total;
}

/**
 * Computes the total plate-level imbalance score for a plate assignment.
 * Used to score greedy baselines for outerDP comparison.
 */
function computePlateAssignmentScore(
  assignment: Map<number, SubjectGroup[]>,
  globalProportions: Map<string, number>
): number {
  let total = 0;
  assignment.forEach(groups => {
    const samples = groups.flatMap(g => g.samples);
    if (samples.length > 0) {
      total += rowImbalanceScore(samples, globalProportions);
    }
  });
  return total;
}

/**
 * Drop-in replacement for groupAwareRandomization using hybrid DP optimization.
 * Same signature, same return type.
 *
 * Pipeline:
 * 1. Input validation
 * 2. Separate QC from experimental samples
 * 3. Compute numPlates, distribute QC
 * 4. Phase 1 QC: uniform effective row capacities
 * 5. Build patient groups, validate
 * 6. Compute global proportions
 * 7. Build GroupTypes (equivalence collapse)
 * 8. Outer assignment (DP or greedy FFD)
 * 9. Per-plate inner assignment (DP or composition solver)
 * 10. Phase 2 QC remainder placement
 * 11. Row reordering
 * 12. Column placement via greedyPlaceInRow
 * 13. Build return structure
 */
export function groupAwareDPRandomization(
  searches: SearchData[],
  selectedCovariates: string[],
  repeatedMeasuresConfig: RepeatedMeasuresConfig,
  keepEmptyInLastPlate: boolean,  // accepted but ignored
  numRows: number,
  numColumns: number
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments?: Map<number, SearchData[]>;
} {
  const { subjectColumn, groupingConstraint } = repeatedMeasuresConfig;

  // Step 1: Input validation
  if (!subjectColumn) {
    throw new Error('groupAwareDPRandomization requires a subjectColumn to be set');
  }

  // Step 2: Separate QC from experimental samples
  const qcSamples = shuffleArray(searches.filter(s => s.isQC === true));
  const experimentalSamples = searches.filter(s => s.isQC !== true);

  // Ensure covariateKey is set on experimental samples
  for (const sample of experimentalSamples) {
    if (!sample.covariateKey && selectedCovariates.length > 0) {
      sample.covariateKey = selectedCovariates.map(cov => sample.metadata[cov] || 'N/A').join('|');
    }
  }

  // Step 3: Compute numPlates and distribute QC
  const plateSize = numRows * numColumns;
  const numPlates = Math.ceil(searches.length / plateSize);

  const qcPerPlateRow = distributeQcByCovariate(qcSamples, numPlates, numRows);

  // Step 4: Phase 1 QC — compute uniform effective row capacities
  // For each plate, phase1QCPerRow = floor(totalQCForPlate / numRows)
  // Effective row capacity = numColumns - phase1QCPerRow (uniform across all rows on a plate)
  const effectiveRowCapPerPlate: number[] = [];
  const plateCapacities: number[] = [];

  for (let p = 0; p < numPlates; p++) {
    let totalQCForPlate = 0;
    for (let r = 0; r < numRows; r++) {
      totalQCForPlate += qcPerPlateRow[p][r].length;
    }
    const phase1QCPerRow = Math.floor(totalQCForPlate / numRows);
    const effectiveRowCap = numColumns - phase1QCPerRow;
    effectiveRowCapPerPlate.push(effectiveRowCap);
    plateCapacities.push(effectiveRowCap * numRows);
  }

  // Step 5: Build patient groups and validate
  const allGroups = buildSubjectGroups(experimentalSamples, subjectColumn);
  const totalWellCapacity = numPlates * numRows * numColumns;
  const plateCapacity = numRows * numColumns;
  const validation = validateSubjectGroups(
    allGroups,
    groupingConstraint,
    numColumns,       // rowCapacity
    plateCapacity,    // plateCapacity
    totalWellCapacity,
    numRows,
    qcSamples.length
  );
  if (!validation.isValid) {
    throw new Error(validation.errors.join('\n'));
  }

  // Step 6: Compute global proportions from ALL experimental samples
  const globalProportions = selectedCovariates.length > 0
    ? computeGlobalProportions(experimentalSamples)
    : new Map<string, number>();

  // Step 7: Build GroupTypes (equivalence collapse)
  const groupTypes = buildGroupTypes(allGroups);

  // Step 8: Outer assignment — assign groups to plates
  let plateGroupAssignments: Map<number, SubjectGroup[]>;

  if (numPlates <= 2) {
    // Run greedy FFD first as baseline
    const greedyPlateAssignment = distributeGroupsToPlates(
      allGroups,
      plateCapacities,
      globalProportions
    );
    const greedyPlateScore = computePlateAssignmentScore(greedyPlateAssignment, globalProportions);

    // Try DP for ≤2 plates, seeded with greedy baseline
    const dpResult = outerDP(
      groupTypes, plateCapacities, globalProportions, 50000,
      { score: greedyPlateScore, assignment: greedyPlateAssignment }
    );
    if (dpResult.exhausted) {
      console.log('DP Optimizer: Outer DP budget exceeded, using greedy FFD result');
    }
    plateGroupAssignments = dpResult.assignment;
  } else {
    console.log('DP Optimizer: >2 plates, using greedy FFD for plate assignment');
    plateGroupAssignments = distributeGroupsToPlates(
      allGroups,
      plateCapacities,
      globalProportions
    );
  }

  // Step 9: Per-plate inner assignment — assign groups to rows
  const plateRowAssignments: Map<number, Map<number, SubjectGroup[]>> = new Map();

  for (let p = 0; p < numPlates; p++) {
    const plateGroups = plateGroupAssignments.get(p) ?? [];
    const rowCapacities = new Array(numRows).fill(effectiveRowCapPerPlate[p]);

    // Build plate-local GroupTypes
    const plateGroupTypes = buildGroupTypes(plateGroups);
    const distinctGroupTypes = plateGroupTypes.length;
    const threshold = 20;

    let rowAssignment: Map<number, SubjectGroup[]>;

    if (distinctGroupTypes <= threshold) {
      // Run greedy composition solver first as baseline
      const greedyRowAssignment = distributeGroupsToRows(
        plateGroups,
        rowCapacities,
        globalProportions
      );
      const greedyRowScore = computeAssignmentScore(greedyRowAssignment, globalProportions);

      // Run DP WITHOUT greedy seeding first — let it explore freely
      const dpResult = innerDP(
        plateGroupTypes, rowCapacities, globalProportions, 100000
      );
      const dpScore = dpResult.exhausted ? Infinity : computeAssignmentScore(dpResult.assignment, globalProportions);

      // Use whichever produced the better score
      if (!dpResult.exhausted && dpScore <= greedyRowScore) {
        console.log(`DP Optimizer: Plate ${p} — DP improved! greedy: ${greedyRowScore.toFixed(6)}, DP: ${dpScore.toFixed(6)}`);
        rowAssignment = dpResult.assignment;
      } else {
        console.log(`DP Optimizer: Plate ${p} — using greedy (score: ${greedyRowScore.toFixed(6)}, DP: ${dpScore === Infinity ? 'exhausted' : dpScore.toFixed(6)})`);
        rowAssignment = greedyRowAssignment;
      }
    } else {
      console.log(`DP Optimizer: >${threshold} distinct group types on plate ${p}, using composition solver`);
      rowAssignment = distributeGroupsToRows(
        plateGroups,
        rowCapacities,
        globalProportions
      );
    }

    plateRowAssignments.set(p, rowAssignment);
  }

  // Step 10: Phase 2 QC — place remaining QC samples into rows with available capacity
  // Phase 1 placed phase1QCPerRow per row uniformly. The remainder QC samples
  // (beyond phase1QCPerRow per row from the original qcPerPlateRow distribution)
  // need to be placed into rows that still have capacity.
  const phase2QcPerPlateRow: SearchData[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: numRows }, () => [])
  );

  for (let p = 0; p < numPlates; p++) {
    let totalQCForPlate = 0;
    for (let r = 0; r < numRows; r++) {
      totalQCForPlate += qcPerPlateRow[p][r].length;
    }
    const phase1QCPerRow = Math.floor(totalQCForPlate / numRows);

    // Collect all QC samples for this plate, split into phase1 and phase2
    const allQcForPlate: SearchData[] = [];
    for (let r = 0; r < numRows; r++) {
      allQcForPlate.push(...qcPerPlateRow[p][r]);
    }

    // Phase 1: first phase1QCPerRow * numRows samples (uniformly distributed)
    const phase1Total = phase1QCPerRow * numRows;
    const phase2Samples = allQcForPlate.slice(phase1Total);

    // Compute how many experimental samples are in each row
    const rowAssignment = plateRowAssignments.get(p)!;
    const rowExpCounts: number[] = new Array(numRows).fill(0);
    for (let r = 0; r < numRows; r++) {
      const groups = rowAssignment.get(r) ?? [];
      rowExpCounts[r] = groups.reduce((sum, g) => sum + g.size, 0);
    }

    // Place phase2 QC into rows with available capacity
    for (const qcSample of phase2Samples) {
      // Find rows with remaining capacity (numColumns - phase1QCPerRow - experimentalCount - phase2AlreadyPlaced)
      let bestRow = -1;
      let bestRemaining = -1;
      for (let r = 0; r < numRows; r++) {
        const used = phase1QCPerRow + rowExpCounts[r] + phase2QcPerPlateRow[p][r].length;
        const remaining = numColumns - used;
        if (remaining > 0 && remaining > bestRemaining) {
          bestRemaining = remaining;
          bestRow = r;
        }
      }
      if (bestRow >= 0) {
        phase2QcPerPlateRow[p][bestRow].push(qcSample);
      }
    }
  }

  // Step 11: Row reordering + Step 12: Column placement + Step 13: Build return structure
  const plates: (SearchData | undefined)[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: numRows }, () => new Array(numColumns).fill(undefined))
  );
  const plateAssignments = new Map<number, SearchData[]>();

  for (let p = 0; p < numPlates; p++) {
    const rowAssignment = plateRowAssignments.get(p)!;

    // Row reordering
    const orderedRows = reorderRows(rowAssignment, numRows);

    let totalQCForPlate = 0;
    for (let r = 0; r < numRows; r++) {
      totalQCForPlate += qcPerPlateRow[p][r].length;
    }
    const phase1QCPerRow = Math.floor(totalQCForPlate / numRows);

    const allPlateSamples: SearchData[] = [];

    for (let physicalRow = 0; physicalRow < numRows; physicalRow++) {
      const logicalRow = orderedRows[physicalRow];
      const rowGroups = rowAssignment.get(logicalRow) ?? [];
      const rowSamples = rowGroups.flatMap(g => g.samples);

      // Collect phase1 QC for this logical row (take phase1QCPerRow from the original distribution)
      const allQcForLogicalRow = qcPerPlateRow[p][logicalRow];
      const phase1Qc = allQcForLogicalRow.slice(0, phase1QCPerRow);

      // Collect phase2 QC for this logical row
      const phase2Qc = phase2QcPerPlateRow[p][logicalRow];

      const allRowSamples = [...rowSamples, ...phase1Qc, ...phase2Qc];
      allPlateSamples.push(...allRowSamples);

      // Column placement
      greedyPlaceInRow(
        allRowSamples,
        plates[p],
        physicalRow,
        numColumns
      );
    }

    plateAssignments.set(p, allPlateSamples);
  }

  return { plates, plateAssignments };
}
