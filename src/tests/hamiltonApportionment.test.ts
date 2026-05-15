/**
 * Tests for Hamilton (largest-remainder) plate apportionment in
 * `calculateExpectedMinimums`. Covers five worked examples plus five gap
 * cases (Gap A-E: surplus-limit eligibility, swap-repair stuck state,
 * row-level usage, under-capacity over-allocation, integer-quota cells
 * under capacity) that exercise mechanisms not directly covered by the
 * examples.
 */

import { calculateExpectedMinimums } from '../algorithms/balancedRandomization';
import { SearchData, BlockType } from '../utils/types';

// --- Test Helpers ------------------------------------------------------------

/** Create a minimal SearchData sample with a given covariate key */
function makeSample(name: string, covariateKey: string): SearchData {
  return { name, metadata: {}, covariateKey };
}

/** Create a Map of covariate groups from a size specification */
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
 * Invariant assertions for Hamilton output.
 *
 * Universal invariants (always checked):
 *   - Per-group sum equals group size (all samples placed)
 *   - Every cell within +/-1 of the continuous ideal
 *
 * Plate-fill invariant (checked only when `expectFilled` is true, the default):
 *   - Per-plate sum equals plate capacity
 *
 * Pass `expectFilled: false` for under-capacity inputs (totalSamples < totalCapacity)
 * where empty wells are legitimate and per-plate sums will be below capacity.
 */
function assertHamiltonInvariants(
  result: { [plateIdx: number]: { [groupKey: string]: number } },
  plateCapacities: number[],
  groupSizes: Record<string, number>,
  options: { expectFilled?: boolean } = {}
) {
  const { expectFilled = true } = options;
  const totalCapacity = plateCapacities.reduce((a, b) => a + b, 0);
  const totalSamples = Object.values(groupSizes).reduce((a, b) => a + b, 0);

  // Invariant 1: Per-plate sum equals plate capacity (only when fully filled)
  if (expectFilled) {
    for (let p = 0; p < plateCapacities.length; p++) {
      const plateSum = Object.values(result[p]).reduce((a, b) => a + b, 0);
      expect(plateSum).toBe(plateCapacities[p]);
    }
  }

  // Invariant 2: Per-group sum equals group size
  for (const [key, size] of Object.entries(groupSizes)) {
    let groupTotal = 0;
    for (let p = 0; p < plateCapacities.length; p++) {
      groupTotal += result[p][key] ?? 0;
    }
    expect(groupTotal).toBe(size);
  }

  // Invariant 3: Every cell within +/-1 of continuous ideal
  for (let p = 0; p < plateCapacities.length; p++) {
    for (const [key, size] of Object.entries(groupSizes)) {
      const ideal = (size * plateCapacities[p]) / totalCapacity;
      const actual = result[p][key] ?? 0;
      expect(actual).toBeGreaterThanOrEqual(Math.floor(ideal));
      expect(actual).toBeLessThanOrEqual(Math.ceil(ideal));
    }
  }

  // Invariant 4: All samples placed (total across all plates = total samples)
  let totalPlaced = 0;
  for (let p = 0; p < plateCapacities.length; p++) {
    totalPlaced += Object.values(result[p]).reduce((a, b) => a + b, 0);
  }
  expect(totalPlaced).toBe(totalSamples);
}

// --- Example 1: 127-sample asymmetric case (keepEmpty=true) -----------------

