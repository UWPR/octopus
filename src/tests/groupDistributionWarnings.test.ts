import {
  computeGroupDistributionWarnings,
  groupBalanceDetails,
  bannerSections,
  coverageItems,
  computeQcRowCoverage,
  hasCoverageError,
  POOR_BALANCE_THRESHOLD,
  GroupBalanceDetail,
} from '../utils/groupDistributionWarnings';
import { SummaryItem, QualityMetrics, PlateQualityScore, SearchData } from '../utils/types';

/** Build a SummaryItem with only the fields the warnings logic reads. */
function makeItem(
  combination: string,
  count: number,
  qcColumnValue?: string
): SummaryItem {
  return {
    combination,
    values: {},
    count,
    color: '#cccccc',
    useOutline: false,
    useStripes: false,
    qcColumnValue,
  };
}

/**
 * A balance detail with the given mean, for a 30-sample group placed 10 per plate on 3 plates.
 * Only the mean and atBest decide whether a group is flagged; the rest shapes the reason text.
 */
function detail(observedMean: number, overrides: Partial<GroupBalanceDetail> = {}): GroupBalanceDetail {
  return {
    observedMean,
    plateCounts: [10, 10, 10],
    evenCounts: [10, 10, 10],
    atBest: false,
    ...overrides,
  };
}

/** A cell for the layout fixtures: only the covariate key matters here. */
function cell(combination: string): SearchData {
  return { name: combination, metadata: {}, covariateKey: combination };
}

const keyOf = (s: SearchData): string => s.covariateKey!;

/**
 * Build a QualityMetrics with the given per-plate group balance scores.
 * scoresByPlate[i] maps combination -> balanceScore on plate i.
 */
function makeMetrics(scoresByPlate: Array<Record<string, number>>): QualityMetrics {
  const plateScores: PlateQualityScore[] = scoresByPlate.map((groups, plateIndex) => {
    const covariateGroupBalance: PlateQualityScore['covariateGroupBalance'] = {};
    Object.entries(groups).forEach(([combination, balanceScore]) => {
      covariateGroupBalance[combination] = {
        actualCount: 0,
        expectedCount: 0,
        actualProportion: 0,
        expectedProportion: 0,
        relativeDeviation: 0,
        weightedDeviation: 0,
        balanceScore,
      };
    });
    return {
      plateIndex,
      balanceScore: 0,
      clusteringScore: 0,
      rowClusteringScore: 0,
      overallScore: 0,
      covariateGroupBalance,
    };
  });

  return {
    plateDiversity: {
      averageBalanceScore: 0,
      averageClusteringScore: 0,
      averageRowClusteringScore: 0,
      plateScores,
    },
    overallQuality: { score: 0, level: 'fair', recommendations: [] },
  };
}

