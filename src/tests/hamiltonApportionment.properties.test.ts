/**
 * Property-based tests for Hamilton (largest-remainder) plate apportionment
 * in `calculateExpectedMinimums`.
 *
 * These tests generate random (blockCapacities, group sizes) inputs and
 * assert that the algorithm output satisfies Hamilton's invariants on every
 * generated case. They complement the hand-picked example tests in
 * `hamiltonApportionment.test.ts`, surfacing edge cases that scenario-based
 * tests can miss.
 *
 * Invariants asserted:
 *   1. Per-group sum equals group size (every sample placed).
 *   2. Per-plate sum equals plate capacity (only when totalSamples ===
 *      totalCapacity; under-capacity inputs leave empty wells).
 *   3. Every cell within ±1 of the continuous ideal
 *      (groupSize × plateCap / totalCapacity).
 *   4. No throws on valid inputs (totalSamples ≤ totalCapacity).
 */

import * as fc from 'fast-check';
import { calculateExpectedMinimums } from '../algorithms/balancedRandomization';
import { SearchData, BlockType } from '../utils/types';

// ─── Generator helpers ──────────────────────────────────────────────────────

function makeSample(name: string, covariateKey: string): SearchData {
  return { name, metadata: {}, covariateKey };
}

function makeGroups(spec: Record<string, number>): Map<string, SearchData[]> {
  const groups = new Map<string, SearchData[]>();
  for (const [key, count] of Object.entries(spec)) {
    const samples: SearchData[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(makeSample(`${key}_${i}`, key));
    }
    groups.set(key, samples);
  }
  return groups;
}

/**
 * Partition `total` into `numParts` integer parts, each ≥ 1, using
 * stars-and-bars: choose `numParts - 1` distinct cut points in `[1, total - 1]`
 * and take the gaps. This generates compositions uniformly at random, which
 * naturally produces a mix of balanced and skewed partitions (including
 * "one huge group, many singletons" and similar adversarial shapes) without
 * needing an explicit mode switch.
 */
function partitionIntoParts(total: number, numParts: number, gen: fc.GeneratorValue): number[] {
  if (numParts < 1 || total < numParts) {
    throw new Error(`Cannot partition ${total} into ${numParts} parts ≥ 1`);
  }
  if (numParts === 1) return [total];

  // Pick `numParts - 1` distinct cut points in [1, total - 1].
  const cuts = new Set<number>();
  let attempts = 0;
  const maxAttempts = (numParts - 1) * 20;
  while (cuts.size < numParts - 1 && attempts < maxAttempts) {
    cuts.add(gen(fc.integer, { min: 1, max: total - 1 }));
    attempts++;
  }
  // Fallback if collisions exhaust attempts (rare; only when total - 1 ≈ numParts - 1).
  for (let i = 1; cuts.size < numParts - 1; i++) {
    cuts.add(i);
  }

  const sorted = [...cuts].sort((a, b) => a - b);
  const parts: number[] = [];
  let prev = 0;
  for (const c of sorted) {
    parts.push(c - prev);
    prev = c;
  }
  parts.push(total - prev);
  return parts;
}

// ─── Invariant assertions ───────────────────────────────────────────────────

interface InvariantResult {
  ok: boolean;
  failure?: string;
}

function checkHamiltonInvariants(
  result: { [blockIdx: number]: { [groupKey: string]: number } },
  blockCapacities: number[],
  groupSizes: Record<string, number>,
  expectFilled: boolean,
): InvariantResult {
  const totalCapacity = blockCapacities.reduce((a, b) => a + b, 0);

  // Invariant 1: Per-group sum equals group size
  for (const [key, size] of Object.entries(groupSizes)) {
    let groupTotal = 0;
    for (let p = 0; p < blockCapacities.length; p++) {
      groupTotal += result[p]?.[key] ?? 0;
    }
    if (groupTotal !== size) {
      return {
        ok: false,
        failure: `Group ${key}: sum across plates is ${groupTotal}, expected ${size}`,
      };
    }
  }

  // Invariant 2: Per-plate sum equals plate capacity (only when expectFilled)
  if (expectFilled) {
    for (let p = 0; p < blockCapacities.length; p++) {
      const plateSum = Object.values(result[p] ?? {}).reduce((a, b) => a + b, 0);
      if (plateSum !== blockCapacities[p]) {
        return {
          ok: false,
          failure: `Plate ${p}: sum is ${plateSum}, expected capacity ${blockCapacities[p]}`,
        };
      }
    }
  }

  // Invariant 3: Every cell within ±1 of continuous ideal
  for (let p = 0; p < blockCapacities.length; p++) {
    for (const [key, size] of Object.entries(groupSizes)) {
      const ideal = (size * blockCapacities[p]) / totalCapacity;
      const actual = result[p]?.[key] ?? 0;
      const lo = Math.floor(ideal);
      const hi = Math.ceil(ideal);
      if (actual < lo || actual > hi) {
        return {
          ok: false,
          failure: `Cell P${p}.${key}: alloc=${actual} outside [${lo}, ${hi}] (ideal=${ideal.toFixed(3)})`,
        };
      }
    }
  }

  return { ok: true };
}

// ─── Property tests ─────────────────────────────────────────────────────────

