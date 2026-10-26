import {
  plannedTreatmentGroups,
  plannedCoverageSummary,
  computeGroupDistributionWarnings,
  covariateGroupLabel,
} from '../utils/groupDistributionWarnings';
import { SearchData, DEFAULT_NA_POLICY } from '../utils/types';

const sample = (name: string, metadata: { [key: string]: string }): SearchData => ({ name, metadata });

// 6 samples of a|x, 3 of b|x, 1 of b|y, and 2 QC samples
const samples: SearchData[] = [
  ...Array.from({ length: 6 }, (_, i) => sample(`A${i}`, { Cond: 'a', Site: 'x', Type: 'S' })),
  ...Array.from({ length: 3 }, (_, i) => sample(`B${i}`, { Cond: 'b', Site: 'x', Type: 'S' })),
  sample('C0', { Cond: 'b', Site: 'y', Type: 'S' }),
  sample('Q0', { Cond: 'a', Site: 'x', Type: 'QC' }),
  sample('Q1', { Cond: 'a', Site: 'x', Type: 'QC' }),
];

describe('plannedTreatmentGroups', () => {
  it('counts the treatment samples per covariate key and labels each group with its values', () => {
    const groups = plannedTreatmentGroups(samples, ['Cond', 'Site'], DEFAULT_NA_POLICY, 'Type', ['QC']);

    expect(groups.map(g => [g.label, g.count])).toEqual([['a | x', 6], ['b | x', 3], ['b | y', 1]]);
  });

  it('keeps the QC samples when no QC value is selected', () => {
    const groups = plannedTreatmentGroups(samples, ['Cond'], DEFAULT_NA_POLICY, 'Type', []);

    expect(groups.map(g => [g.label, g.count])).toEqual([['a', 8], ['b', 4]]);
  });

  it('flags the groups with fewer samples than the planned plates', () => {
    const groups = plannedTreatmentGroups(samples, ['Cond', 'Site'], DEFAULT_NA_POLICY, 'Type', ['QC']);

    // 12 samples on plates of 4 wells is 3 plates, so only the group of 1 cannot reach every plate.
    const warnings = computeGroupDistributionWarnings(groups, 3);
    expect(Array.from(warnings.byCombination.values()).map(w => w.count)).toEqual([1]);
    expect(computeGroupDistributionWarnings(groups, 1).warningCount).toBe(0);
  });
});

describe('covariateGroupLabel', () => {
  it('joins the display values in covariate order and names a blank value', () => {
    expect(covariateGroupLabel({ Cond: 'a', Site: '', Dose: '10' }, ['Dose', 'Cond', 'Site'])).toBe('10 | a | (blank)');
    expect(covariateGroupLabel({ Cond: '' }, ['Cond'])).toBe('(blank)');
  });
});

describe('plannedCoverageSummary', () => {
  it('names the count and the groups, and suggests fewer covariates when more than one is selected', () => {
    expect(plannedCoverageSummary(1, 3, 2)).toBe(
      'With these covariates, 1 of the 3 covariate groups has fewer samples than the number of plates, ' +
      'so it cannot appear on every plate. Try selecting fewer covariates.'
    );
    expect(plannedCoverageSummary(4, 24, 3)).toBe(
      'With these covariates, 4 of the 24 covariate groups have fewer samples than the number of plates, ' +
      'so they cannot appear on every plate. Try selecting fewer covariates.'
    );
  });

  it('gives no advice when only one covariate is selected', () => {
    expect(plannedCoverageSummary(1, 3, 1)).toBe(
      'With these covariates, 1 of the 3 covariate groups has fewer samples than the number of plates, ' +
      'so it cannot appear on every plate.'
    );
  });
});