describe('computeGroupDistributionWarnings', () => {
  it('threshold constant is 70', () => {
    expect(POOR_BALANCE_THRESHOLD).toBe(70);
  });

  it('P == 1: suppresses treatment coverage and balance warnings', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 1), makeItem('B', 0)], 1);
    expect(result.warningCount).toBe(0);
    expect(result.byCombination.size).toBe(0);
    expect(result.summaries).toEqual([]);
    expect(result.totalGroups).toBe(2);
    expect(result.plateCount).toBe(1);
  });

  it('c_g < P: coverage error naming c_g, P, and P - c_g', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 2)], 3);
    const warning = result.byCombination.get('A')!;
    expect(warning.severity).toBe('error');
    expect(warning.count).toBe(2);
    expect(warning.isQc).toBe(false);
    expect(warning.reason).toBe(
      'Only 2 samples for 3 plates. At least 1 plate will have 0 samples of this group.'
    );
    expect(result.warningCount).toBe(1);
  });

  it('c_g == 1 < P: singular sample wording, plural plates', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 1)], 3);
    expect(result.byCombination.get('A')!.reason).toBe(
      'Only 1 sample for 3 plates. At least 2 plates will have 0 samples of this group.'
    );
  });

  it('c_g == P: coverable, no warning when no observed balance', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 3)], 3);
    expect(result.byCombination.size).toBe(0);
    expect(result.summaries).toEqual([]);
  });

  it('well-covered, well-balanced group: no warning', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 90)], 3, {
      balanceDetails: new Map([['A', detail(95)]]),
    });
    expect(result.byCombination.size).toBe(0);
  });

  it('observed mode: coverable group below threshold becomes a warning', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      balanceDetails: new Map([['A', detail(60, { plateCounts: [14, 9, 7] })]]),
    });
    const warning = result.byCombination.get('A')!;
    expect(warning.severity).toBe('warning');
    expect(warning.reason).toBe(
      'Mean per-plate balance score 60 (below 70). Per plate: 14, 9, 7. Most even: 10, 10, 10.'
    );
    expect(warning.balance).toEqual(detail(60, { plateCounts: [14, 9, 7] }));
  });

  it('observed mode: a group exactly at the threshold is clean', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      balanceDetails: new Map([['A', detail(70)]]),
    });
    expect(result.byCombination.size).toBe(0);
  });

  it('QC group is judged by row coverage, not the per-plate count rule', () => {
    // 2 samples across 3 plates would fail the treatment per-plate rule, but a QC
    // group is not flagged on count. With full row coverage it is clean.
    const rowCoverage = new Map([['BatchRef|na|na', { usedRows: 10, uncoveredRows: 0 }]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchRef|na|na', 2, 'BatchRef')], 3, {
      selectedQcValues: ['BatchQC', 'BatchRef'],
      qcRowCoverage: rowCoverage,
    });
    expect(result.byCombination.size).toBe(0);
  });

  it('QC group with too few samples: error, isQc true, sample count reason', () => {
    // count 2 < usedRows 10, so it can never cover every row.
    const rowCoverage = new Map([['BatchRef|na|na', { usedRows: 10, uncoveredRows: 4 }]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchRef|na|na', 2, 'BatchRef')], 3, {
      selectedQcValues: ['BatchQC', 'BatchRef'],
      qcRowCoverage: rowCoverage,
    });
    const warning = result.byCombination.get('BatchRef|na|na')!;
    expect(warning.severity).toBe('error');
    expect(warning.isQc).toBe(true);
    expect(warning.reason).toBe(
      'This QC/reference group is missing from 4 of 10 used rows. It has only 2 samples for 10 used rows.'
    );
  });

  it('QC group with enough samples but a placement gap: "move" reason', () => {
    // count 30 >= usedRows 24, so moving samples can close the gap.
    const rowCoverage = new Map([['BatchQC|na|na', { usedRows: 24, uncoveredRows: 3 }]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchQC|na|na', 30, 'BatchQC')], 3, {
      selectedQcValues: ['BatchQC'],
      qcRowCoverage: rowCoverage,
    });
    expect(result.byCombination.get('BatchQC|na|na')!.reason).toBe(
      'This QC/reference group is missing from 3 of 24 used rows. Move samples so every used row has one.'
    );
  });

  it('QC row coverage fires even on a single plate (P == 1)', () => {
    const rowCoverage = new Map([['BatchRef|na|na', { usedRows: 8, uncoveredRows: 1 }]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchRef|na|na', 6, 'BatchRef')], 1, {
      selectedQcValues: ['BatchRef'],
      qcRowCoverage: rowCoverage,
    });
    expect(result.byCombination.get('BatchRef|na|na')!.severity).toBe('error');
    expect(result.byCombination.get('BatchRef|na|na')!.reason).toBe(
      'This QC/reference group is missing from 1 of 8 used rows. It has only 6 samples for 8 used rows.'
    );
  });

  it('QC group with full row coverage still gets the balance warning', () => {
    const rowCoverage = new Map([['BatchQC|na|na', { usedRows: 10, uncoveredRows: 0 }]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchQC|na|na', 30, 'BatchQC')], 3, {
      selectedQcValues: ['BatchQC'],
      qcRowCoverage: rowCoverage,
      balanceDetails: new Map([['BatchQC|na|na', detail(55)]]),
    });
    const warning = result.byCombination.get('BatchQC|na|na')!;
    expect(warning.severity).toBe('warning');
    expect(warning.isQc).toBe(true);
  });

  it('QC group without supplied row coverage is not flagged on coverage', () => {
    const result = computeGroupDistributionWarnings([makeItem('BatchRef|na|na', 2, 'BatchRef')], 3, {
      selectedQcValues: ['BatchRef'],
    });
    expect(result.byCombination.size).toBe(0);
  });

  it('a non-selected QC column value is treated as a treatment group', () => {
    // qcColumnValue is set on every group when a QC column is configured, but
    // only selected QC values mark a group as QC. A non-selected value falls under
    // the per-plate treatment rule.
    const result = computeGroupDistributionWarnings([makeItem('A', 2, 'Study')], 3, {
      selectedQcValues: ['BatchQC', 'BatchRef'],
    });
    const warning = result.byCombination.get('A')!;
    expect(warning.isQc).toBe(false);
    expect(warning.severity).toBe('error');
  });

  it('precedence: a group that is both uncoverable and poorly balanced is reported once as error', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 2)], 3, {
      balanceDetails: new Map([['A', detail(10)]]),
    });
    expect(result.byCombination.size).toBe(1);
    expect(result.byCombination.get('A')!.severity).toBe('error');
  });

  it('run summary: plural treatment coverage line, no total-group denominator', () => {
    const items = [
      makeItem('big1', 90),
      makeItem('big2', 90),
      makeItem('big3', 90),
      makeItem('small1', 2),
      makeItem('small2', 1),
    ];
    const result = computeGroupDistributionWarnings(items, 3);
    expect(result.warningCount).toBe(2);
    expect(result.summaries).toEqual([
      '2 of the covariate groups are not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every covariate group.',
    ]);
  });

  it('run summary: singular treatment wording keeps the plural noun', () => {
    const items = [makeItem('big', 90), makeItem('small', 2), makeItem('mid', 30)];
    const result = computeGroupDistributionWarnings(items, 3);
    expect(result.summaries).toEqual([
      '1 of the covariate groups is not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every covariate group.',
    ]);
  });

  it('run summary: QC coverage is a separate line from treatment coverage', () => {
    const rowCoverage = new Map([
      ['BatchRef|na|na', { usedRows: 10, uncoveredRows: 4 }],
      ['BatchQC|na|na', { usedRows: 10, uncoveredRows: 2 }],
    ]);
    const items = [
      makeItem('small', 2), // treatment coverage error
      makeItem('BatchRef|na|na', 2, 'BatchRef'), // QC coverage error
      makeItem('BatchQC|na|na', 8, 'BatchQC'), // QC coverage error
    ];
    const result = computeGroupDistributionWarnings(items, 3, {
      selectedQcValues: ['BatchQC', 'BatchRef'],
      qcRowCoverage: rowCoverage,
    });
    expect(result.summaries).toEqual([
      '1 of the covariate groups is not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every covariate group.',
      '2 of the QC/Reference groups are not represented on every row. Ideally, each ' +
        'row should have at least one sample from every QC/Reference group.',
    ]);
  });

  it('run summary: balance line appears when a covered group is unevenly placed', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      balanceDetails: new Map([['A', detail(55)]]),
    });
    expect(result.summaries).toEqual([
      '1 covariate group placed less evenly across the plates than its sample count allows ' +
      '(mean per-plate balance score below 70).',
    ]);
    expect(result.sections).toEqual([{ kind: 'balance', line: result.summaries[0], combinations: ['A'] }]);
  });

  it('run summary: plural balance line names the count and uses their', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30), makeItem('B', 30)], 3, {
      balanceDetails: new Map([['A', detail(55)], ['B', detail(40)]]),
    });
    expect(result.summaries).toEqual([
      '2 covariate groups placed less evenly across the plates than their sample counts allow ' +
      '(mean per-plate balance score below 70).',
    ]);
  });

  it('no flagged groups: empty summaries, empty map', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30), makeItem('B', 30)], 3);
    expect(result.summaries).toEqual([]);
    expect(result.byCombination.size).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('a flagged group never displays a balance score of 70 (floors the mean, not rounds)', () => {
    // A mean of 69.5 is below the 70 threshold, so the group is flagged.
    // Rounding would show "70", which contradicts 70 being acceptable.
    // Flooring shows 69.
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 2, {
      balanceDetails: new Map([['A', detail(69.5, { plateCounts: [16, 14], evenCounts: [15, 15] })]]),
    });
    const warning = result.byCombination.get('A')!;
    expect(warning.severity).toBe('warning');
    expect(warning.reason).toBe(
      'Mean per-plate balance score 69 (below 70). Per plate: 16, 14. Most even: 15, 15.'
    );
  });

  it('P == 0: the guard evaluates nothing, even with coverage gaps and bad balance supplied', () => {
    const rowCoverage = new Map([['BatchRef|na|na', { usedRows: 4, uncoveredRows: 2 }]]);
    const result = computeGroupDistributionWarnings(
      [makeItem('A', 0), makeItem('BatchRef|na|na', 1, 'BatchRef')],
      0,
      {
        selectedQcValues: ['BatchRef'],
        qcRowCoverage: rowCoverage,
        balanceDetails: new Map([['A', detail(10)]]),
      }
    );
    expect(result.byCombination.size).toBe(0);
    expect(result.summaries).toEqual([]);
    expect(result.plateCount).toBe(0);
  });

  it('treatment coverage activates at the P == 1 -> P == 2 transition', () => {
    const item = [makeItem('A', 1)];
    // Suppressed on a single plate, flagged as soon as there are two.
    expect(computeGroupDistributionWarnings(item, 1).byCombination.size).toBe(0);
    const atTwo = computeGroupDistributionWarnings(item, 2).byCombination.get('A')!;
    expect(atTwo.severity).toBe('error');
    expect(atTwo.reason).toBe(
      'Only 1 sample for 2 plates. At least 1 plate will have 0 samples of this group.'
    );
  });

  it('an N/A covariate group is flagged by the treatment count rule like any other group', () => {
    // Current behavior: the folded N/A group is treated no differently from a real
    // group. Whether N/A groups should be excluded from coverage is an open question
    // left for later, so this pins today's behavior rather than endorsing it.
    const result = computeGroupDistributionWarnings([makeItem('N/A', 1)], 3);
    const warning = result.byCombination.get('N/A')!;
    expect(warning.severity).toBe('error');
    expect(warning.isQc).toBe(false);
  });
});

