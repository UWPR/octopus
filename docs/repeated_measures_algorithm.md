# Repeated Measures Distribution Algorithm

This document describes the algorithms in `src/algorithms/repeatedMeasuresDistribution.ts`, which handle the distribution of repeated-measures samples (multiple timepoints per patient) across plates and rows while keeping all samples from the same patient together.

## Overview

The system works in a pipeline of stages. The pipeline differs depending on the grouping constraint:

**Same Row Constraint** (all samples from a subject must be in the same row):
```
Input CSV
  → distributeQcByCovariate()   Spread QC samples evenly across plates/rows
  → buildSubjectGroups()        Group the remaining samples by patient ID
  → distributeGroupsToPlates()  Assign patient groups to plates (largest-first + covariate balance)
  → distributeGroupsToRows()    Assign patient groups to rows within each plate
      Phase 1: Recipe search (composition backtracking)
      Phase 2: Group assignment (covariate-balanced)
      Fallback: Greedy largest-first
  → Row reordering              Reorder rows to minimize vertical adjacency
  → greedyPlaceInRow()          Place samples into specific columns within each row
```

**Same Plate Constraint** (all samples from a subject must be on the same plate):
```
Input CSV
  → distributeQcByCovariate()   Spread QC samples evenly across plates/rows
  → buildSubjectGroups()        Group the remaining samples by patient ID
  → distributeGroupsToPlates()  Assign patient groups to plates (largest-first + covariate balance)
  → distributeToBlocks()        Standard balanced block row assignment (samples placed independently)
  → greedyPlaceInRow()          Place samples into specific columns within each row
```

The stages below describe the Same Row pipeline in detail. See "Same Plate Constraint" at the end for the differences.

---

## Stage 1: distributeQcByCovariate

Distributes QC samples proportionally across plates and rows, respecting QC covariate subgroups (e.g., BatchQC vs BatchRef).

For each QC covariate group:
1. Divide count evenly across plates: each plate gets `floor(count / numPlates)`. The remainder goes one per plate to the plates holding the fewest QC samples so far, counting every QC group, with ties broken at random.
2. Within each plate, divide evenly across rows: each row gets `floor(plateAlloc / numRows)`. The remainder goes one per row to the rows of that plate holding the fewest QC samples so far, ties at random.

Each QC group is spread evenly, and so is the QC total. Plate totals differ by at most one, as do the row totals within a plate. The feasibility check behind the Generate button (`validateSubjectGroups`) assumes exactly this split.

### Example

12 QC samples (6 BatchQC + 6 BatchRef), 1 plate, 6 rows:

- BatchQC: 6 samples ÷ 6 rows = 1 per row
- BatchRef: 6 samples ÷ 6 rows = 1 per row
- Each row gets 2 QC samples → effective row capacity = 12 - 2 = 10

---

## Stage 2: buildSubjectGroups

Groups the experimental samples by the subject/patient ID column. All samples sharing the same patient ID become a single `SubjectGroup` that must be kept together throughout the pipeline. QC samples were set aside in Stage 1 and never become groups.

Samples with empty or missing patient IDs become singletons (group of size 1).

### Example: FLARE Cancer Pilot

With `PatientID` as the subject column:

| Patient | Timepoints | Group Size | Outcome |
|---------|-----------|------------|---------|
| CP01    | T1, T2    | 2          | Responder |
| CP02    | T1, T2    | 2          | Responder |
| CP03    | T1, T2    | 2          | Non-Responder |
| CP09    | T1, T2, T3 | 3         | Non-Responder |
| CP13    | T1, T2, T3 | 3         | Responder |
| ...     | ...       | ...        | ... |

Result: 20 subject groups (8 of size 2, 12 of size 3). The 12 QC samples are not among them.

---

## Stage 3: distributeGroupsToPlates

Assigns patient groups to plates largest-first with covariate balance as a tiebreaker.

### Algorithm

