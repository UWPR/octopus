import { SearchData } from '../utils/types';
import { BlockType } from '../utils/types';
import { shuffleArray, groupByCovariates } from '../utils/utils';
import { greedyPlaceInRow, analyzePlateSpatialQuality } from './greedySpatialPlacement';
import { debugLog } from '../utils/configs';

enum OverflowPrioritization {
  BY_CAPACITY = 'by_capacity',      // Prioritize higher capacity blocks (for plates)
  BY_GROUP_BALANCE = 'by_group_balance',  // Prioritize blocks with fewer samples of current group (for rows)
  NONE = 'none'                     // No prioritization - all available blocks considered equally
}


// Exported for testing purposes
export function distributeToBlocks(
  covariateGroups: Map<string, SearchData[]>,
  blockCapacities: number[],
  maxCapacity: number,
  selectedCovariates: string[],
  blockType: BlockType,
  expectedMinimums?: { [blockIdx: number]: { [groupKey: string]: number } }
): Map<number, SearchData[]> {
  const numBlocks = blockCapacities.length;
  const [blockAssignments, blockCounts] = initializeBlockAssignments(numBlocks);

    debugLog(`Distributing samples across ${numBlocks} ${blockType.toLowerCase()}s with capacities: ${blockCapacities.join(', ')}`);

  // PHASE 1: Place samples proportionately
  const [unplacedGroupsMap, remainingSamplesMap] = placeProportionalSamples(
    covariateGroups,
    blockCapacities,
    blockAssignments,
    blockCounts,
    maxCapacity,
    blockType,
    expectedMinimums
  );

  // Phase 2A: Process unplaced groups
  processUnplacedGroups(unplacedGroupsMap, blockCapacities, blockAssignments, blockCounts, blockType);

  // Phase 2B: Process overflow groups with appropriate prioritization strategy
  const prioritization = blockType === BlockType.PLATE ? OverflowPrioritization.BY_CAPACITY : OverflowPrioritization.BY_GROUP_BALANCE;
  processOverflowGroups(remainingSamplesMap, blockCapacities, blockAssignments, blockCounts, prioritization, selectedCovariates, blockType, maxCapacity);

  return blockAssignments;
}


// Helper function to initialize block assignments
function initializeBlockAssignments(numPlates: number): [Map<number, SearchData[]>, number[]] {
  const blockAssignments = new Map<number, SearchData[]>();
  const blockCounts = new Array(numPlates).fill(0);

  for (let i = 0; i < numPlates; i++) {
    blockAssignments.set(i, []);
  }

  return [blockAssignments, blockCounts];
}

// Helper function to get available blocks/plates with capacity
function getAvailableBlocks(
  numBlocks: number,
  blockCapacities: number[],
  blockCounts: number[]
): number[] {
  const availableBlocks = [];
  for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
    const availableCapacity = blockCapacities[blockIdx] - blockCounts[blockIdx];
    if (availableCapacity > 0) {
      // console.log(`  Block is available. Index: ${blockIdx}; Capacity: ${availableCapacity}`);
      availableBlocks.push(blockIdx);
    }
  }
  return availableBlocks;
}

// Helper function to sort groups by size (descending) with randomization for equal-sized groups
function sortGroupsBySize(
  groupsMap: Map<string, SearchData[]>
): Array<[string, SearchData[]]> {
  const groupsArray = Array.from(groupsMap.entries());

  // Group by sample count
  const sizeGroups = new Map<number, Array<[string, SearchData[]]>>();
  groupsArray.forEach(([groupKey, samples]) => {
    const size = samples.length;
    if (!sizeGroups.has(size)) {
      sizeGroups.set(size, []);
    }
    sizeGroups.get(size)!.push([groupKey, samples]);
  });

  // Sort sizes descending and shuffle groups within each size
  const sortedSizes = Array.from(sizeGroups.keys()).sort((a, b) => b - a);
  const result: Array<[string, SearchData[]]> = [];
  sortedSizes.forEach(size => {
    const groupsInSize = sizeGroups.get(size)!;
    const shuffledGroups = shuffleArray(groupsInSize);
    result.push(...shuffledGroups);
  });

  return result;
}