describe('hasCoverageError', () => {
  it('is true when any flagged group is a coverage error', () => {
    // A treatment group with too few samples is a coverage error.
    const result = computeGroupDistributionWarnings([makeItem('A', 2), makeItem('B', 90)], 3);
    expect(hasCoverageError(result)).toBe(true);
  });

  it('is false when the only flagged groups are balance (UNEVEN) warnings', () => {
    // Covered group, poor balance: a warning, not a coverage error.
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      balanceDetails: new Map([['A', detail(55)]]),
    });
    expect(result.byCombination.get('A')!.severity).toBe('warning');
    expect(hasCoverageError(result)).toBe(false);
  });

  it('is false when nothing is flagged', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3);
    expect(hasCoverageError(result)).toBe(false);
  });
});

describe('groupBalanceDetails observed mean', () => {
  it('averages each group balance across plates', () => {
    const metrics = makeMetrics([
      { A: 80, B: 100 },
      { A: 60, B: 90 },
    ]);
    const details = groupBalanceDetails(metrics);
    expect(details.get('A')!.observedMean).toBe(70);
    expect(details.get('B')!.observedMean).toBe(95);
  });

  it('feeds computeGroupDistributionWarnings: mean below threshold flips severity', () => {
    // Group A, 30 samples placed 14, 14, 2 where 10 per plate is expected, scores 60, 60 and 20.
    // The mean, 46.7, is below 70 -> warning.
    const metrics = makeCountMetrics([{ A: [14, 10] }, { A: [14, 10] }, { A: [2, 10] }]);
    expect(groupBalanceDetails(metrics).get('A')!.observedMean).toBe(140 / 3);
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      balanceDetails: groupBalanceDetails(metrics),
    });
    expect(result.byCombination.get('A')!.severity).toBe('warning');
    expect(result.byCombination.get('A')!.reason).toContain('Mean per-plate balance score 46');
  });
});

