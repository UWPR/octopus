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

When `totalSamples < totalCapacity`, the sum of all quotas across all blocks
for a group equals `groupSize` (not `totalCapacity`). The floors are
conservative, and the global largest-remainder pass awards +1s until all
`totalSamples - totalFloorSum` surplus samples are placed. The remaining
block deficit (empty wells) is simply never filled — blocks whose deficit
isn't consumed by the remainder pass end up with fewer samples than their
physical capacity.

This works correctly because:
- The surplus limit per group (`groupSize - Σ floors`) ensures no group is
  over-allocated.
- The block deficit limit (`blockCapacity - Σ floors on that block`) ensures
  no block is over-filled.
- The augmenting-path repair guarantees all surplus samples are placed even
  when the greedy pass gets stuck.

The net effect: under-capacity inputs produce allocations where each group's
total equals its size (all samples placed), each block's total is ≤ its
capacity, and every cell is within ±1 of its continuous ideal quota. Empty
wells are distributed across blocks proportionally to their capacity.

## Historical note

Prior to the global Hamilton refactor, `calculateExpectedMinimums` processed
blocks sequentially (smallest-capacity-first) and had a special `break` branch
for the under-capacity case that could leave samples unplaced. The caller
(`distributeToBlocks`) compensated via Phase 2B overflow distribution. The
global Hamilton implementation eliminated both the per-block processing order
and the under-capacity branch, making the function self-contained: it always
places all samples regardless of whether `totalSamples` equals or is less than
`totalCapacity`.

The "pre-shrink refactor" previously proposed in this document (shrinking row
capacities at site 3 before calling Hamilton) is no longer needed — the global
algorithm handles both cases uniformly.