// Helper function to calculate expected minimum samples per block (plates or rows) for each covariate group
// Computes per-block expected minimums using constrained Hamilton (largest-remainder)
// apportionment. Places all samples proportionally in Phase 1 when totalSamples === totalCapacity.
// When totalSamples < totalCapacity (e.g., row-level with empty slots), allocates proportionally
// and leaves remaining capacity unfilled. Throws when totalSamples > totalCapacity.
//
// The `fullBlockCapacity` parameter is kept for signature compatibility but unused by Hamilton.
//
// Exported for testing purposes
export function calculateExpectedMinimums(
  blockCapacities: number[],
  covariateGroups: Map<string, SearchData[]>,
  fullBlockCapacity: number,
  blockType: BlockType
): { [blockIdx: number]: { [groupKey: string]: number } } {

  const totalCapacity = blockCapacities.reduce((sum, capacity) => sum + capacity, 0);

  // Calculate total samples across all groups
  let totalSamples = 0;
  covariateGroups.forEach((samples) => {
    totalSamples += samples.length;
  });

  // Validate that total samples don't exceed total capacity
  if (totalSamples > totalCapacity) {
    throw new Error(
      `Cannot distribute ${totalSamples} samples across ${blockType.toLowerCase()}s with total capacity ${totalCapacity}. ` +
      `Total samples exceed available capacity by ${totalSamples - totalCapacity}.`
    );
  }

  // Use totalCapacity as denominator. When totalSamples === totalCapacity this
  // is standard Hamilton (plates fill exactly). When totalSamples < totalCapacity,
  // per-plate quotas sum to (totalSamples/totalCapacity) × plate_cap, naturally
  // leaving empty slots without forcing over-allocation.
  const quotaDenominator = totalCapacity;

  // Build group entries array
  const groups = Array.from(covariateGroups.entries()).map(
    ([key, samples]) => ({ key, size: samples.length })
  );

  // Precompute surplus samples per group: how many extra samples (beyond floor)
  // each group still needs to place across all blocks. This prevents over-allocation
  // when a later block's unconditional floor would push the group past its total size.
  const surplusSamples = new Map<string, number>();
  groups.forEach(g => {
    let floorSum = 0;
    for (const cap of blockCapacities) {
      floorSum += Math.floor((g.size * cap) / quotaDenominator);
    }
    surplusSamples.set(g.key, g.size - floorSum);
  });
  const surplusUsed = new Map<string, number>(groups.map(g => [g.key, 0]));
  const placed = new Map<string, number>(groups.map(g => [g.key, 0]));
  const result: { [blockIdx: number]: { [groupKey: string]: number } } = {};

  // Process blocks smallest-capacity-first to lock tight allocations early.
  // Among equal-capacity blocks, randomize order to prevent systematic bias.
  const blockOrder = blockCapacities
    .map((cap, idx) => ({ idx, cap }))
    .sort((a, b) => a.cap - b.cap);

  // Shuffle blocks with equal capacity
  let i = 0;
  while (i < blockOrder.length) {
    let j = i;
    while (j < blockOrder.length && blockOrder[j].cap === blockOrder[i].cap) {
      j++;
    }
    // Shuffle the range [i, j) — blocks with equal capacity
    if (j - i > 1) {
      const slice = blockOrder.slice(i, j);
      const shuffled = shuffleArray(slice);
      for (let k = 0; k < shuffled.length; k++) {
        blockOrder[i + k] = shuffled[k];
      }
    }
    i = j;
  }

  debugLog(`Calculating expected minimums per ${blockType} using Hamilton apportionment:`);

  for (const { idx: blockIdx, cap } of blockOrder) {
    const alloc: { [key: string]: number } = {};
    let placedOnBlock = 0;

    // Compute floors and remainders for this block
    const cells = groups.map(g => {
      const quota = (g.size * cap) / quotaDenominator;
      const floor = Math.floor(quota);
      alloc[g.key] = floor;
      placedOnBlock += floor;
      placed.set(g.key, placed.get(g.key)! + floor);
      return { key: g.key, frac: quota - floor };
    });

    // Distribute deficit wells one at a time using largest-remainder
    // with surplus-samples eligibility and smallest-running-allocation tiebreak.
    let deficit = cap - placedOnBlock;
    const gotExtraOnThisBlock = new Set<string>();
    while (deficit > 0) {
      const eligible = cells
        .filter(c =>
          surplusUsed.get(c.key)! < surplusSamples.get(c.key)! &&
          !gotExtraOnThisBlock.has(c.key)
        )
        .sort((a, b) =>
          b.frac - a.frac || placed.get(a.key)! - placed.get(b.key)!
        );

      if (eligible.length === 0) {
        // Under-capacity (totalSamples < totalCapacity): any remaining deficit
        // becomes empty wells. We must NOT round-reset here — doing so would let
        // a group exceed ceil(quota) on this block (e.g., 4 blocks cap=10 with
        // one group of size 35 would put 10 on the first block instead of 9).
        if (totalSamples < totalCapacity) {
          break;
        }
        // Exact-capacity case (totalSamples == totalCapacity): all groups with
        // surplus remaining have already received an extra sample on this block,
        // but deficit > 0 remains. This can happen when only a few groups have
        // surplus to distribute and this block's deficit exceeds the number of
        // eligible groups.
        // Clear the per-block "already got an extra" set to allow a second extra —
        // the global surplus limit still prevents over-allocation.
        const surplusRemaining = cells.filter(c =>
          surplusUsed.get(c.key)! < surplusSamples.get(c.key)!
        );
        if (surplusRemaining.length > 0) {
          gotExtraOnThisBlock.clear();
          continue;
        }
        throw new Error(
          `${blockType} ${blockIdx + 1}: ${deficit} samples unallocated. ` +
          `Input invariant violated — total samples should equal total capacity.`
        );
      }

      const pick = eligible[0];
      alloc[pick.key] += 1;
      placed.set(pick.key, placed.get(pick.key)! + 1);
      surplusUsed.set(pick.key, surplusUsed.get(pick.key)! + 1);
      gotExtraOnThisBlock.add(pick.key);
      deficit -= 1;
    }

    result[blockIdx] = alloc;

    debugLog(`  ${blockType} ${blockIdx + 1} (cap ${cap}): ${JSON.stringify(alloc)}`);
  }

  return result;
}