describe('Hamilton Apportionment - Example 1: 127-sample asymmetric', () => {
  const plateCapacities = [96, 31];
  const groupSizes = { Red: 44, Blue: 27, Green: 20, Orange: 14, BatchQC: 11, BatchRef: 11 };
  const groups = makeGroups(groupSizes);

  test('invariants hold (per-plate sum, per-group sum, +/-1 of ideal)', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('exact values: Plate 2 allocation matches Hamilton trace', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    // P2 quotas (size * 31 / 127): Red=10.74, Blue=6.59, Green=4.88,
    // Orange=3.42, BatchQC=2.69, BatchRef=2.69. Floors sum to 27, deficit 4.
    // Top remainders on P2: Green(.88), Red(.74), BatchQC(.69), BatchRef(.69)
    // -- the last two are tied but uncontested: both groups have surplus 1 and
    // both can take +1 on P2 within the deficit budget, so the result is
    // deterministic regardless of random tiebreak.
    expect(result[1]['Red']).toBe(11);
    expect(result[1]['Blue']).toBe(6);
    expect(result[1]['Green']).toBe(5);
    expect(result[1]['Orange']).toBe(3);
    expect(result[1]['BatchQC']).toBe(3);
    expect(result[1]['BatchRef']).toBe(3);
  });

  test('exact values: Plate 1 allocation matches Hamilton trace', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    expect(result[0]['Red']).toBe(33);
    expect(result[0]['Blue']).toBe(21);
    expect(result[0]['Green']).toBe(15);
    expect(result[0]['Orange']).toBe(11);
    expect(result[0]['BatchQC']).toBe(8);
    expect(result[0]['BatchRef']).toBe(8);
  });
});

// --- Example 2: Three plates with tiny last plate ---------------------------

describe('Hamilton Apportionment - Example 2: Three plates, tiny last', () => {
  const plateCapacities = [96, 96, 8];
  const groupSizes = { GroupA: 80, GroupB: 60, GroupC: 40, GroupD: 20 };
  const groups = makeGroups(groupSizes);

  test('invariants hold', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('Plate 3 (smallest) allocation is deterministic', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    // P3 quotas: A=3.2, B=2.4, C=1.6, D=0.8.
    // Floors: A=3, B=2, C=1, D=0. Deficit=2. Top remainders: D(0.8), C(0.6).
    // No tied fractional remainders on P3, so the +1 awards there are
    // deterministic regardless of random tiebreak order.
    expect(result[2]['GroupA']).toBe(3);
    expect(result[2]['GroupB']).toBe(2);
    expect(result[2]['GroupC']).toBe(2);
    expect(result[2]['GroupD']).toBe(1);
  });
});

// --- Example 3: Many small QC groups ----------------------------------------

describe('Hamilton Apportionment - Example 3: Many small QC groups', () => {
  const plateCapacities = [72, 28];
  const groupSizes = { Exp1: 12, Exp2: 12, Exp3: 12, Exp4: 12, Exp5: 12, QCA: 10, QCB: 10, QCC: 10, QCD: 10 };
  const groups = makeGroups(groupSizes);

  test('invariants hold', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('all 4 QC types get exactly 3 on Plate 2', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    // QC quotas on P2: 10*28/100 = 2.8 -> floor 2, remainder 0.8 (top remainders)
    expect(result[1]['QCA']).toBe(3);
    expect(result[1]['QCB']).toBe(3);
    expect(result[1]['QCC']).toBe(3);
    expect(result[1]['QCD']).toBe(3);
  });

  test('exactly one experimental group gets 4 on Plate 2 (others get 3)', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    const expCounts = [result[1]['Exp1'], result[1]['Exp2'], result[1]['Exp3'], result[1]['Exp4'], result[1]['Exp5']];
    expect(expCounts.filter(c => c === 4).length).toBe(1);
    expect(expCounts.filter(c => c === 3).length).toBe(4);
  });
});

// --- Example 4: keepEmpty=false with uneven distribution --------------------

describe('Hamilton Apportionment - Example 4: keepEmpty=false equal plates', () => {
  const plateCapacities = [75, 75];
  const groupSizes = { A: 60, B: 45, C: 30, D: 15 };
  const groups = makeGroups(groupSizes);

  test('invariants hold', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('exact values: tied remainder splits B and D across the two plates', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    // Per-plate quotas: A=30.0, B=22.5, C=15.0, D=7.5. Per-plate deficit=1.
    // Tied remainders within each plate: B(0.5) and D(0.5). The global random
    // tiebreak picks one of them on each plate, so the +1s are distributed
    // 1+1 across (group, plate) pairs without ever placing 2 +1s on the same
    // group or the same plate (that would violate the surplus / room limits).
    // The result: D and B each gain exactly one +1 in total, on different
    // plates -- which plate is the random part.
    const dTotal = result[0]['D'] + result[1]['D'];
    const bTotal = result[0]['B'] + result[1]['B'];
    expect(dTotal).toBe(15);
    expect(bTotal).toBe(45);
    // One plate has D=8, the other has D=7
    expect([result[0]['D'], result[1]['D']].sort()).toEqual([7, 8]);
    expect([result[0]['B'], result[1]['B']].sort()).toEqual([22, 23]);
  });
});

