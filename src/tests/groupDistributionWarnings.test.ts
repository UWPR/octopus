import {
  computeGroupDistributionWarnings,
  aggregateObservedGroupBalance,
  computeQcRowCoverage,
  POOR_BALANCE_THRESHOLD,
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
  it('threshold constant is the Fair floor (70)', () => {
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
    const observed = new Map([['A', 95]]);
    const result = computeGroupDistributionWarnings([makeItem('A', 90)], 3, { observedGroupBalance: observed });
    expect(result.byCombination.size).toBe(0);
  });

  it('observed mode: coverable group below threshold becomes a warning', () => {
    const observed = new Map([['A', 60]]);
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, { observedGroupBalance: observed });
    const warning = result.byCombination.get('A')!;
    expect(warning.severity).toBe('warning');
    expect(warning.reason).toBe(
      'Balance score 60 (Poor or Bad). This group is spread unevenly across the 3 plates.'
    );
  });

  it('observed mode: a group exactly at the threshold is clean', () => {
    const observed = new Map([['A', 70]]);
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, { observedGroupBalance: observed });
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

  it('QC group with too few samples: error, isQc true, "add more" reason', () => {
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
      'This QC/reference group is missing from 4 of 10 used rows. It has only 2 samples for 10 used rows, so add more QC/reference samples.'
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
      'This QC/reference group is missing from 1 of 8 used rows. It has only 6 samples for 8 used rows, so add more QC/reference samples.'
    );
  });

  it('QC group with full row coverage still gets the balance warning', () => {
    const rowCoverage = new Map([['BatchQC|na|na', { usedRows: 10, uncoveredRows: 0 }]]);
    const observed = new Map([['BatchQC|na|na', 55]]);
    const result = computeGroupDistributionWarnings([makeItem('BatchQC|na|na', 30, 'BatchQC')], 3, {
      selectedQcValues: ['BatchQC'],
      qcRowCoverage: rowCoverage,
      observedGroupBalance: observed,
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
    const observed = new Map([['A', 10]]);
    const result = computeGroupDistributionWarnings([makeItem('A', 2)], 3, { observedGroupBalance: observed });
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
      '2 of the treatment covariate groups are not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every treatment ' +
        'covariate group.',
    ]);
  });

  it('run summary: singular treatment wording keeps the plural noun', () => {
    const items = [makeItem('big', 90), makeItem('small', 2), makeItem('mid', 30)];
    const result = computeGroupDistributionWarnings(items, 3);
    expect(result.summaries).toEqual([
      '1 of the treatment covariate groups is not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every treatment ' +
        'covariate group.',
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
      '1 of the treatment covariate groups is not represented on every plate. ' +
        'Ideally, each plate should have at least one sample from every treatment ' +
        'covariate group.',
      '2 of the QC/Reference groups are not represented on every row. Ideally, each ' +
        'row should have at least one sample from every QC/Reference group.',
    ]);
  });

  it('run summary: balance line appears when a covered group is unevenly placed', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, {
      observedGroupBalance: new Map([['A', 55]]),
    });
    expect(result.summaries).toEqual([
      '1 covariate group is placed unevenly across the plates (Poor or Bad balance).',
    ]);
  });

  it('no flagged groups: empty summaries, empty map', () => {
    const result = computeGroupDistributionWarnings([makeItem('A', 30), makeItem('B', 30)], 3);
    expect(result.summaries).toEqual([]);
    expect(result.byCombination.size).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('a flagged group never displays a balance score of 70 (floors the mean, not rounds)', () => {
    // Mean (70 + 69) / 2 = 69.5 is below the 70 threshold, so the group is flagged.
    // Rounding would show "70", which contradicts 70 being the acceptable Fair floor.
    // Flooring shows 69.
    const observed = aggregateObservedGroupBalance(makeMetrics([{ A: 70 }, { A: 69 }]));
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 2, { observedGroupBalance: observed });
    const warning = result.byCombination.get('A')!;
    expect(warning.severity).toBe('warning');
    expect(warning.reason).toBe(
      'Balance score 69 (Poor or Bad). This group is spread unevenly across the 2 plates.'
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
        observedGroupBalance: new Map([['A', 10]]),
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

describe('aggregateObservedGroupBalance', () => {
  it('averages each group balance across plates', () => {
    const metrics = makeMetrics([
      { A: 80, B: 100 },
      { A: 60, B: 90 },
    ]);
    const means = aggregateObservedGroupBalance(metrics);
    expect(means.get('A')).toBe(70);
    expect(means.get('B')).toBe(95);
  });

  it('feeds computeGroupDistributionWarnings: mean below threshold flips severity', () => {
    // Group A averages (80 + 40 + 30) / 3 = 50, below 70 -> warning.
    const metrics = makeMetrics([{ A: 80 }, { A: 40 }, { A: 30 }]);
    const observed = aggregateObservedGroupBalance(metrics);
    const result = computeGroupDistributionWarnings([makeItem('A', 30)], 3, { observedGroupBalance: observed });
    expect(result.byCombination.get('A')!.severity).toBe('warning');
    expect(result.byCombination.get('A')!.reason).toContain('Balance score 50');
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