// Helper function to assign block capacities based on distribution strategy
// Exported for testing purposes
export function assignBlockCapacities(
  totalSamples: number,
  blockSize: number,
  keepEmptyInLastBlock: boolean,
  maxBlocks: number,
  blockName: BlockType
): number[] {

  if (totalSamples === 0) {
    return [0];
  }

  // Calculate minimum blocks needed
  const minBlocksNeeded = Math.ceil(totalSamples / blockSize);

  // Check if we have enough blocks available
  if (minBlocksNeeded > maxBlocks) {
    console.error(`Insufficient blocks: need ${minBlocksNeeded} blocks but only ${maxBlocks} available.`);
    return [0];
  }

  let blockCapacities: number[];

  if (keepEmptyInLastBlock) {
    // Calculate how many blocks should be completely filled
    const fullBlocks = Math.floor(totalSamples / blockSize);
    const remainingSamples = totalSamples % blockSize;
    debugLog(`Calculating ${blockName} capacities with keepEmptyInLastBlock=true: ${totalSamples} samples, ${fullBlocks} full ${blockName}s, ${remainingSamples} remaining samples`);

    // Set capacities: full blocks get blockSize, last block gets remaining samples
    blockCapacities = Array(fullBlocks).fill(blockSize);
    if (remainingSamples > 0) {
      blockCapacities.push(remainingSamples);
    }

    debugLog(`Keep empty in last ${blockName}: ${totalSamples} samples across ${blockCapacities.length} ${blockName}s with capacities: ${blockCapacities.join(', ')}`);
  } else {

    // Distribute samples across all available blocks
    const actualBlocksToUse = maxBlocks;
    const baseSamplesPerBlock = Math.floor(totalSamples / actualBlocksToUse);
    const extraSamples = totalSamples % actualBlocksToUse;

    // Calculate values for logging only
    const totalCapacity = actualBlocksToUse * blockSize;
    const totalEmptySpots = totalCapacity - totalSamples;
    debugLog(`Calculating ${blockName} capacities with keepEmptyInLastBlock=false: ${totalSamples} samples, ${actualBlocksToUse} ${blockName}s, ${totalEmptySpots} empty spots to distribute`);

    blockCapacities = Array(actualBlocksToUse).fill(baseSamplesPerBlock);

    // Randomly assign extra samples to blocks instead of always using the first ones
    const blockIndices = Array.from({ length: actualBlocksToUse }, (_, i) => i);
    const shuffledIndices = shuffleArray(blockIndices);

    for (let i = 0; i < extraSamples; i++) {
      blockCapacities[shuffledIndices[i]]++;
    }

    debugLog(`Random distribution of empty spots: ${totalSamples} samples across ${actualBlocksToUse} ${blockName}s with capacities: ${blockCapacities.join(', ')}`);
  }

  return blockCapacities;
}