describe('computeQcRowCoverage', () => {
  // One plate, three rows. Row 0 has a QC sample, row 1 does not, row 2 is empty.
  const plates: (SearchData | undefined)[][][] = [
    [
      [cell('QC'), cell('Drug'), cell('Drug')],
      [cell('Drug'), cell('Placebo'), undefined],
      [undefined, undefined, undefined],
    ],
  ];

  it('counts used rows a QC group is missing from, ignoring empty rows', () => {
    const coverage = computeQcRowCoverage(plates, new Set(['QC']), keyOf);
    expect(coverage.get('QC')).toEqual({ usedRows: 2, uncoveredRows: 1 });
  });

  it('scores each QC group independently against the same used-row set', () => {
    // Row 0 has QC but not Ref; row 1 has Ref but not QC. Each group is missing
    // from exactly one of the two used rows.
    const withRef: (SearchData | undefined)[][][] = [
      [
        [cell('QC'), cell('Drug')],
        [cell('Ref'), cell('Placebo')],
      ],
    ];
    const coverage = computeQcRowCoverage(withRef, new Set(['QC', 'Ref']), keyOf);
    expect(coverage.get('QC')).toEqual({ usedRows: 2, uncoveredRows: 1 });
    expect(coverage.get('Ref')).toEqual({ usedRows: 2, uncoveredRows: 1 });
  });

  it('a QC group present in every used row has zero uncovered rows', () => {
    const covered: (SearchData | undefined)[][][] = [
      [
        [cell('QC'), cell('Drug')],
        [cell('QC'), cell('Placebo')],
      ],
    ];
    const coverage = computeQcRowCoverage(covered, new Set(['QC']), keyOf);
    expect(coverage.get('QC')).toEqual({ usedRows: 2, uncoveredRows: 0 });
  });

  it('an empty layout yields zero used rows and no uncovered rows', () => {
    const coverage = computeQcRowCoverage([], new Set(['QC']), keyOf);
    expect(coverage.get('QC')).toEqual({ usedRows: 0, uncoveredRows: 0 });
  });

  it('a layout of only empty rows yields zero used rows and no uncovered rows', () => {
    const allEmpty: (SearchData | undefined)[][][] = [
      [
        [undefined, undefined],
        [undefined, undefined],
      ],
    ];
    const coverage = computeQcRowCoverage(allEmpty, new Set(['QC']), keyOf);
    expect(coverage.get('QC')).toEqual({ usedRows: 0, uncoveredRows: 0 });
  });
});

