/**
 * Component tests for the Plate Details popup's group table.
 *
 * The group label is read from each sample's metadata, not by splitting the covariate key on
 * '|', so a value that itself contains the delimiter appears intact. The "Penalty" column is the
 * points each group takes off the plate's balance score, so the column sums to 100 minus the
 * plate score.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PlateDetailsModal from '../components/PlateDetailsModal';
import { buildCovariateKey } from '../utils/utils';
import { calculatePlateDiversityMetrics } from '../utils/qualityMetrics';
import { SearchData } from '../utils/types';

const COVS = ['Treatment', 'Dose', 'Site'];

const makeSample = (name: string, metadata: { [k: string]: string }): SearchData => {
  const sample: SearchData = { name, metadata };
  sample.covariateKey = buildCovariateKey(sample, { selectedCovariates: COVS });
  return sample;
};

const baseProps = {
  show: true,
  plateIndex: 0,
  plateRows: 8,
  plateColumns: 12,
  covariateColors: {},
  selectedCombination: null,
  modalPosition: { x: 0, y: 0 },
  isDraggingModal: false,
  onClose: () => {},
  onMouseDown: () => {},
};

// The text of every cell of the table's body rows
const bodyRows = (): string[][] =>
  within(screen.getByTestId('plate-group-table'))
    .getAllByTestId('plate-group-row')
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''));

describe('PlateDetailsModal group label', () => {
  it('shows a covariate value containing the delimiter intact in the joined label', () => {
    const sample = makeSample('well-sample', { Treatment: 'Drug|Hi', Dose: '10', Site: 'S1' });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
      />
    );

    expect(screen.getByRole('columnheader', { name: 'Group (Treatment | Dose | Site)' })).toBeInTheDocument();
    expect(bodyRows()).toEqual([['Drug|Hi | 10 | S1', '1', '1']]);
  });

  it('names a QC group with its QC value in front of the covariate values', () => {
    const sample: SearchData = {
      name: 'qc-sample',
      metadata: { Treatment: 'Ctrl', Dose: '5', Site: 'S2', Condition: 'BatchQC' },
    };
    sample.covariateKey = buildCovariateKey(sample, {
      selectedCovariates: COVS,
      qcColumn: 'Condition',
      selectedQcValues: ['BatchQC'],
    });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
        qcColumn="Condition"
        selectedQcValues={['BatchQC']}
      />
    );

    expect(bodyRows()).toEqual([['BatchQC | Ctrl | 5 | S2', '1', '1']]);
  });

  it('names a QC group with its QC value in front when a covariate has the same value', () => {
    const sample: SearchData = {
      name: 'qc-sample',
      metadata: { Treatment: 'Ctrl', Dose: '1', Site: 'S2', IsQC: '1' },
    };
    sample.covariateKey = buildCovariateKey(sample, {
      selectedCovariates: COVS,
      qcColumn: 'IsQC',
      selectedQcValues: ['1'],
    });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
        qcColumn="IsQC"
        selectedQcValues={['1']}
      />
    );

    expect(bodyRows()).toEqual([['1 | Ctrl | 1 | S2', '1', '1']]);
  });

  it('does not put the QC value in front when the QC column is a selected covariate', () => {
    const naPolicy = { foldBlank: false, foldSpellings: ['na'] };
    const sample: SearchData = { name: 'qc-sample', metadata: { Treatment: 'Ctrl', Dose: 'na', Site: 'S2' } };
    sample.covariateKey = buildCovariateKey(sample, {
      selectedCovariates: COVS,
      qcColumn: 'Dose',
      selectedQcValues: ['na'],
      naPolicy,
    });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
        qcColumn="Dose"
        selectedQcValues={['na']}
        naPolicy={naPolicy}
      />
    );

    expect(bodyRows()).toEqual([['Ctrl | N/A | S2', '1', '1']]);
  });

  it('renders a folded spelling as N/A when the policy folds it', () => {
    const naPolicy = { foldBlank: false, foldSpellings: ['na'] };
    const sample: SearchData = { name: 'na-sample', metadata: { Treatment: 'Ctrl', Dose: 'na', Site: 'S1' } };
    sample.covariateKey = buildCovariateKey(sample, { selectedCovariates: COVS, naPolicy });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
        naPolicy={naPolicy}
      />
    );

    expect(bodyRows()).toEqual([['Ctrl | N/A | S1', '1', '1']]);
  });

  it('renders a missing value as (blank), not N/A, under the default policy', () => {
    const sample = makeSample('blank-sample', { Treatment: 'Ctrl', Dose: '', Site: 'S1' });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
      />
    );

    expect(bodyRows()).toEqual([['Ctrl | (blank) | S1', '1', '1']]);
  });
});

describe('PlateDetailsModal penalty', () => {
  const COV = ['Treatment'];
  const sampleOf = (name: string, treatment: string): SearchData => {
    const sample: SearchData = { name, metadata: { Treatment: treatment } };
    sample.covariateKey = buildCovariateKey(sample, { selectedCovariates: COV });
    return sample;
  };
  // Ten samples, A 6, B 3, C 1. Plate 1 holds A 3 and B 2, plate 2 holds A 3, B 1, and C 1.
  const plate1 = [sampleOf('a1', 'A'), sampleOf('a2', 'A'), sampleOf('a3', 'A'), sampleOf('b1', 'B'), sampleOf('b2', 'B')];
  const plate2 = [sampleOf('a4', 'A'), sampleOf('a5', 'A'), sampleOf('a6', 'A'), sampleOf('b3', 'B'), sampleOf('c1', 'C')];
  const searches = [...plate1, ...plate2];
  const plateAssignments = new Map([[0, plate1], [1, plate2]]);
  const plates = [plate1, plate2].map((samples) => [samples]);
  const metrics = calculatePlateDiversityMetrics(searches, plateAssignments, plates, COV);

  it('lists each group with its expected count, score, and penalty, absent groups included', () => {
    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={plateAssignments}
        searches={searches}
        selectedCovariates={COV}
        plateQuality={metrics.plateScores[0]}
        numPlates={2}
      />
    );

    // On plate 1, A is at its expected 3.0, B is 2 against 1.5, and C is 0 against 0.5
    expect(bodyRows()).toEqual([
      ['A', '6', '3', '3.0', '0.0', '100 '],
      ['B', '3', '2', '1.5', '10.0', '67 '],
      ['C', '1', '0', '0.5', '10.0', '0 '],
    ]);
  });

  it('sums the penalty column to 100 minus the plate balance score', () => {
    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={plateAssignments}
        searches={searches}
        selectedCovariates={COV}
        plateQuality={metrics.plateScores[0]}
        numPlates={2}
      />
    );

    const penalties = bodyRows().map((cells) => Number(cells[4]));
    const total = within(screen.getByTestId('plate-group-total')).getAllByRole('cell')[1].textContent;
    expect(penalties).toEqual([0, 10, 10]);
    expect(total).toBe('20.0');
    expect(metrics.plateScores[0].balanceScore).toBe(80);
    expect(screen.getByText('Plate balance = 100 - Total penalty, rounded and at least 0')).toBeInTheDocument();
    expect(screen.getByText('Plate samples:')).toBeInTheDocument();
    expect(screen.getByText('Penalty = |On plate - Expected| / Plate samples \u00d7 100')).toBeInTheDocument();
    expect(screen.getByText('Group score = 100 - |On plate - Expected| / Expected \u00d7 100, at least 0')).toBeInTheDocument();
  });

  it('shows only the count columns for a single plate', () => {
    const single = new Map([[0, searches]]);
    const singleMetrics = calculatePlateDiversityMetrics(searches, single, [[searches]], COV);

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={single}
        searches={searches}
        selectedCovariates={COV}
        plateQuality={singleMetrics.plateScores[0]}
        numPlates={1}
      />
    );

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Group (Treatment)', 'Total samples', 'On plate']);
    expect(bodyRows()).toEqual([['A', '6', '6'], ['B', '3', '3'], ['C', '1', '1']]);
    expect(screen.queryByTestId('plate-group-total')).not.toBeInTheDocument();
  });

  it('shows only the count columns for a plate whose samples were all dragged to another plate', () => {
    const emptied = new Map([[0, searches], [1, [] as SearchData[]]]);
    const emptiedMetrics = calculatePlateDiversityMetrics(searches, emptied, [[searches], [[]]], COV);

    render(
      <PlateDetailsModal
        {...baseProps}
        plateIndex={1}
        plateAssignments={emptied}
        searches={searches}
        selectedCovariates={COV}
        plateQuality={emptiedMetrics.plateScores.find((score) => score.plateIndex === 1)}
        numPlates={2}
      />
    );

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Group (Treatment)', 'Total samples', 'On plate']);
    expect(bodyRows()).toEqual([['A', '6', '0'], ['B', '3', '0'], ['C', '1', '0']]);
    expect(screen.queryByTestId('plate-group-total')).not.toBeInTheDocument();
    expect(screen.queryByText('Plate balance = 100 - Total penalty, rounded and at least 0')).not.toBeInTheDocument();
  });

  it('shows a group absent from the plate in a gray with at least 4.5:1 contrast on white', () => {
    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={plateAssignments}
        searches={searches}
        selectedCovariates={COV}
        plateQuality={metrics.plateScores[0]}
        numPlates={2}
      />
    );

    // C has no samples on plate 1. #666 is 5.7:1 on white.
    const rowC = screen.getAllByTestId('plate-group-row')[2];
    within(rowC).getAllByRole('cell').forEach((cell) => expect(cell).toHaveStyle({ color: '#666' }));
  });
});