// Helper function to validate capacity
function validateCapacity(totalSamples: number, plateCapacities: number[]): boolean {
  const totalCapacity = plateCapacities.reduce((sum, capacity) => sum + capacity, 0);
    debugLog(`Plate capacities: ${plateCapacities.join(', ')}; Sample count: ${totalSamples}`);

  if (totalSamples > totalCapacity) {
    console.error(`Not enough capacity: ${totalSamples} samples > ${totalCapacity} total capacity`);
    return false;
  }
  return true;
}

// Helper function for Phase 1 proportional placement
function placeProportionalSamples(
  covariateGroups: Map<string, SearchData[]>,
  plateCapacities: number[],
  blockAssignments: Map<number, SearchData[]>,
  blockCounts: number[],
  maxCapacity: number = 96,
  blockType: BlockType,
  expectedMinimums?: { [blockIdx: number]: { [groupKey: string]: number } }
): [Map<string, SearchData[]>, Map<string, SearchData[]>] {
  const numPlates = plateCapacities.length;
  const unplacedGroupsMap = new Map<string, SearchData[]>();
  const overflowSamplesMap = new Map<string, SearchData[]>();

  covariateGroups.forEach((samples, groupKey) => {
    const shuffledSamples = shuffleArray([...samples]);
    const totalGroupSamples = shuffledSamples.length;
    const baseSamplesPerPlate = Math.floor(totalGroupSamples / numPlates);

    let sampleIndex = 0;
    debugLog(`Phase 1 (${blockType}): Minimum required samples / plate for group ${groupKey} (${totalGroupSamples}/${numPlates}): ${baseSamplesPerPlate}`);

    // Place samples proportionally in all plates based on capacity ratio or expected minimums
    if (baseSamplesPerPlate > 0) {
      for (let plateIdx = 0; plateIdx < numPlates; plateIdx++) {
        let proportionalSamples: number;
        let logMessage: string;

        if (expectedMinimums && expectedMinimums[plateIdx] && expectedMinimums[plateIdx][groupKey] !== undefined) {
          // Use pre-calculated expected minimum
          proportionalSamples = expectedMinimums[plateIdx][groupKey];
          logMessage = `  Placing proportional samples in ${blockType.toLowerCase()} index ${plateIdx}: ${proportionalSamples} (from expected minimums)`;
        } else {
          // Fall back to capacity ratio calculation
          const capacityRatio = plateCapacities[plateIdx] / maxCapacity;
          proportionalSamples = Math.round(baseSamplesPerPlate * capacityRatio);
          logMessage = `  Placing proportional samples in ${blockType.toLowerCase()} index ${plateIdx}: ${proportionalSamples} (capacity ratio: ${capacityRatio.toFixed(2)})`;
        }

    debugLog(logMessage);

        const availableCapacity = plateCapacities[plateIdx] - blockCounts[plateIdx];
        const samplesToPlace = Math.min(proportionalSamples, availableCapacity);

        if (samplesToPlace < proportionalSamples) {
          console.error(`Phase 1 (${blockType}): ${blockType.slice(0, -1)} ${plateIdx} cannot accommodate proportional ${proportionalSamples} samples for group ${groupKey}. Only ${samplesToPlace} can be placed.`);
        }

        for (let i = 0; i < samplesToPlace && sampleIndex < shuffledSamples.length; i++) {
          blockAssignments.get(plateIdx)!.push(shuffledSamples[sampleIndex++]);
          blockCounts[plateIdx]++;
        }
      }
    }

    // Store remaining samples for Phase 2
    if (sampleIndex < shuffledSamples.length) {
      const remainingSamples = shuffledSamples.slice(sampleIndex);
      if (baseSamplesPerPlate === 0) {
        unplacedGroupsMap.set(groupKey, remainingSamples);
      } else {
        overflowSamplesMap.set(groupKey, remainingSamples);
      }
    }
  });

  return [unplacedGroupsMap, overflowSamplesMap];
}

