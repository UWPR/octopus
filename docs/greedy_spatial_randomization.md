# Greedy Spatial Randomization

## Overview

The greedy spatial randomization algorithm improves upon basic block randomization by minimizing spatial clustering of samples with the same treatment group (covariate combination). This addresses issues where samples of the same group end up adjacent to each other, either horizontally, vertically, or across row boundaries.

## Problem Statement

The original block randomization algorithm:
1. Distributes samples proportionally across plates
2. Distributes samples proportionally across rows
3. Randomly shuffles samples within each row

This approach can lead to undesirable clustering effects:
- **Horizontal clustering**: Two or more samples of the same group adjacent in the same row (e.g., two green cells in columns 06-07)
- **Vertical clustering**: Two or more samples of the same group stacked vertically (e.g., two green cells in column 06)
- **Cross-row clustering**: Last sample of one row and first sample of next row having the same treatment

## Solution: Greedy Spatial Placement

Instead of randomly shuffling samples within rows, we use a greedy algorithm that:
1. Maintains the proportional distribution guarantees
2. Places samples one-by-one in positions that minimize clustering
3. Considers both horizontal and vertical neighbors
4. Prevents cross-row adjacency

### Algorithm Steps

For each row:

1. **Shuffle samples** - Add initial randomness to break ties
2. **For each sample to place:**
   - Score all available positions based on proximity to same-group samples
   - Select positions with the lowest clustering score
   - Randomly choose among equally-good positions
   - Place the sample and mark position as used

### Scoring Function

Each position is scored based on adjacent samples with the same treatment key:

```typescript
score = 0

// Horizontal neighbors (left and right)
if (same treatment adjacent horizontally) {
  score += 10  // Heavy penalty
}

// Vertical neighbor (the cell directly above only; rows fill top-to-bottom,
// so the cell below is always still empty when this one is placed)
if (same treatment in the cell directly above) {
  score += 10  // Heavy penalty
}

// Cross-row constraint (first column vs the previous row's last column)
if (first column && previous row's last column has same treatment) {
  score += 8   // Medium-high penalty
}
```

There is no diagonal penalty. See `calculateClusterScore` in
`src/algorithms/greedySpatialPlacement.ts` for the source of truth.

**Lower scores = better positions**

### Example

Given row B needs: `[Green, Green, Red, Red, Blue, Blue]`

**Step 1**: Place first Green at position 01
```
01    02    03    04    05    06
Green -     -     -     -     -
```

**Step 2**: Place second Green
- Position 02: score = 10 (adjacent to Green) ❌
- Position 03: score = 0 (no Green neighbors) ✓
- Position 04: score = 0 (no Green neighbors) ✓
- Position 05: score = 0 (no Green neighbors) ✓
- Position 06: score = 0 (no Green neighbors) ✓

Choose randomly from positions 03-06, say position 04:
```
01    02    03    04    05    06
Green -     -     Green -     -
```

**Step 3-6**: Continue placing remaining samples, always choosing positions that minimize clustering.

**Final result**:
```
01    02    03    04    05    06
Green Red   Blue  Green Red   Blue
```
✓ No adjacent same-treatment cells!

## Benefits

1. **Maintains proportional distribution** - The algorithm still respects the proportional allocation of samples to plates and rows
2. **Reduces clustering** - Actively minimizes adjacent placement of same-group samples
3. **Preserves randomness** - When multiple positions are equally good, chooses randomly
4. **Fast execution** - O(n × m) complexity where n = samples per row, m = columns
5. **Tunable penalties** - Weights can be adjusted for different clustering types
6. **Cross-row awareness** - Prevents clustering across row boundaries

## Quality Metrics

The algorithm tracks spatial quality metrics:

- **Horizontal clusters**: Count of horizontally adjacent same-treatment pairs
- **Vertical clusters**: Count of vertically adjacent same-treatment pairs
- **Cross-row clusters**: Count of cross-row adjacent same-treatment pairs
- **Total clusters**: Sum of all cluster types

These metrics are logged after randomization completes.

## Implementation Files

- `src/algorithms/greedySpatialPlacement.ts` - Core greedy placement logic
- `src/algorithms/balancedRandomization.ts` - Integration with block randomization

## Configuration

The penalty weights in the scoring function can be adjusted to prioritize different types of clustering:

- Increase horizontal penalty to more strongly avoid side-by-side clustering
- Increase vertical penalty to more strongly avoid stacking
- Increase cross-row penalty to more strongly avoid row-boundary clustering

## Limitations

- The greedy approach finds a good solution but not necessarily the globally optimal solution
- Very small rows (< 4 columns) may have limited placement options
- With many samples of the same group, some clustering may be unavoidable
- The algorithm is deterministic given the same shuffled input order

## Future Enhancements

Potential improvements:
- Multi-pass optimization to refine initial placement
- Simulated annealing for global optimization
- Configurable penalty weights via UI
- Real-time quality scoring display
- Alternative placement strategies (e.g., checkerboard patterns)