// Metrics with the per-plate counts set and each plate's group score computed from them as
// calculatePlateBalance does. countsByPlate[i] maps combination -> [actual, expected].
function makeCountMetrics(countsByPlate: Array<Record<string, [number, number]>>): QualityMetrics {
  const score = (actual: number, expected: number) =>
    Math.round(Math.max(0, 100 - Math.min(Math.abs(actual - expected) / expected, 1) * 100));
  const metrics = makeMetrics(countsByPlate.map(groups =>
    Object.fromEntries(Object.entries(groups).map(([k, [actual, expected]]) => [k, score(actual, expected)]))));
  metrics.plateDiversity.plateScores.forEach((plate, i) => {
    Object.entries(countsByPlate[i]).forEach(([combination, [actual, expected]]) => {
      plate.covariateGroupBalance[combination].actualCount = actual;
      plate.covariateGroupBalance[combination].expectedCount = expected;
    });
  });
  return metrics;
}

// The groups that groupBalanceDetails finds at their best achievable balance
function groupsAtBest(metrics: QualityMetrics): string[] {
  return Array.from(groupBalanceDetails(metrics))
    .filter(([, detail]) => detail.atBest)
    .map(([combination]) => combination);
}

describe('groupBalanceDetails at best', () => {
  it('includes a group whose count on every plate is its expected count rounded down or up', () => {
    // 4 samples on 3 equal plates: expected 1.33 each, so 2/1/1 is the most even split
    const metrics = makeCountMetrics([
      { V: [2, 4 / 3], D: [3, 4 / 3] },
      { V: [1, 4 / 3], D: [1, 4 / 3] },
      { V: [1, 4 / 3], D: [0, 4 / 3] },
    ]);
    expect(groupsAtBest(metrics)).toEqual(['V']);
  });

  it('judges each plate by its own expected count, so an even split onto a small plate is not included', () => {
    // 30 samples on plates of 96, 96 and 20 samples out of 212: 10/10/10 overloads the small plate
    const expected = [30 * 96 / 212, 30 * 96 / 212, 30 * 20 / 212];
    const metrics = makeCountMetrics([
      { E: [10, expected[0]], P: [14, expected[0]] },
      { E: [10, expected[1]], P: [13, expected[1]] },
      { E: [10, expected[2]], P: [3, expected[2]] },
    ]);
    expect(groupsAtBest(metrics)).toEqual(['P']);
  });

  it('includes any rounding, even one that scores lower than another rounding', () => {
    // 3 samples on two plates expected to hold 1.9 and 1.1. 2/1 scores 95 + 91 and 1/2 scores
    // 53 + 18, but both round each plate down or up.
    const metrics = makeCountMetrics([
      { X: [2, 1.9], Y: [1, 1.9] },
      { X: [1, 1.1], Y: [2, 1.1] },
    ]);
    expect(groupsAtBest(metrics)).toEqual(['X', 'Y']);
  });

  it('includes a rounding on three plates with a partly filled last plate', () => {
    // 5 samples on plates of 96, 96 and 40 samples out of 232: expected 2.07, 2.07 and 0.86.
    // Both 2/2/1 and 3/2/0 round each plate down or up.
    const e = [5 * 96 / 232, 5 * 96 / 232, 5 * 40 / 232];
    const metrics = makeCountMetrics([
      { A: [2, e[0]], B: [3, e[0]] },
      { A: [2, e[1]], B: [2, e[1]] },
      { A: [1, e[2]], B: [0, e[2]] },
    ]);
    expect(groupsAtBest(metrics)).toEqual(['A', 'B']);
  });
});