// Helper function to distribute samples across available blocks
function distributeSamplesAcrossBlocks(
  remainingSamples: SearchData[],
  availableBlocks: number[],
  blockCapacities: number[],
  blockAssignments: Map<number, SearchData[]>,
  blockCounts: number[],
  logPrefix: string,
  preserveOrder: boolean = false
): number {
  const blocksToUse = preserveOrder ? [...availableBlocks] : shuffleArray([...availableBlocks]);
  let sampleIndex = 0;
  let blockIndex = 0;

  while (sampleIndex < remainingSamples.length && blocksToUse.length > 0) {
    const blockIdx = blocksToUse[blockIndex % blocksToUse.length];

    if (blockCounts[blockIdx] < blockCapacities[blockIdx]) {
    debugLog(`  ${logPrefix} sample in block index: ${blockIdx}`);
      blockAssignments.get(blockIdx)!.push(remainingSamples[sampleIndex]);
      blockCounts[blockIdx]++;
      sampleIndex++;
    } else {
      blocksToUse.splice(blockIndex % blocksToUse.length, 1);
      if (blocksToUse.length === 0) break;
      blockIndex = blockIndex % blocksToUse.length;
      continue;
    }

    blockIndex++;
  }

  return sampleIndex;
}

/**
 * Helper function to sort blocks by a metric and randomize blocks with equal values
 * @param blocks - Array of block indices with their associated metric values
 * @param sortAscending - If true, sort metrics ascending; if false, descending
 * @returns Sorted array of block indices with randomization within equal-metric groups
 */
function sortBlocksByMetricWithRandomization<T extends { blockIdx: number; metric: number }>(
  blocks: T[],
  sortAscending: boolean = false
): number[] {
  // Group blocks by their metric value
  const metricGroups = new Map<number, number[]>();
  blocks.forEach(({ blockIdx, metric }) => {
    if (!metricGroups.has(metric)) {
      metricGroups.set(metric, []);
    }
    metricGroups.get(metric)!.push(blockIdx);
  });

  // Sort metric values and shuffle blocks within each group
  const sortedMetrics = Array.from(metricGroups.keys()).sort((a, b) =>
    sortAscending ? a - b : b - a
  );

  const sortedBlocks: number[] = [];
  sortedMetrics.forEach(metric => {
    const blocksInGroup = metricGroups.get(metric)!;
    const shuffledGroup = shuffleArray(blocksInGroup);
    sortedBlocks.push(...shuffledGroup);
  });

  return sortedBlocks;
}