1. Sort groups by size descending, shuffling groups of equal size for randomness.
2. For each group, find all plates with enough remaining capacity.
3. Among candidates with the most remaining capacity (ties), pick the plate where adding this group produces the lowest covariate imbalance score.
4. After all multi-sample groups are placed, distribute singletons the same way.

### Row-Slot Limits (Same-Row Constraint)

When using the "Same Row" constraint, each plate has a limit on how many multi-sample groups it can accept: the sum over its rows of `floor(rowCapacity / smallestGroupSize)`. This is an upper bound on the group count, not a row-fit check, so a plate can still receive a set of groups that no row split can hold. See Packing Failures.

### Example

20 groups (52 experimental samples) + 12 QC = 64 samples on a 6×12 plate (72 wells). Everything fits on one plate, so this stage is trivial for the FLARE dataset.

---

## Stage 4: distributeGroupsToRows

This is the most complex stage. It assigns patient groups to specific rows within a plate, ensuring all samples from the same patient land in the same row.

### Input

- `groups`: All subject groups assigned to this plate (multi-sample + singletons)
- `rowCapacities`: Available wells per row after QC allocation (e.g., `[10, 10, 10, 10, 10, 10]`)
- `globalProportions`: Expected proportion of each covariate key across all experimental samples

### Early Feasibility Checks

Before attempting any placement, three checks run:

1. **Oversized group**: Any group larger than the biggest row? → Error
2. **Total overflow**: Total samples exceed total row capacity? → Error
3. **Per-size infeasibility**: For each group size, are there enough "slots" across all rows? A row with capacity 10 can hold `floor(10/3) = 3` groups of size 3. If there are more groups of that size than total slots, → Error

### Phase 1: Recipe Search (Composition Backtracking)

Instead of deciding which specific patient goes where (huge search space), Phase 1 decides how many groups of each size go in each row. This is called a "recipe."

A recipe is an array of maps, one per row: `rowRecipes[r] = Map<groupSize, count>`.

#### How It Works

The backtracking function `findRecipe` fills rows one at a time (row 0, then row 1, etc.). For each row, it tries every valid combination of group-size counts that fit within the row's capacity.

For a row with capacity 10 and group sizes [3, 2]:
- Try 0 size-3 groups → 10 capacity left for size-2 → try 5, 4, 3, 2, 1, 0 size-2 groups
- Try 1 size-3 group → 7 capacity left → try 3, 2, 1, 0 size-2 groups
- Try 2 size-3 groups → 4 capacity left → try 2, 1, 0 size-2 groups
- Try 3 size-3 groups → 1 capacity left → try 0 size-2 groups

At each step, two feasibility pruning checks eliminate dead branches early:
- **Total capacity prune**: Can the remaining unplaced groups fit in the remaining rows' total capacity?
- **Per-size prune**: For each remaining group size, are there enough slots in the remaining rows?

#### Two-Pass Search

The search runs twice with different enumeration orders:

**Pass 1 (reversed)**: For the largest group size, counts go 0→max. This explores mixed-size compositions first (e.g., 0 size-3 + 5 size-2 before 3 size-3 + 0 size-2). Produces recipes with higher size diversity.

**Pass 2 (default)**: For the largest group size, counts go max→0. This explores greedy-fill compositions first (e.g., 3 size-3 + 0 size-2 before 0 size-3 + 5 size-2).

Each pass collects up to 50 recipes, so the pool holds up to 100. Recipes that are row permutations of each other count once, through a canonical key. The two passes share an iteration budget of 500,000, and the second pass is skipped when the first spends it.

#### Recipe Scoring: Covariate Balance

Each recipe is scored by estimating how well-balanced the covariate proportions would be across rows, given the available group pool.

For each row in the recipe:
1. For each size slot, estimate the expected covariate composition by distributing the available groups of that size proportionally by covariate key.
2. Compute the sum of squared deviations between the row's expected covariate proportions and the global proportions.

