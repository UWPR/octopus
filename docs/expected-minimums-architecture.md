# `calculateExpectedMinimums`: callers and the under-capacity contract

This document explains how `calculateExpectedMinimums` (in
`src/algorithms/balancedRandomization.ts`) is called from the rest of the
codebase, and how the global Hamilton implementation handles both exact-capacity
and under-capacity inputs uniformly.

It is written for developers maintaining the plate-distribution algorithms
and assumes familiarity with the global Hamilton (largest-remainder +
augmenting-path repair) design used by `calculateExpectedMinimums`.

## The three call sites

`calculateExpectedMinimums(blockCapacities, covariateGroups, blockType)`
is called from three places. The important contract for each is what
`Σ blockCapacities` represents relative to `totalSamples` (the sum of group
sizes across `covariateGroups`).

| # | File | Level | How `blockCapacities` is built | `Σ blockCapacities` vs `totalSamples` |
|---|---|---|---|---|
| 1 | `balancedRandomization.ts` | plate | `assignBlockCapacities(totalSamples, plateSize, keepEmptyInLastPlate, maxPlates, PLATE)` | **Equal** |
| 2 | `balancedRandomization.ts` | row (standard flow) | `assignBlockCapacities(plateCapacity, numColumns, keepEmptyInLastPlate, numRows, ROW)` | **Equal** |
| 3 | `repeatedMeasuresDistribution.ts` | row (repeated-measures, `same-plate` constraint) | `effectiveRowCapacitiesPerPlate[plateIdx]` — physical row size minus QC slots | **Σ ≥ totalSamples** (can be strictly greater) |

Sites 1 and 2 always invoke Hamilton with the exact-capacity case
(`totalSamples === totalCapacity`). Site 3 can invoke Hamilton with the
under-capacity case (`totalSamples < totalCapacity`).

## How `assignBlockCapacities` does the pre-shrink

`assignBlockCapacities` is what makes sites 1 and 2 exact-capacity. Despite the
name, the values it returns are **intended sample counts per block**, not
physical well counts.

Example: 35 samples, 2 plates of 20 physical wells each, `keepEmpty = false`:

```js
assignBlockCapacities(35, 20, false, 2, PLATE)
// baseSamplesPerBlock = floor(35/2) = 17
// extraSamples = 35 % 2 = 1
// blockCapacities = [17, 17] + 1 extra to a random plate
// returns [18, 17] (or [17, 18])
// Σ = 35 = totalSamples
```

The 5 empty wells (40 physical wells – 35 samples) are not in
`blockCapacities`. They are implicit — the gap between `blockCapacities[i]` and
the physical well count of plate `i`.

With `keepEmpty = true`:

```js
assignBlockCapacities(35, 20, true, 2, PLATE)
// fullBlocks = floor(35/20) = 1
// remainingSamples = 35 % 20 = 15
// returns [20, 15]
// Σ = 35 = totalSamples
```

In both modes, `Σ blockCapacities === totalSamples`. The function decides how
the empty wells are distributed (concentrated in one plate vs spread evenly),
but the returned caps always sum to the sample count.

Because of this, `calculateExpectedMinimums` at sites 1 and 2 never sees
under-capacity inputs. Every cap it gets is "samples that will land in this
block," and the empty wells are someone else's problem upstream.

## The repeated-measures asymmetry

Site 3 (`repeatedMeasuresDistribution.ts`) does **not** pre-shrink. It
passes `effectiveRowCapacitiesPerPlate[plateIdx]` directly:

```js
effectiveRowCapacitiesPerPlate[p][r] = numColumns - qcPerPlateRow[p][r].length;
```

These are physical row capacities (after subtracting wells consumed by QC
samples). They are **not** scaled down to match the experimental sample count
on that plate.

When the upstream bin-packer (`distributeGroupsToPlates`) assigns fewer
experimental samples to a plate than its effective row capacities sum to —
which happens whenever the chosen plate layout has empty wells, i.e.,
`totalSamples + totalQCs < numPlates × wellsPerPlate` — Hamilton at site 3
sees `totalSamples < Σ rowCapacities`. That is the under-capacity case.

## How the global Hamilton handles under-capacity

The current implementation uses `totalCapacity` (the sum of block capacities)
as the quota denominator in all cases:

```
quota[group][block] = groupSize × blockCapacity / totalCapacity
```

When `totalSamples < totalCapacity`, the sum of a group's quotas across all
blocks still equals `groupSize`, so the floors are conservative and the surplus
to place is `totalSamples - totalFloorSum`. The largest-remainder pass awards a
+1 to a cell with a nonzero fractional remainder while its group still has
surplus and its block still has room. It can stop short: every block a needy group could use may already be full from other
groups' +1s. The repair pass then places the rest through swap chains (worked
example in `hamilton-2d-augmenting-path.svg`). Block deficit left at the end is
the empty wells, which are never filled.

This works because:
- The surplus limit per group (`groupSize - Σ floors`) ensures no group is
  over-allocated.
- The block deficit limit (`blockCapacity - Σ floors on that block`) ensures
  no block is over-filled.
- The repair pass places every surplus sample the greedy pass could not.

The net effect: each group's total equals its size, each block's total is at
most its capacity, and every cell is within one of its continuous quota. In the
under-capacity case the property test in
`src/tests/hamiltonApportionment.properties.test.ts` asserts the first and the
third. Block totals are checked only with exact-capacity inputs, in
`src/tests/hamiltonApportionment.test.ts`. No test asserts how the empty wells
fall across blocks. The continuous quotas spread them in proportion to
capacity, but the integer result does not guarantee it: when many cells tie on
fractional remainder, the shuffled award order can leave one block well short
of its share.

## The caller skips small groups

`placeProportionalSamples` in `distributeToBlocks` reads the Hamilton table
only for a group whose size is at least the block count
(`baseSamplesPerPlate > 0` in `balancedRandomization.ts`). A smaller group is
routed to Phase 2A and its row of the table is ignored for placement, even
though Hamilton placed its samples. `validatePerBlockDistribution` still reads
that row, so when Phase 2A puts a different count on a block than the table
holds, it logs a console error for a mismatch that is by design. So the table decides the placement of large groups only,
and the small-group rule lives in Phase 2A.