// Helper function for Phase 2A - unplaced groups
function processUnplacedGroups(
  unplacedGroupsMap: Map<string, SearchData[]>,
  blockCapacities: number[],
  blockAssignments: Map<number, SearchData[]>,
  blockCounts: number[],
  blockType: BlockType
): void {
  const numBlocks = blockCapacities.length;
  const sortedUnplacedGroups = sortGroupsBySize(unplacedGroupsMap);

  sortedUnplacedGroups.forEach(([groupKey, remainingSamples]) => {
    debugLog(`Phase 2A (${blockType}): Unplaced group ${groupKey}: ${remainingSamples.length} samples`);

    const availableBlocks = getAvailableBlocks(numBlocks, blockCapacities, blockCounts);

    if (availableBlocks.length === 0) {
      console.error(`Phase 2A (${blockType}): No available capacity for unplaced group ${groupKey}`);
      return;
    }

    // Sort by available capacity descending, but randomize blocks with the same capacity
    const blocksWithCapacity = availableBlocks.map(blockIdx => ({
      blockIdx,
      metric: blockCapacities[blockIdx] - blockCounts[blockIdx]
    }));

    const blocksToUse = sortBlocksByMetricWithRandomization(blocksWithCapacity, false);

    const placedSamples = distributeSamplesAcrossBlocks(
      remainingSamples,
      blocksToUse,
      blockCapacities,
      blockAssignments,
      blockCounts,
      `Placing 1 unplaced (${blockType})`,
      true // Use the order determined above
    );

    if (placedSamples < remainingSamples.length) {
      console.error(`Phase 2A (${blockType}): Failed to place ${remainingSamples.length - placedSamples} unplaced samples from group ${groupKey}`);
    }
  });
}

// Helper function for Phase 2B - overflow groups
function processOverflowGroups(
  overflowSamplesMap: Map<string, SearchData[]>,
  plateCapacities: number[],
  blockAssignments: Map<number, SearchData[]>,
  blockCounts: number[],
  prioritization: OverflowPrioritization,
  selectedCovariates: string[] = [],
  blockType: BlockType,
  fullCapacity: number = 96
): void {
  const numPlates = plateCapacities.length;
  const sortedOverflowGroups = sortGroupsBySize(overflowSamplesMap);

  sortedOverflowGroups.forEach(([groupKey, remainingSamples]) => {
    debugLog(`Phase 2B (${blockType}): Overflow group ${groupKey}: ${remainingSamples.length} samples`);

    const availableBlocks = getAvailableBlocks(numPlates, plateCapacities, blockCounts);

    if (availableBlocks.length === 0) {
      console.error(`Phase 2B (${blockType}): No available capacity for overflow group ${groupKey}`);
      return;
    }

    let prioritizedBlocks: number[];

    if (prioritization === OverflowPrioritization.BY_CAPACITY) {
      // Prioritize higher capacity blocks (for plate-level distribution)
      const fullCapacityBlocks: number[] = [];
      const partialCapacityBlocks: number[] = [];

      availableBlocks.forEach(blockIdx => {
        if (plateCapacities[blockIdx] === fullCapacity) {
          fullCapacityBlocks.push(blockIdx);
        } else {
          partialCapacityBlocks.push(blockIdx);
        }
      });

      const shuffledFullBlocks = shuffleArray([...fullCapacityBlocks]);
      const shuffledPartialBlocks = shuffleArray([...partialCapacityBlocks]);
      prioritizedBlocks = [...shuffledFullBlocks, ...shuffledPartialBlocks];
    } else if (prioritization === OverflowPrioritization.BY_GROUP_BALANCE) {
      // Prioritize blocks with fewer samples of this covariate group (for row-level distribution)
      const blockGroupCounts = availableBlocks.map(blockIdx => {
        const blockSamples = blockAssignments.get(blockIdx) || [];
        const groupCount = blockSamples.filter(sample =>
          sample.covariateKey === groupKey
        ).length;
        return { blockIdx, metric: groupCount };
      });

      prioritizedBlocks = sortBlocksByMetricWithRandomization(blockGroupCounts, true);
    } else {
      // No prioritization - shuffle all available blocks equally
      prioritizedBlocks = shuffleArray([...availableBlocks]);
    }

    const placedSamples = distributeSamplesAcrossBlocks(
      remainingSamples,
      prioritizedBlocks,
      plateCapacities,
      blockAssignments,
      blockCounts,
      `Placing 1 overflow (${blockType})`,
      true // Preserve priority order
    );

    if (placedSamples < remainingSamples.length) {
      console.error(`Phase 2B (${blockType}): Failed to place ${remainingSamples.length - placedSamples} overflow samples from group ${groupKey}`);
    }
  });
}