The total score is the sum across all rows. **Lower score = better balance.** The recipe with the lowest score is selected.

The estimate reads one covariate key per group, the first sample's. A group whose samples differ in a covariate value is scored as if every sample had the first one's value.

This approach directly optimizes for covariate balance rather than using a proxy metric like size diversity.

#### Example: FLARE Dataset Recipes

Groups: 12 size-3, 8 size-2. Row capacities: [10, 10, 10, 10, 10, 10].

A mixed recipe:
```
Row 0: 2×3 + 2×2 = 10
Row 1: 2×3 + 2×2 = 10
Row 2: 2×3 + 2×2 = 10
Row 3: 2×3 + 2×2 = 10
Row 4: 2×3 + 0×2 = 6
Row 5: 2×3 + 0×2 = 6
```

A greedy-fill recipe:
```
Row 0: 3×3 + 0×2 = 9
Row 1: 3×3 + 0×2 = 9
Row 2: 3×3 + 0×2 = 9
Row 3: 3×3 + 0×2 = 9
Row 4: 0×3 + 4×2 = 8
Row 5: 0×3 + 4×2 = 8
```

The mixed recipe wins because it distributes both group sizes across all rows, producing more balanced expected covariate proportions per row. The greedy-fill recipe concentrates all size-2 groups in two rows, creating covariate imbalance.

#### Important: Phase 1 Recipe Search Is Deterministic, Selection Is Not

The backtracking search has no randomization — given the same group sizes and row capacities, it always explores the same tree in the same order and produces the same set of candidate recipes. However, recipe *selection* introduces randomness: when multiple recipes tie for the best covariate imbalance score, one is chosen at random. This means re-randomization can produce a different recipe if ties exist, which leads to different row assignments in Phase 2.

---

### Phase 2: Covariate-Balanced Group Assignment

Once the best recipe is selected, Phase 2 assigns specific patient groups to the recipe's slots.

#### Algorithm

1. Pool all groups by size and shuffle each pool.
2. Flatten the recipe into a list of `(rowIdx, size)` slots.
   - If row 0's recipe is `{3: 2, 2: 2}`, that produces: `(0,3), (0,3), (0,2), (0,2)`.
3. Order the slots by size descending, largest groups first. Within one size, visit the rows round-robin in a shuffled row order: every row gets one slot of that size before any row gets a second. Without this, a covariate that dominates one group size would fill the first rows.
4. For each slot, evaluate every unassigned group of that size against the row's current contents using `covariateImbalanceScore`. Pick the group with the lowest score. Groups with the same covariate key tie, and the first in shuffled pool order wins.

#### covariateImbalanceScore

This function measures how far a row's covariate proportions would deviate from the global proportions if a candidate group were added.

```
score = Σ (for each covariate key) (actualProportion - expectedProportion)²
```

Where:
- `actualProportion` = count of this key in (current row samples + candidate) / total
- `expectedProportion` = count of this key across all experimental samples / total experimental

Lower score = better balance. The function returns 0 when there's only one covariate group (nothing to balance).

#### Example: Placing Size-3 Groups

Global proportions for FLARE with Outcome+Timepoints covariates:
- Responder|3: 24/52 ≈ 0.462
- Non-Responder|3: 12/52 ≈ 0.231
- Responder|2: 4/52 ≈ 0.077
- Non-Responder|2: 12/52 ≈ 0.231

Placing the first size-3 group into empty row 0, the row holds only the candidate:
- Candidate: CP13 (Responder|3) → proportions {Responder|3: 1.0} → score (1 - 0.462)² + 0.231² + 0.077² + 0.231² = 0.40
- Candidate: CP09 (Non-Responder|3) → proportions {Non-Responder|3: 1.0} → score 0.462² + (1 - 0.231)² + 0.077² + 0.231² = 0.86
- The majority key wins on an empty row, so the first Responder|3 group in the shuffled pool is placed.

As rows fill up, the scores diverge and the balancer steers groups toward rows that need them.