describe('computeGroupDistributionWarnings with groups at their best achievable balance', () => {
  it('gives no balance warning to a group placed as evenly as its count allows', () => {
    const summary = [{ combination: 'V', count: 4 }, { combination: 'D', count: 4 }];
    const warnings = computeGroupDistributionWarnings(summary, 3, {
      balanceDetails: new Map([['V', detail(66, { atBest: true })], ['D', detail(40)]]),
    });
    expect(Array.from(warnings.byCombination.keys())).toEqual(['D']);
  });
});

describe('groupBalanceDetails', () => {
  // 12 samples on 7 full plates expect 1.71 per plate. Placed 3, 1, 1, 2, 2, 2, 1 after a manual move.
  const e = 12 / 7;
  const counts = [3, 1, 1, 2, 2, 2, 1];
  const metrics = makeCountMetrics(counts.map(c => ({ G: [c, e] as [number, number] })));

  it('reports the per-plate counts in plate order, the mean, and the most even split', () => {
    const d = groupBalanceDetails(metrics).get('G')!;
    expect(d.plateCounts).toEqual(counts);
    // per-plate group scores 25, 58, 58, 83, 83, 83, 58
    expect(d.observedMean).toBe(64);
    // Plate 1 drops from 3 to 2, and plate 2, the first plate with 1, rises to 2
    expect(d.evenCounts).toEqual([2, 2, 1, 2, 2, 2, 1]);
    expect(d.atBest).toBe(false);
  });

  it('orders the plate counts by plate index, not by the order the scores arrive in', () => {
    const reversed = makeCountMetrics(counts.map(c => ({ G: [c, e] as [number, number] })));
    reversed.plateDiversity.plateScores.reverse();
    expect(groupBalanceDetails(reversed).get('G')!.plateCounts).toEqual(counts);
  });

  it('writes the reason with the placement and the most even split', () => {
    const result = computeGroupDistributionWarnings([makeItem('G', 12)], 7, {
      balanceDetails: groupBalanceDetails(metrics),
    });
    expect(result.byCombination.get('G')!.reason).toBe(
      'Mean per-plate balance score 64 (below 70). Per plate: 3, 1, 1, 2, 2, 2, 1. ' +
      'Most even: 2, 2, 1, 2, 2, 2, 1.'
    );
  });

  it('counts an empty plate as 0 in both lists and leaves it out of the mean', () => {
    // 6 samples on plates 1, 3 and 4 expect 2 each, and plate 2 is empty. Placed 3, 2, 1, the
    // group scores 50, 100 and 50.
    const m = makeCountMetrics([{ G: [3, 2] }, {}, { G: [2, 2] }, { G: [1, 2] }]);
    const result = computeGroupDistributionWarnings([makeItem('G', 6)], 4, { balanceDetails: groupBalanceDetails(m) });
    expect(result.byCombination.get('G')!.reason).toBe(
      'Mean per-plate balance score 66 (below 70). Per plate: 3, 0, 2, 1. ' +
      'Most even: 2, 0, 2, 2.'
    );
  });

  it('does not flag a group whose extra sample could go on a plate that scores higher', () => {
    // 4 samples on plates of 67, 67 and 66 samples expect 1.34, 1.34 and 1.32. Placed 1, 1, 2, the
    // mean is 66. Placed 2, 1, 1, the mean would be 67.3.
    const sizes = [67, 67, 66];
    const m = makeCountMetrics([1, 1, 2].map((c, i) => ({ G: [c, 4 * sizes[i] / 200] as [number, number] })));
    const d = groupBalanceDetails(m).get('G')!;
    expect(d.observedMean).toBe(66);
    expect(d.atBest).toBe(true);
    const result = computeGroupDistributionWarnings([makeItem('G', 4)], 3, { balanceDetails: groupBalanceDetails(m) });
    expect(result.byCombination.has('G')).toBe(false);
  });

  it('flags a group with a plate holding more than its expected count rounded up', () => {
    // 6 samples on plates of 96, 96, 96, 96 and 40 samples out of 424 expect 1.36 on each large
    // plate and 0.57 on the small one. Placed 1, 1, 1, 1, 2, the small plate holds 2.
    const sizes = [96, 96, 96, 96, 40];
    const m = makeCountMetrics([1, 1, 1, 1, 2].map((c, i) => ({ G: [c, 6 * sizes[i] / 424] as [number, number] })));
    expect(groupBalanceDetails(m).get('G')!.atBest).toBe(false);
    // The small plate drops to 1, and plate 1, the first large plate, rises to 2
    expect(groupBalanceDetails(m).get('G')!.evenCounts).toEqual([2, 1, 1, 1, 1]);
  });

  it('lowers the first plate at its rounded-up count when raising a plate overshoots the total', () => {
    // 4 samples on 3 equal plates expect 1.33 each. Placed 0, 2, 2, plate 1 rises to 1, so plate 2
    // drops to 1 to keep the total at 4.
    const m = makeCountMetrics([0, 2, 2].map(c => ({ G: [c, 4 / 3] as [number, number] })));
    expect(groupBalanceDetails(m).get('G')!.evenCounts).toEqual([1, 1, 2]);
  });

  it('lists the most even split as one count per plate when every plate gets the same count', () => {
    // 14 samples on 7 plates expect 2 each. Placed 4, 0, 3, 1, 2, 2, 2 scores 0, 0, 50, 50, 100, 100, 100.
    const m = makeCountMetrics([4, 0, 3, 1, 2, 2, 2].map(c => ({ G: [c, 2] as [number, number] })));
    const result = computeGroupDistributionWarnings([makeItem('G', 14)], 7, {
      balanceDetails: groupBalanceDetails(m),
    });
    expect(result.byCombination.get('G')!.reason).toBe(
      'Mean per-plate balance score 57 (below 70). Per plate: 4, 0, 3, 1, 2, 2, 2. ' +
      'Most even: 2, 2, 2, 2, 2, 2, 2.'
    );
  });
});