// Validation function for per-block distribution (plates or rows)
function validatePerBlockDistribution(
  blockAssignments: Map<number, SearchData[]>,
  selectedCovariates: string[],
  expectedMinimumsPerBlock: { [blockIdx: number]: { [groupKey: string]: number } },
  blockTypeName: BlockType
): boolean {
  let isValid = true;

  blockAssignments.forEach((samples, blockIdx) => {
    const groupCounts = new Map<string, number>();

    // Count samples by group in this block
    samples.forEach(sample => {
      const groupKey = sample.covariateKey || '';
      groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
    });

    const blockExpectedMinimums = expectedMinimumsPerBlock[blockIdx] || {};

    // Check if each group meets minimum requirements
    Object.entries(blockExpectedMinimums).forEach(([groupKey, minCount]) => {
      const actualCount = groupCounts.get(groupKey) || 0;
      if (actualCount < minCount) {
        console.error(`Validation: ${blockTypeName} ${blockIdx} has only ${actualCount} samples for group ${groupKey}, expected minimum ${minCount}`);
        isValid = false;
      }
    });
  });

  return isValid;
}


// Balanced randomization (proportional distribution in plates and rows + row shuffling)
export function balancedBlockRandomization(
  searches: SearchData[],
  selectedCovariates: string[],
  keepEmptyInLastPlate: boolean = true,
  numRows: number = 8,
  numColumns: number = 12
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments?: Map<number, SearchData[]>;
} {
  return doBalancedRandomization(searches, selectedCovariates, keepEmptyInLastPlate, numRows, numColumns);
}