// --- Example 5: Group smaller than number of plates -------------------------

describe('Hamilton Apportionment - Example 5: Group smaller than numPlates', () => {
  const plateCapacities = [16, 16, 16, 2];
  const groupSizes = { Large: 40, Tiny: 3, Medium: 7 };
  const groups = makeGroups(groupSizes);

  test('invariants hold', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('Plate 4 (smallest) gets Large=1, Medium=1, Tiny=0', () => {
    // Large's three +1s go to P1/P2/P3 (frac 0.8) ahead of P4 (frac 0.6), so
    // Large on P4 stays at floor=1. P4 still has one slot of deficit, and the
    // top remaining remainder for P4 is Medium (0.28 > Tiny's 0.12), so
    // Medium gets the +1. Tied remainders exist within Large's three 0.8
    // entries and within Tiny's three 0.96 entries, but each tie is
    // uncontested (every cell in the tie ends up getting its +1), so the
    // result is deterministic on this input even though tiebreak is random.
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    expect(result[3]['Large']).toBe(1);
    expect(result[3]['Tiny']).toBe(0);
    expect(result[3]['Medium']).toBe(1);
  });

  test('Tiny is distributed across exactly 3 plates (1 each)', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    const tinyPerPlate = [result[0]['Tiny'], result[1]['Tiny'], result[2]['Tiny'], result[3]['Tiny']];
    expect(tinyPerPlate.filter(c => c === 1).length).toBe(3);
    expect(tinyPerPlate.filter(c => c === 0).length).toBe(1);
    // The 0 should be on P4 (smallest plate, Tiny's remainder is lowest there)
    expect(result[3]['Tiny']).toBe(0);
  });
});

// --- Gap A: Surplus limit vs placed < size ----------------------------------

describe('Hamilton Apportionment - Gap A: Surplus limit eligibility', () => {
  // 4 plates of capacity 4, G=6, H=10. Total=16=capacity.
  // Quotas: G=1.5/plate (floor 1, frac 0.5), H=2.5/plate (floor 2, frac 0.5).
  // Group surplus: G = 6-4 = 2, H = 10-8 = 2.
  // Regression guard: a naive `placed<size` eligibility check would let G
  // accumulate 3 surplus and reach 7 (overshoot). The current algorithm
  // tracks groupSurplus directly, capped at groupSize - sum(floors).
  const plateCapacities = [4, 4, 4, 4];
  const groupSizes = { G: 6, H: 10 };
  const groups = makeGroups(groupSizes);

  test('invariants hold (invariant to plate shuffle order since all four plates have equal capacity)', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('group totals are exact (G=6, H=10) -- catches placed<size eligibility bug', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    let gTotal = 0, hTotal = 0;
    for (let p = 0; p < 4; p++) {
      gTotal += result[p]['G'];
      hTotal += result[p]['H'];
    }
    expect(gTotal).toBe(6);
    expect(hTotal).toBe(10);
  });
});

// --- Gap B: Swap-repair stuck state -----------------------------------------

