# Edge Case Test Files

These test files demonstrate scenarios where the repeated measures algorithm's pre-checks pass but placement fails due to group-size interactions with the plate/row geometry.

## edge-case-row-infeasible.csv

**Scenario:** Row-level packing failure on a single plate.

- 2 groups of size 5 (P001, P002 — 5 timepoints each)
- 6 groups of size 3 (P003–P008 — 3 timepoints each)
- 28 samples total

**Configuration:** 1 plate, 4 rows x 7 columns (28 wells), Same Row constraint, no QC samples.

**What happens:** All pre-checks pass (28 samples fit in 28 wells, per-size slot counts look sufficient). But size-5 and size-3 groups can't share a 7-wide row (5 + 3 = 8 > 7), so each size-5 group wastes 2 wells. The two size-5 groups consume 2 rows, leaving only 14 wells in 2 rows for 18 samples worth of size-3 groups.

## edge-case-plate-infeasible.csv

**Scenario:** Plate-level capacity exhaustion with mixed group sizes.

- 3 groups of size 9 (P001, P002, P003 — 9 timepoints each)
- 5 groups of size 4 (P004–P008 — 4 timepoints each)
- 47 samples total

**Configuration:** 2 plates, 2 rows x 12 columns (24 wells each, 48 total), Same Row constraint, no QC samples. Rows must be at least 9 columns wide so size-9 groups fit in a single row.

**FFD placement trace:**

```
G1 (9) → P0. Capacities: [15, 24]
G2 (9) → P1. Capacities: [15, 15]
G3 (9) → P0 (tie). Capacities: [6, 15]
G4 (4) → P1. Capacities: [6, 11]
G5 (4) → P1. Capacities: [6, 7]
G6 (4) → P1. Capacities: [6, 3]
G7 (4) → P0. Capacities: [2, 3]
G8 (4) → no plate qualifies (2 < 4, 3 < 4)
```

**Error message produced:**

> Unable to fit all subject groups into available plates. Remaining plate capacities: [2, 3]. 1 group(s) of size 4 need plates with 4+ wells, but only 0 plate(s) qualify (0 slot(s)). Try increasing the plate dimensions or switching to Same Plate constraint.

There are 5 wells left across plates, but neither plate has 4+ wells for the last group. The shape mismatch is clear from the message.

Note that because FFD processes groups in descending size order, the unplaced set will typically contain only the smallest size class (the one being placed when it fails), plus any even-smaller groups queued behind it. You won't normally see large groups in the unplaced list since those are placed first.