// Core balanced randomization implementation
function doBalancedRandomization(
  searches: SearchData[],
  selectedCovariates: string[],
  keepEmptyInLastPlate: boolean = true,
  numRows: number = 8,
  numColumns: number = 12
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments?: Map<number, SearchData[]>;
} {
  const totalSamples = searches.length;
  const plateSize = numRows * numColumns;
    debugLog(`Starting balanced randomization for ${totalSamples} samples with plate size ${plateSize} (${numRows} rows x ${numColumns} columns)`);

  // Calculate number of plates needed
  const actualPlatesNeeded = Math.ceil(totalSamples / plateSize);
    debugLog(`Plates needed: ${actualPlatesNeeded}`);
  const plateCapacities = assignBlockCapacities(totalSamples, plateSize, keepEmptyInLastPlate, actualPlatesNeeded, BlockType.PLATE);

  const plates = Array.from({ length: actualPlatesNeeded }, () =>
    Array.from({ length: numRows }, () => new Array(numColumns).fill(undefined))
  );

  // STEP 1: Group samples by covariate combinations
  const covariateGroups = groupByCovariates(searches, selectedCovariates);

  // STEP 1.5: Validate that we have enough capacity for all samples
  if (!validateCapacity(totalSamples, plateCapacities)) {
    // Return empty plates if validation fails
    return {
      plates: Array.from({ length: actualPlatesNeeded }, () =>
        Array.from({ length: numRows }, () => new Array(numColumns).fill(undefined))
      )
    };
  }

  // STEP 2: Calculate expected minimums per plate based on plate capacities
  const expectedMinimumsPerPlate = calculateExpectedMinimums(
    plateCapacities,
    covariateGroups,
    plateSize,
    BlockType.PLATE
  );

  // STEP 3: Distribute samples across plates
  const plateAssignments = distributeToBlocks(covariateGroups, plateCapacities, plateSize, selectedCovariates, BlockType.PLATE, expectedMinimumsPerPlate);

  // STEP 4: Validate plate-level distribution
  const plateDistributionValid = validatePerBlockDistribution(plateAssignments, selectedCovariates, expectedMinimumsPerPlate, BlockType.PLATE);
  if (!plateDistributionValid) {
    console.error("Plate-level distribution validation failed");
  }

  // STEP 5: For each plate, apply the distribution and randomization strategy to rows
  plateAssignments.forEach((plateSamples, plateIdx) => {

    // STEP 5B: Row-Based Distribution - Distribute samples across rows
    debugLog(`Applying row-based distribution to plate ${plateIdx + 1} with ${plateSamples.length} samples`);

    // Shuffle plate samples before grouping to add initial randomization
    const shuffledPlateSamples = shuffleArray([...plateSamples]);

    // Group samples by covariates for this plate
    const plateGroups = groupByCovariates(shuffledPlateSamples, selectedCovariates);

    // Calculate row capacities based on keepEmptyInLastPlate setting
    const totalPlateSamples = plateSamples.length;
    const plateCapacity = plateCapacities[plateIdx];
    debugLog(`Plate ${plateIdx + 1} has ${totalPlateSamples} samples, capacity ${plateCapacity}, max rows available: ${numRows}`);

    // assignBlockCapacities will determine how many rows to use based on keepEmptyInLastPlate
    // If keepEmptyInLastPlate is true, fill rows sequentially (empty cells in last rows)
    // If keepEmptyInLastPlate is false, distribute empty cells randomly across rows
    const rowCapacities = assignBlockCapacities(plateCapacity, numColumns, keepEmptyInLastPlate, numRows, BlockType.ROW);

    // Calculate expected minimums per row
    const expectedRowMinimums = calculateExpectedMinimums(
      rowCapacities,
      plateGroups,
      numColumns,
      BlockType.ROW
    );


    const rowAssignments = distributeToBlocks(plateGroups, rowCapacities, numColumns, selectedCovariates, BlockType.ROW, expectedRowMinimums);

    // Validate row-level distribution
    const rowDistributionValid = validatePerBlockDistribution(rowAssignments, selectedCovariates, expectedRowMinimums, BlockType.ROW);
    if (!rowDistributionValid) {
      console.error(`Row-level distribution validation failed for plate ${plateIdx}`);
    }

    // Fill positions using greedy spatial placement to minimize clustering
    rowAssignments.forEach((rowSamples, rowIdx) => {
      if (rowIdx < numRows) {
        // Use greedy placement instead of simple shuffling
        greedyPlaceInRow(
          rowSamples,
          plates[plateIdx],
          rowIdx,
          numColumns,
          keepEmptyInLastPlate
        );
      }
    });

    const spatialQuality = analyzePlateSpatialQuality(plates[plateIdx], numRows, numColumns);
    debugLog(`Spatial Quality Analysis: Plate ${plateIdx + 1}: H=${spatialQuality.horizontalClusters}, V=${spatialQuality.verticalClusters}, CR=${spatialQuality.crossRowClusters}, Total=${spatialQuality.totalClusters}`);
  });

  // STEP 6: Global optimization pass - DISABLED to preserve row-level distribution
  // The optimization was breaking the proportional distribution by moving samples between rows
  // console.log('\n=== Starting Global Optimization ===');
  // const totalImprovements = optimizeAllPlates(plates, numRows, numColumns, 100);
  // console.log(`=== Optimization Complete: ${totalImprovements} total improvements ===\n`);

  return {
    plates,
    plateAssignments
  };
}