describe('Hamilton Apportionment - Gap B: Swap-repair stuck state', () => {
  // 3 plates of capacity 2, 3 groups of size 2. Total=6=capacity.
  // All quotas = 0.667, all floors = 0, all deficits = 2.
  // With every cell at the same fractional remainder, an unlucky shuffle order
  // can leave one group needing a +1 on a plate that has already filled its
  // wells from other groups. The algorithm resolves this via a BFS swap chain
  // through the bipartite group/plate graph (see
  // docs/hamilton-2d-augmenting-path.svg). Without the repair, one plate
  // would end up 100% one group.
  const plateCapacities = [2, 2, 2];
  const groupSizes = { G1: 2, G2: 2, G3: 2 };
  const groups = makeGroups(groupSizes);

  test('invariants hold', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, plateCapacities, groupSizes);
  });

  test('every plate has at least 2 distinct groups -- catches missing repair', () => {
    const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
    for (let p = 0; p < 3; p++) {
      const distinctGroups = Object.values(result[p]).filter(c => c > 0).length;
      expect(distinctGroups).toBeGreaterThanOrEqual(2);
    }
  });
});

// --- Gap C: Row-level usage -------------------------------------------------

describe('Hamilton Apportionment - Gap C: Row-level usage', () => {
  // Use row capacities [12, 12, 7] (like Plate 2 in Example 1 with 3 rows)
  // Groups: Red 11, Blue 6, Green 5, Orange 3, BatchQC 3, BatchRef 3 = 31 total
  const rowCapacities = [12, 12, 7];
  const groupSizes = { Red: 11, Blue: 6, Green: 5, Orange: 3, BatchQC: 3, BatchRef: 3 };
  const groups = makeGroups(groupSizes);

  test('invariants hold for row-level distribution', () => {
    const result = calculateExpectedMinimums(rowCapacities, groups, BlockType.ROW);
    assertHamiltonInvariants(result, rowCapacities, groupSizes);
  });
});

// --- Gap D: Under-capacity must not over-allocate ---------------------------

describe('Hamilton Apportionment - Gap D: Under-capacity over-allocation', () => {
  // 4 blocks cap=10 each (totalCap=40), one group size 35 (totalSamples=35).
  // Per-block quota = 8.75 -> floor=8, ceil=9. Hamilton requires every cell to
  // be 8 or 9; ideal distribution is 9, 9, 9, 8 with empty wells trailing.
  // Bug: round-reset path could place G=10 on the first processed block (floor+2).
  const blockCapacities = [10, 10, 10, 10];
  const groupSizes = { G: 35 };
  const groups = makeGroups(groupSizes);

  test('no block exceeds ceil(quota) when totalSamples < totalCapacity', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, blockCapacities, groupSizes, { expectFilled: false });
  });

  test('group total equals group size (all 35 samples placed)', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    const gTotal = result[0]['G'] + result[1]['G'] + result[2]['G'] + result[3]['G'];
    expect(gTotal).toBe(35);
  });

  test('exactly three blocks get 9 and one block gets 8', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    const counts = [result[0]['G'], result[1]['G'], result[2]['G'], result[3]['G']];
    expect(counts.filter(c => c === 9).length).toBe(3);
    expect(counts.filter(c => c === 8).length).toBe(1);
  });
});

// --- Gap E: Integer quota under-capacity must not round up ------------------

describe('Hamilton Apportionment - Gap E: Integer-quota cells under capacity', () => {
  // Block capacities [6, 11, 13] (totalCapacity = 30) with one group size 10
  // (totalSamples = 10). Quotas: 2.0 on the cap-6 block (integer; floor == ceil),
  // 3.667 on cap-11, 4.333 on cap-13. surplusSamples = 10 - (2+3+4) = 1.
  // Bug: eligibility filter only checked surplus remaining, so the cap-6 block
  // could receive the +1 even though its quota was already an integer --
  // alloc 3 violates ceil(2.0) = 2.
  const blockCapacities = [6, 11, 13];
  const groupSizes = { G: 10 };
  const groups = makeGroups(groupSizes);

  test('integer-quota block does not exceed its quota', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    // Find the block with cap 6 -- it's the only one with an integer quota.
    let cap6BlockIdx = -1;
    for (let p = 0; p < blockCapacities.length; p++) {
      if (blockCapacities[p] === 6) {
        cap6BlockIdx = p;
        break;
      }
    }
    expect(result[cap6BlockIdx]['G']).toBe(2);
  });

  test('every cell respects floor <= alloc <= ceil of (size * cap / totalCap)', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    assertHamiltonInvariants(result, blockCapacities, groupSizes, { expectFilled: false });
  });

  test('group total equals group size', () => {
    const result = calculateExpectedMinimums(blockCapacities, groups, BlockType.PLATE);
    const gTotal = result[0]['G'] + result[1]['G'] + result[2]['G'];
    expect(gTotal).toBe(10);
  });
});


