import { SearchData, BlockType } from '../utils/types';
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

// Returns, for each (block, group) pair, how many samples of that group should
// land in that block. Uses largest-remainder (Hamilton) apportionment over the
// whole (group, block) grid:
//
//   quota = groupSize * blockCap / totalCapacity
//   each (group, block) gets floor(quota), then +1s are awarded by descending
//   fractional remainder until every sample is placed.
//
// When totalSamples == totalCapacity, blocks fill exactly. When
// totalSamples < totalCapacity (rows can be under-filled), the unfilled wells
// fall out naturally. Throws when totalSamples > totalCapacity.
//
// Exported for testing purposes.
export function calculateExpectedMinimums(
  blockCapacities: number[],
  covariateGroups: Map<string, SearchData[]>,
  blockType: BlockType
): { [blockIdx: number]: { [groupKey: string]: number } } {

  const totalCapacity = blockCapacities.reduce((sum, capacity) => sum + capacity, 0);

  let totalSamples = 0;
  covariateGroups.forEach(samples => { totalSamples += samples.length; });

  if (totalSamples > totalCapacity) {
    throw new Error(
      `Cannot distribute ${totalSamples} samples across ${blockType.toLowerCase()}s with total capacity ${totalCapacity}. ` +
      `Total samples exceed available capacity by ${totalSamples - totalCapacity}.`
    );
  }

  const numBlocks = blockCapacities.length;
  const result: { [blockIdx: number]: { [groupKey: string]: number } } = {};
  for (let b = 0; b < numBlocks; b++) result[b] = {};

  // Pass 1: compute the floor and fractional remainder for each (group, block).
  // `groupSurplus` tracks how many samples from each group still need to be
  // placed on some block (groupSize minus the sum of floors across all blocks).
  // `blockDeficit` tracks how many more samples each block needs to reach its capacity.
  // `eligibleByGroup` records which blocks have non-zero remainder for the group
  // (frac > 0) and could receive a +1; `awardedByGroup` tracks which ones did,
  // for the repair pass below.
  type QuotaRemainder = { groupKey: string; blockIdx: number; frac: number };
  const FRAC_EPSILON = 1e-9;
  const quotaRemainders: QuotaRemainder[] = [];
  const groupSurplus = new Map<string, number>();
  const eligibleByGroup = new Map<string, Set<number>>();
  const awardedByGroup = new Map<string, Set<number>>();
  const blockFloorSum = new Array<number>(numBlocks).fill(0);

  covariateGroups.forEach((samples, groupKey) => {
    const groupSize = samples.length;
    let floorSum = 0;
    const eligibleBlocks = new Set<number>();
    for (let b = 0; b < numBlocks; b++) {
      const quota = (groupSize * blockCapacities[b]) / totalCapacity;
      const floor = Math.floor(quota);
      const frac = quota - floor;
      result[b][groupKey] = floor;
      floorSum += floor;
      blockFloorSum[b] += floor;
      quotaRemainders.push({ groupKey, blockIdx: b, frac });
      if (frac > FRAC_EPSILON) eligibleBlocks.add(b);
    }
    groupSurplus.set(groupKey, groupSize - floorSum);
    eligibleByGroup.set(groupKey, eligibleBlocks);
    awardedByGroup.set(groupKey, new Set<number>());
  });

  const blockDeficit = blockCapacities.map((cap, b) => cap - blockFloorSum[b]);

  // Pass 2: award +1s by descending fractional remainder (random tiebreak),
  // skipping cells with zero frac (integer quota; +1 there would over-place
  // the group on that block).
  let unplaced = 0;
  groupSurplus.forEach(n => { unplaced += n; });

  const ordered = shuffleArray(quotaRemainders.filter(c => c.frac > FRAC_EPSILON));
  ordered.sort((a, b) => b.frac - a.frac);

  for (const c of ordered) {
    if (unplaced <= 0) break;
    if ((groupSurplus.get(c.groupKey) ?? 0) <= 0) continue;
    if (blockDeficit[c.blockIdx] <= 0) continue;
    result[c.blockIdx][c.groupKey] += 1;
    awardedByGroup.get(c.groupKey)!.add(c.blockIdx);
    groupSurplus.set(c.groupKey, groupSurplus.get(c.groupKey)! - 1);
    blockDeficit[c.blockIdx] -= 1;
    unplaced -= 1;
  }

  // Pass 3: repair. The greedy pass can leave a group with samples still unplaced
  // while every block that could accept one of its samples is already full from
  // other groups' +1s. Fix this by finding a swap chain (BFS along alternating
  // not-yet-awarded / awarded edges) from a group with unplaced samples to a
  // block that still has room, then flipping each edge along the chain. One
  // group places a sample, one block fills a slot, and every intermediate
  // group/block nets zero change.
  // See docs/hamilton-2d-augmenting-path.svg for a worked example.
  while (unplaced > 0) {
    let startGroup: string | null = null;
    groupSurplus.forEach((n, g) => {
      if (startGroup === null && n > 0) { startGroup = g; }
    });
    if (startGroup === null) break;

    const visitedGroups = new Set<string>([startGroup]);
    const visitedBlocks = new Set<number>();
    const blockFrom = new Map<number, string>();
    const groupFrom = new Map<string, number>();

    let frontierGroups: string[] = [startGroup];
    let endBlock = -1;

    bfs:
    while (frontierGroups.length > 0) {
      const frontierBlocks: number[] = [];
      for (let fi = 0; fi < frontierGroups.length; fi++) {
        const g = frontierGroups[fi];
        const elig = eligibleByGroup.get(g);
        if (!elig) continue;
        const awarded = awardedByGroup.get(g)!;
        const eligArr = Array.from(elig);
        for (let ei = 0; ei < eligArr.length; ei++) {
          const b = eligArr[ei];
          if (visitedBlocks.has(b)) continue;
          if (awarded.has(b)) continue;
          visitedBlocks.add(b);
          blockFrom.set(b, g);
          if (blockDeficit[b] > 0) {
            endBlock = b;
            break bfs;
          }
          frontierBlocks.push(b);
        }
      }
      if (frontierBlocks.length === 0) break;

      const nextGroups: string[] = [];
      for (let bi = 0; bi < frontierBlocks.length; bi++) {
        const b = frontierBlocks[bi];
        awardedByGroup.forEach((awarded, g) => {
          if (!awarded.has(b)) return;
          if (visitedGroups.has(g)) return;
          visitedGroups.add(g);
          groupFrom.set(g, b);
          nextGroups.push(g);
        });
      }
      frontierGroups = nextGroups;
    }

    if (endBlock < 0) {
      // Unreachable for quotas of the form groupSize * blockCap / totalCapacity:
      // every still-needy group has at least one eligible block, every block
      // with room has at least one eligible group, and the row/column totals
      // are consistent, so a swap chain always exists. Treated as an assertion.
      throw new Error(
        `Hamilton apportionment invariant violated: no swap chain from group ` +
        `${startGroup} to a ${blockType.toLowerCase()} with remaining room.`
      );
    }

    // Walk the chain backwards from the room-having block, flipping each edge.
    let curBlock = endBlock;
    while (true) {
      const g = blockFrom.get(curBlock)!;
      result[curBlock][g] += 1;
      awardedByGroup.get(g)!.add(curBlock);
      if (g === startGroup) break;
      const prevBlock = groupFrom.get(g)!;
      result[prevBlock][g] -= 1;
      awardedByGroup.get(g)!.delete(prevBlock);
      curBlock = prevBlock;
    }

    groupSurplus.set(startGroup, groupSurplus.get(startGroup)! - 1);
    blockDeficit[endBlock] -= 1;
    unplaced -= 1;
  }

  debugLog(`Calculating expected minimums per ${blockType} using Hamilton apportionment:`);
  for (let b = 0; b < numBlocks; b++) {
    debugLog(`  ${blockType} ${b + 1} (cap ${blockCapacities[b]}): ${JSON.stringify(result[b])}`);
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
