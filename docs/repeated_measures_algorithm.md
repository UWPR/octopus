# Repeated Measures Distribution Algorithm

This document describes the algorithms in `src/algorithms/repeatedMeasuresDistribution.ts`, which handle the distribution of repeated-measures samples (multiple timepoints per patient) across plates and rows while keeping all samples from the same patient together.

## Overview

The system works in a pipeline of stages:

```
Input CSV
  → buildSubjectGroups()        Group samples by patient ID
  → distributeQcByCovariate()   Spread QC samples evenly across plates/rows
  → distributeGroupsToPlates()  Assign patient groups to plates (FFD + covariate balance)
  → distributeGroupsToRows()    Assign patient groups to rows within each plate
      Phase 1: Recipe search (composition backtracking)
      Phase 2: Group assignment (covariate-balanced)
      Fallback: Greedy FFD
  → greedyPlaceInRow()          Place samples into specific columns within each row
```

---

## Stage 1: buildSubjectGroups

Groups samples by the subject/patient ID column. All samples sharing the same patient ID become a single `SubjectGroup` that must be kept together throughout the pipeline.

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

Result: 20 subject groups (8 of size 2, 12 of size 3) + 12 QC singletons.

---

## Stage 2: distributeQcByCovariate

Distributes QC samples proportionally across plates and rows, respecting QC covariate subgroups (e.g., BatchQC vs BatchRef).

For each QC covariate group:
1. Divide count evenly across plates: each plate gets `floor(count / numPlates)`, remainder distributed randomly (one extra per plate).
2. Within each plate, divide evenly across rows: each row gets `floor(plateAlloc / numRows)`, remainder distributed randomly.

### Example

12 QC samples (6 BatchQC + 6 BatchRef), 1 plate, 6 rows:

- BatchQC: 6 samples ÷ 6 rows = 1 per row
- BatchRef: 6 samples ÷ 6 rows = 1 per row
- Each row gets 2 QC samples → effective row capacity = 12 - 2 = 10

---

## Stage 3: distributeGroupsToPlates

Assigns patient groups to plates using First-Fit-Decreasing (FFD) bin packing with covariate balance as a tiebreaker.

### Algorithm

1. Sort groups by size descending, shuffling groups of equal size for randomness.
2. For each group, find all plates with enough remaining capacity.
3. Among candidates with the most remaining capacity (ties), pick the plate where adding this group produces the lowest covariate imbalance score.
4. After all multi-sample groups are placed, distribute singletons the same way.

### Row-Slot Limits (Same-Row Constraint)

When using the "Same Row" constraint, each plate has a limit on how many multi-sample groups it can accept, based on how many groups physically fit in its rows. This prevents overloading a plate with groups that can't be arranged into rows later.

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

Both passes collect valid recipes into a pool (up to `MAX_RECIPES = 50` total). The search also has an iteration budget of 500,000 to prevent excessive computation.

#### Recipe Scoring: Size Diversity Score

Each recipe is scored by how many distinct group sizes appear in each row, summed across all rows.

```
sizeDiversityScore = Σ (for each row) |{ size : recipe[row].get(size) > 0 }|
```

| Row contents | Distinct sizes | Score contribution |
|---|---|---|
| 3+3+2+2 = 10 | 2 (sizes 3 and 2) | 2 |
| 3+3+3+0 = 9  | 1 (size 3 only)   | 1 |
| 2+2+2+2+2 = 10 | 1 (size 2 only) | 1 |
| 3+2+2+2 = 9  | 2 (sizes 3 and 2) | 2 |

Higher score = more mixed-size rows = better chance of covariate diversity after Phase 2.

The recipe with the highest score is selected.

#### Example: FLARE Dataset Recipes

Groups: 12 size-3, 8 size-2. Row capacities: [10, 10, 10, 10, 10, 10].

A possible recipe (mixed):
```
Row 0: 2×3 + 2×2 = 10  (distinct sizes: 2)
Row 1: 2×3 + 2×2 = 10  (distinct sizes: 2)
Row 2: 2×3 + 2×2 = 10  (distinct sizes: 2)
Row 3: 2×3 + 2×2 = 10  (distinct sizes: 2)
Row 4: 2×3 + 0×2 = 6   (distinct sizes: 1)
Row 5: 2×3 + 0×2 = 6   (distinct sizes: 1)
Total score: 2+2+2+2+1+1 = 10
```