describe('bannerSections', () => {
  const item = (combination: string, count: number, values: Record<string, string>, qcColumnValue?: string) =>
    ({ ...makeItem(combination, count, qcColumnValue), values });
  const covariates = ['Cond', 'Site'];

  it('lists coverage groups smallest first and balance groups lowest score first, with the line above each', () => {
    const items = [
      item('a|x', 12, { Cond: 'a', Site: 'x' }),
      item('b|y', 1, { Cond: 'b', Site: 'y' }),
      item('c|z', 2, { Cond: 'c', Site: 'z' }),
      item('d|w', 12, { Cond: 'd', Site: 'w' }),
    ];
    const warnings = computeGroupDistributionWarnings(items, 3, {
      balanceDetails: new Map([['a|x', detail(64)], ['d|w', detail(40)]]),
    });
    expect(bannerSections(warnings, items, covariates, undefined)).toEqual([
      {
        line: '2 of the covariate groups are not represented on every plate. ' +
          'Ideally, each plate should have at least one sample from every covariate group.',
        groups: ['b | y (1 sample)', 'c | z (2 samples)'],
      },
      {
        line: '2 covariate groups placed less evenly across the plates than their sample counts allow ' +
          '(mean per-plate balance score below 70).',
        groups: ['d | w (12 samples, score 40)', 'a | x (12 samples, score 64)'],
      },
    ]);
  });

  it('names a QC group with its QC value in front', () => {
    const items = [item('BatchRef|p|q', 6, { Cond: 'p', Site: 'q' }, 'BatchRef')];
    const warnings = computeGroupDistributionWarnings(items, 3, {
      selectedQcValues: ['BatchRef'],
      balanceDetails: new Map([['BatchRef|p|q', detail(50)]]),
    });
    expect(bannerSections(warnings, items, covariates, 'Type')[0].groups)
      .toEqual(['BatchRef | p | q (6 samples, score 50)']);
  });

  it('names a QC group with its QC value in front when a covariate has the same value', () => {
    const items = [
      item('1|p|1', 6, { Cond: 'p', Site: '1' }, '1'),
      item('p|1', 6, { Cond: 'p', Site: '1' }),
    ];
    const warnings = computeGroupDistributionWarnings(items, 3, {
      selectedQcValues: ['1'],
      balanceDetails: new Map([['1|p|1', detail(50)], ['p|1', detail(60)]]),
    });
    expect(bannerSections(warnings, items, covariates, 'IsQC')[0].groups)
      .toEqual(['1 | p | 1 (6 samples, score 50)', 'p | 1 (6 samples, score 60)']);
  });

  it('does not repeat the QC value when the QC column is itself a selected covariate', () => {
    const items = [item('BatchRef|q', 6, { Cond: 'BatchRef', Site: 'q' }, 'BatchRef')];
    const warnings = computeGroupDistributionWarnings(items, 3, {
      selectedQcValues: ['BatchRef'],
      balanceDetails: new Map([['BatchRef|q', detail(50)]]),
    });
    expect(bannerSections(warnings, items, covariates, 'Cond')[0].groups)
      .toEqual(['BatchRef | q (6 samples, score 50)']);
  });

  it('coverageItems sorts smallest first and uses the singular for one sample', () => {
    expect(coverageItems([{ label: 'b', count: 2 }, { label: 'a', count: 2 }, { label: 'c', count: 1 }]))
      .toEqual(['c (1 sample)', 'a (2 samples)', 'b (2 samples)']);
  });
});