---

### Fallback: Greedy Largest-First

If the search returns no recipe, because none exists or the iteration budget ran out first, the algorithm falls back to greedy largest-first placement:

1. Sort groups by size descending (shuffled within equal sizes).
2. For each group, find all rows with enough capacity.
3. Score each candidate row using `covariateImbalanceScore`.
4. Pick the row with the best (lowest) score. Ties broken by most remaining capacity, then random.

When no recipe exists, the greedy pass cannot fit the groups either, since any placement it finds is a recipe, and it throws a `PackingError`. The fallback matters only when the budget ran out before the search reached a recipe that exists.

---

### Singleton Distribution

After all multi-sample groups are placed (by either the composition solver or greedy fallback), singletons are distributed to fill remaining row capacity:

1. Shuffle all singletons.
2. For each singleton, find rows with the most remaining capacity.
3. Among tied rows, pick the one where adding this singleton best balances covariates.

---

## Stage 5: Row Reordering

After groups are assigned to logical rows, the algorithm reorders the physical row sequence to minimize vertical adjacency of same-covariate groups.

1. Build a covariate signature for each row (count of each covariate key).
2. Start with a random row.
3. Greedily pick the next row that is most different from the previous one (measured by sum of absolute differences in covariate counts).

This is a cosmetic optimization — it doesn't change which groups are in which row, just the physical order on the plate.

---

## Stage 6: Column Placement (greedyPlaceInRow)

Within each row, `greedyPlaceInRow` (from `greedySpatialPlacement.ts`) places samples into specific columns to maximize spatial separation of same-covariate samples. This is the final step before rendering.

---

## Same Plate Constraint

When the grouping constraint is "Same Plate" instead of "Same Row", the pipeline changes at Stage 4:

- **Stages 1-3** are identical (QC distribution, subject grouping, plate assignment).
- **Stage 4 (Row Assignment)**: Instead of the composition backtracking + group assignment pipeline, the algorithm flattens all experimental samples on the plate and uses the standard balanced block randomization logic (`distributeToBlocks`, with per-row expected minimums from `calculateExpectedMinimums`, see `expected-minimums-architecture.md`) to assign samples to rows. Since groups only need to be on the same plate (not the same row), individual samples can be placed independently, giving more flexibility for covariate balance.
- **Stage 5 (Row Reordering)**: Not performed. The balanced block logic assigns samples to rows in their natural order.
- **Stage 6**: Same as Same Row — `greedyPlaceInRow` handles column placement.

---

## Packing Failures

When the pipeline cannot fit the subject groups into the plates or rows, it throws a `PackingError`, and Generate, Re-randomize and single-plate re-randomize display its message.

Some multi-plate Same Row requests that have a layout fail on every run. Plate assignment (Stage 3) does not consider row shapes, and for some inputs it makes the same choice every run. For example, two 2×5 plates with subjects of 5, 3, 2, 1, 4, 4 and 1 samples, with treatments alternating Placebo, Drug, Placebo and so on per subject, always put the groups of 4, 4 and 2 on one plate, which no row split can hold.

---

## Summary of Randomization Points

| Stage | Randomized? | What's random |
|---|---|---|
| QC distribution | Partially | Which of the least-filled plates and rows get the remainder |
| Groups to plates | Yes | Shuffle within equal-size groups; random tiebreaking |
| Recipe search (Phase 1) | **No** | Deterministic backtracking, same tree every time |
| Recipe selection | Partially | Picks lowest covariate imbalance score; random tiebreaking among equal scores |
| Group assignment (Phase 2) | Partially | Group pools are shuffled, and the rows within each size are visited in shuffled order. covariateImbalanceScore orders groups with different keys; same-key groups tie and keep shuffle order |
| Singleton distribution | Yes | Shuffled order, random tiebreaking |
| Row reordering | Yes | Random start row, random tiebreaking |
| Column placement | Yes | Randomized within spatial optimization |