A greedy-fill recipe:
```
Row 0: 3×3 + 0×2 = 9   (distinct sizes: 1)
Row 1: 3×3 + 0×2 = 9   (distinct sizes: 1)
Row 2: 3×3 + 0×2 = 9   (distinct sizes: 1)
Row 3: 3×3 + 0×2 = 9   (distinct sizes: 1)
Row 4: 0×3 + 4×2 = 8   (distinct sizes: 1)
Row 5: 0×3 + 4×2 = 8   (distinct sizes: 1)
Total score: 1+1+1+1+1+1 = 6
```

The mixed recipe wins (score 10 vs 6).

#### Important: Phase 1 Is Deterministic

The backtracking search has no randomization. Given the same group sizes and row capacities, it always explores the same tree in the same order and produces the same set of candidate recipes. This means re-randomization does not change the recipe.

---

### Phase 2: Covariate-Balanced Group Assignment

Once the best recipe is selected, Phase 2 assigns specific patient groups to the recipe's slots.

#### Algorithm

1. Pool all groups by size and shuffle each pool (this is the only randomization point).
2. Flatten the recipe into a list of `(rowIdx, size)` slots.
   - If row 0's recipe is `{3: 2, 2: 2}`, that produces: `(0,3), (0,3), (0,2), (0,2)`.
3. Sort all slots by size descending — largest groups are placed first.
4. For each slot, evaluate every unassigned group of that size against the row's current contents using `covariateImbalanceScore`. Pick the group that minimizes the score.

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

Placing the first size-3 group into empty row 0:
- Candidate: CP13 (Responder|3, 3 samples) → proportions: {Responder|3: 1.0} → deviation from global is large
- Candidate: CP09 (Non-Responder|3, 3 samples) → proportions: {Non-Responder|3: 1.0} → deviation from global is also large
- Both score similarly for an empty row, so the first one in the shuffled pool wins.

As rows fill up, the scores diverge and the balancer steers groups toward rows that need them.

#### Why Responder|2 Groups Cluster

With only 2 patients (CP01, CP02) sharing the `Responder|2` covariate key:
1. The recipe is deterministic (same every time).
2. Both groups have identical covariate keys, so they produce identical imbalance scores for any given row state.
3. The balancer places the first one in the row that needs `Responder|2` most.
4. The second one then also scores best for the same row (or a row with very similar composition), because the covariate pressure hasn't changed much — `Responder|2` is only 7.7% of the global proportion, so one group barely moves the needle.

---

### Fallback: Greedy FFD

If the composition solver finds zero valid recipes (iteration budget exhausted), the algorithm falls back to greedy First-Fit-Decreasing:

1. Sort groups by size descending (shuffled within equal sizes).
2. For each group, find all rows with enough capacity.
3. Score each candidate row using `covariateImbalanceScore`.
4. Pick the row with the best (lowest) score. Ties broken by most remaining capacity, then random.

This is simpler but tends to cluster same-size groups together (e.g., all size-5 groups in the same row).

---

### Singleton Distribution

After all multi-sample groups are placed (by either the composition solver or greedy FFD), singletons are distributed to fill remaining row capacity:

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

## Summary of Randomization Points

| Stage | Randomized? | What's random |
|---|---|---|
| QC distribution | Yes | Remainder allocation across plates/rows |
| Groups to plates | Yes | Shuffle within equal-size groups; random tiebreaking |
| Recipe search (Phase 1) | **No** | Deterministic backtracking, same tree every time |
| Recipe selection | **No** | Always picks highest sizeDiversityScore |
| Group assignment (Phase 2) | Partially | Group pools are shuffled, but covariateImbalanceScore overrides shuffle order for same-key groups |
| Singleton distribution | Yes | Shuffled order, random tiebreaking |
| Row reordering | Yes | Random start row, random tiebreaking |
| Column placement | Yes | Randomized within spatial optimization |