describe('Hamilton Apportionment - Property: exact-capacity invariants', () => {
  it('every Hamilton output on exact-capacity inputs satisfies all four invariants', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),    // numPlates
        fc.integer({ min: 2, max: 10 }),   // numGroups
        fc.gen().map(gen => gen),
        (numPlates, numGroups, gen) => {
          // Generate plate capacities (each 5–100, independent).
          const blockCapacities: number[] = [];
          for (let p = 0; p < numPlates; p++) {
            blockCapacities.push(gen(fc.integer, { min: 5, max: 100 }));
          }
          const totalCapacity = blockCapacities.reduce((a, b) => a + b, 0);

          // Skip inputs where exact-capacity partition into numGroups parts ≥1 is infeasible.
          if (totalCapacity < numGroups) return;

          // Partition totalCapacity into numGroups group sizes such that
          // Σ sizes = totalCapacity (exact-capacity).
          const sizes = partitionIntoParts(totalCapacity, numGroups, gen);
          const groupSizes: Record<string, number> = {};
          for (let g = 0; g < numGroups; g++) {
            groupSizes[`G${g}`] = sizes[g];
          }
          const groups = makeGroups(groupSizes);

          const result = calculateExpectedMinimums(
            blockCapacities,
            groups,
            BlockType.PLATE,
          );

          const check = checkHamiltonInvariants(
            result,
            blockCapacities,
            groupSizes,
            /* expectFilled */ true,
          );
          if (!check.ok) {
            throw new Error(
              `Invariant violation on input:\n` +
              `  blockCapacities=${JSON.stringify(blockCapacities)}\n` +
              `  groupSizes=${JSON.stringify(groupSizes)}\n` +
              `  result=${JSON.stringify(result)}\n` +
              `  failure: ${check.failure}`,
            );
          }
        },
      ),
      // Fixed seed for reproducible failures across runs. Change to explore
      // a different input space (e.g., `seed: Date.now()` for fresh coverage).
      { numRuns: 200, endOnFailure: true, seed: 42 },
    );
  });
});

describe('Hamilton Apportionment - Property: under-capacity invariants', () => {
  it('every Hamilton output on under-capacity inputs satisfies the universal invariants', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 1, max: 20 }),  // slack (empty wells)
        fc.gen().map(gen => gen),
        (numPlates, numGroups, slack, gen) => {
          const blockCapacities: number[] = [];
          for (let p = 0; p < numPlates; p++) {
            blockCapacities.push(gen(fc.integer, { min: 5, max: 100 }));
          }
          const totalCapacity = blockCapacities.reduce((a, b) => a + b, 0);

          const totalSamples = totalCapacity - slack;
          // Skip inputs where partition into numGroups parts ≥1 is infeasible.
          if (totalSamples < numGroups) return;

          const sizes = partitionIntoParts(totalSamples, numGroups, gen);
          const groupSizes: Record<string, number> = {};
          for (let g = 0; g < numGroups; g++) {
            groupSizes[`G${g}`] = sizes[g];
          }
          const groups = makeGroups(groupSizes);

          const result = calculateExpectedMinimums(
            blockCapacities,
            groups,
            BlockType.PLATE,
          );

          const check = checkHamiltonInvariants(
            result,
            blockCapacities,
            groupSizes,
            /* expectFilled */ false,
          );
          if (!check.ok) {
            throw new Error(
              `Invariant violation on input:\n` +
              `  blockCapacities=${JSON.stringify(blockCapacities)}\n` +
              `  groupSizes=${JSON.stringify(groupSizes)}\n` +
              `  totalSamples=${totalSamples} totalCapacity=${totalCapacity}\n` +
              `  result=${JSON.stringify(result)}\n` +
              `  failure: ${check.failure}`,
            );
          }
        },
      ),
      // Fixed seed for reproducible failures across runs. Change to explore
      // a different input space (e.g., `seed: Date.now()` for fresh coverage).
      { numRuns: 200, endOnFailure: true, seed: 42 },
    );
  });
});

describe('Hamilton Apportionment - Property: no throws on valid inputs', () => {
  it('calculateExpectedMinimums never throws when totalSamples ≤ totalCapacity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 2, max: 10 }),
        fc.gen().map(gen => gen),
        (numPlates, numGroups, gen) => {
          const blockCapacities: number[] = [];
          for (let p = 0; p < numPlates; p++) {
            blockCapacities.push(gen(fc.integer, { min: 5, max: 100 }));
          }
          const totalCapacity = blockCapacities.reduce((a, b) => a + b, 0);

          // Skip degenerate inputs where the partition is infeasible.
          if (totalCapacity < numGroups) return;

          const totalSamples = gen(fc.integer, { min: numGroups, max: totalCapacity });
          const sizes = partitionIntoParts(totalSamples, numGroups, gen);
          const groupSizes: Record<string, number> = {};
          for (let g = 0; g < numGroups; g++) {
            groupSizes[`G${g}`] = sizes[g];
          }
          const groups = makeGroups(groupSizes);

          // Should not throw.
          calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
        },
      ),
      // Fixed seed for reproducible failures across runs. Change to explore
      // a different input space (e.g., `seed: Date.now()` for fresh coverage).
      { numRuns: 200, endOnFailure: true, seed: 42 },
    );
  });
});
