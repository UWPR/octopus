# `calculateExpectedMinimums`: callers and the pre-shrink contract

This document explains how `calculateExpectedMinimums` (in
`src/algorithms/balancedRandomization.ts`) is called from the rest of the
codebase, why one caller reaches an under-capacity branch the others don't, and
what a future cleanup refactor would look like.

It is written for developers maintaining the plate-distribution algorithms. It
assumes familiarity with the constrained Hamilton apportionment design in
`.kiro/specs/hamilton-plate-apportionment/bugfix.md`.

## The three call sites

`calculateExpectedMinimums(blockCapacities, covariateGroups, blockType)`
is called from three places. The important contract for each is what
`Σ blockCapacities` represents relative to `totalSamples` (the sum of group
sizes across `covariateGroups`).

| # | File / line | Level | How `blockCapacities` is built | `Σ blockCapacities` vs `totalSamples` |
|---|---|---|---|---|
| 1 | `balancedRandomization.ts:685` | plate | `assignBlockCapacities(totalSamples, plateSize, keepEmptyInLastPlate, maxPlates, PLATE)` | **Equal** |
| 2 | `balancedRandomization.ts:722` | row (standard flow) | `assignBlockCapacities(plateCapacity, numColumns, keepEmptyInLastPlate, numRows, ROW)` | **Equal** |
| 3 | `repeatedMeasuresDistribution.ts:1364` | row (repeated-measures, `same-plate` constraint) | `effectiveRowCapacitiesPerPlate[plateIdx]` — physical row size minus QC slots | **Σ ≥ totalSamples** (can be strictly greater) |

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

Site 3 (`repeatedMeasuresDistribution.ts:1364`) does **not** pre-shrink. It
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

**Why is site 3 written this way?** Historical. The repeated-measures row pass
predates the Hamilton refactor. Before Hamilton, `calculateExpectedMinimums`
intentionally under-allocated, and Phase 2B's round-robin overflow placed the
remainder. Passing the full effective row capacities gave the overflow loop
room to maneuver. After the Hamilton refactor, the under-allocation problem
moved into `calculateExpectedMinimums` itself, but the caller wasn't updated.

## The under-capacity branch in Hamilton

Hamilton's deficit-distribution loop has this branch at the top of the
"no eligible group" path:

```js
if (eligible.length === 0) {
  // Under-capacity (totalSamples < totalCapacity): any remaining deficit
  // becomes empty wells. We must NOT round-reset here — doing so would let
  // a group exceed ceil(quota) on this block.
  if (totalSamples < totalCapacity) {
    break;
  }
  // Exact-capacity case: round-reset to distribute remaining surplus...
}
```

This branch (a) prevents Hamilton from over-allocating a group on a single
block when the algorithm has slack to spare and (b) leaves the residual deficit
as empty wells.

### The Gap D bug it protects against

Without the `break`, the round-reset path could allocate `floor(quota) + 2` to
a group on a single block — violating Hamilton's ±1 bound (every cell must be
`floor(quota)` or `ceil(quota)`). The Hamilton spec's worked example: 4 blocks
of cap=10 with one group of size 35, per-block quota 8.75, `ceil = 9`. Without
the break, the round-reset could place G=10 on the first block instead of
distributing 9, 9, 9, 8 across the four.

The regression test for this (Gap D in `src/tests/hamiltonApportionment.test.ts`)
uses synthetic inputs. The **production scenario** that reaches this branch is
exactly one: repeated-measures + `same-plate` grouping constraint + a plate
layout with empty wells.

### Why repeated-measures + same-plate is the only production trigger

- Sites 1 and 2 always invoke Hamilton with exact-capacity inputs (see above).
- Repeated-measures + `same-row` constraint does not call
  `calculateExpectedMinimums` at all — it uses `distributeGroupsToRows`
  (bin-packing) instead.
- Repeated-measures + `same-plate` constraint hits site 3, and any plate
  carrying fewer experimental samples than its effective row caps sum to
  triggers the under-capacity case.

The under-filled plate is typically (but not always) the last plate. Empty
wells redistribute across that plate's rows according to Hamilton's
smallest-row-first processing order.

## Proposed cleanup refactor

The asymmetry could be removed by pre-shrinking the row capacities at site 3
before calling `calculateExpectedMinimums`, mirroring what `assignBlockCapacities`
does for site 2.

### Sketch

In `repeatedMeasuresDistribution.ts` around line 1361, replace:

```js
const rowCapacities = effectiveRowCapacitiesPerPlate[plateIdx];
```

with something like:

```js
const samplesOnThisPlate = experimentalPlateSamples.length;
const physicalRowCaps = effectiveRowCapacitiesPerPlate[plateIdx];
const rowCapacities = shrinkToTotal(physicalRowCaps, samplesOnThisPlate);
```

where `shrinkToTotal(caps, target)` returns a new array of caps such that
`Σ result === target` and each `result[i] ≤ caps[i]`. The distribution of the
empty wells is a design choice — possibilities include:

- Reduce the smallest rows first (concentrates empty wells away from full rows).
- Random reduction (spreads empty wells uniformly).
- Reduce rows by QC-row proximity (keeps empty wells near QC clusters).

### What becomes dead code

- The `if (totalSamples < totalCapacity) break;` branch in Hamilton.
- The Gap D regression test in `hamiltonApportionment.test.ts` (would need to
  move to a test for `shrinkToTotal` instead).

### Trade-offs

| Aspect | Current design | Proposed refactor |
|---|---|---|
| Where empty-well placement is decided | Hamilton (last-processed row in smallest-first order) | Caller (explicit `shrinkToTotal` choice) |
| Hamilton output (covariate balance per row) | Same | Same |
| Code complexity | Under-capacity branch in Hamilton | `shrinkToTotal` helper + caller change |
| Symmetry with standard flow | Asymmetric (site 3 special) | Symmetric (all sites pre-shrunk) |
| Testability | Gap D test needed | `shrinkToTotal` test sufficient |
| Predictability of empty-well placement | Implicit | Explicit, configurable |

The Hamilton output is identical between the two approaches — only the
*physical placement* of empty wells differs. With the current design, empty
wells cluster on the last-processed-smallest row; with the refactor, the
caller chooses.

### Why we are deferring

- The current design works correctly (Gap D fix + test).
- The refactor is a non-trivial change to a flow that has been stable for a
  long time.
- A clean `shrinkToTotal` requires a design decision about empty-well
  placement that has UX implications (where do the empty wells "look like" on
  the plate?) — this deserves user input rather than being a developer choice.

### Pointers for whoever picks this up

- `src/algorithms/repeatedMeasuresDistribution.ts:1361` — call site to update.
- `src/algorithms/balancedRandomization.ts:216–223` — branch to remove from
  Hamilton.
- `src/tests/hamiltonApportionment.test.ts` "Gap D" describe block — tests to
  retarget at `shrinkToTotal`.
- `src/algorithms/balancedRandomization.ts:262–317` (`assignBlockCapacities`)
  — reference implementation for the pre-shrink pattern. Note that
  `assignBlockCapacities` assumes uniform physical block size; `shrinkToTotal`
  needs to handle non-uniform input caps (because QC rows can have different
  effective capacities within one plate).