// --- Regression Tests: Unchanged Behavior (3.1-3.4) -------------------------

describe('Hamilton Apportionment - Regression: Unchanged Behavior', () => {

  // 3.1: Equal capacity plates -> standard equal distribution
  describe('3.1: Equal capacity plates', () => {
    const plateCapacities = [48, 48];
    const groupSizes = { A: 40, B: 30, C: 15, D: 8, E: 3 };
    const groups = makeGroups(groupSizes);

    test('each group is split evenly (+/-1) across equal plates', () => {
      const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
      for (const [key, size] of Object.entries(groupSizes)) {
        const p1 = result[0][key];
        const p2 = result[1][key];
        // Both plates should get the same or +/-1 for each group
        expect(Math.abs(p1 - p2)).toBeLessThanOrEqual(1);
      }
    });

    test('no plate allocation exceeds plate capacity', () => {
      const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
      for (let p = 0; p < plateCapacities.length; p++) {
        const plateSum = Object.values(result[p]).reduce((a, b) => a + b, 0);
        expect(plateSum).toBeLessThanOrEqual(plateCapacities[p]);
      }
    });
  });

  // 3.2: Single plate -> allocation equals group sizes exactly
  describe('3.2: Single plate', () => {
    const plateCapacities = [50];
    const groupSizes = { X: 20, Y: 15, Z: 15 };
    const groups = makeGroups(groupSizes);

    test('single plate allocation equals group sizes exactly', () => {
      const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);
      expect(result[0]['X']).toBe(20);
      expect(result[0]['Y']).toBe(15);
      expect(result[0]['Z']).toBe(15);
    });
  });

  // 3.3: Throws when total samples exceed total capacity
  describe('3.3: Throws on overcapacity', () => {
    test('throws when total samples exceed total capacity', () => {
      const plateCapacities = [10, 10];
      const groups = makeGroups({ A: 15, B: 10 }); // 25 > 20
      expect(() =>
        calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE)
      ).toThrow();
    });
  });

  // 3.4: No plate exceeds its capacity (adversarial input)
  describe('3.4: Plate capacity never exceeded', () => {
    test('adversarial: many groups with large remainders on small plate', () => {
      // 10 groups of 7 each = 70 samples across plates [60, 10]
      // Each group's quota on P2: 7*10/70 = 1.0 -> floor 1, remainder 0.0
      // All floors sum to 10 = capacity. No deficit. Should be exact.
      const plateCapacities = [60, 10];
      const groupSizes: Record<string, number> = {};
      for (let i = 0; i < 10; i++) {
        groupSizes[`G${i}`] = 7;
      }
      const groups = makeGroups(groupSizes);
      const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);

      // Verify no plate exceeds capacity
      for (let p = 0; p < plateCapacities.length; p++) {
        const plateSum = Object.values(result[p]).reduce((a, b) => a + b, 0);
        expect(plateSum).toBeLessThanOrEqual(plateCapacities[p]);
      }
    });

    test('adversarial: remainders that could round up past capacity', () => {
      // 3 groups of 9 each = 27 samples across plates [20, 7]
      // P2 quotas: 9*7/27 = 2.333 each -> floor 2, remainder 0.333
      // Floors sum to 6, deficit = 1. Only 1 group gets +1. Sum = 7 = capacity.
      const plateCapacities = [20, 7];
      const groupSizes = { A: 9, B: 9, C: 9 };
      const groups = makeGroups(groupSizes);
      const result = calculateExpectedMinimums(plateCapacities, groups, BlockType.PLATE);

      const p2Sum = Object.values(result[1]).reduce((a, b) => a + b, 0);
      expect(p2Sum).toBeLessThanOrEqual(7);
    });
  });
});
