/**
 * Component test for the Plate Details modal covariate decode.
 *
 * The modal must read each covariate value from structured per-sample metadata,
 * not by splitting the covariate key on '|'. A value that itself contains the
 * delimiter must appear intact in its own covariate row, with nothing shifted
 * into an adjacent row and nothing dropped (Requirement 3).
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PlateDetailsModal from '../components/PlateDetailsModal';
import { buildCovariateKey } from '../utils/utils';
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

// A covariate row renders as <div><strong>{cov}:</strong> {value}</div>. The
// value is the div's own text node; the label is its <strong>. Finding the row
// by its value and confirming the label proves the value is under the right
// covariate (so a value cannot shift into an adjacent row or be dropped).
const expectCovariateRow = (label: string, value: string) => {
  const row = screen.getByText(value);
  within(row).getByText(`${label}:`);
};

describe('PlateDetailsModal covariate decode', () => {
  it('shows a covariate value containing the delimiter in its own row, nothing shifted', () => {
    const sample = makeSample('well-sample', { Treatment: 'Drug|Hi', Dose: '10', Site: 'S1' });

    render(
      <PlateDetailsModal
        {...baseProps}
        plateAssignments={new Map([[0, [sample]]])}
        searches={[sample]}
        selectedCovariates={COVS}
      />
    );

    expectCovariateRow('Treatment', 'Drug|Hi');
    expectCovariateRow('Dose', '10');
    expectCovariateRow('Site', 'S1');
  });

  it('shows a QC sample\'s covariate values in their own rows despite the prepended QC key segment', () => {
    const sample: SearchData = {
      name: 'qc-sample',
      metadata: { Treatment: 'Ctrl', Dose: '5', Site: 'S2', Condition: 'BatchQC' },
    };
    // A QC sample's key prepends the QC value, so the key has one more segment
    // than the covariates. Reading metadata directly must ignore that offset;
    // splitting the key would shift every covariate value into the next row.
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
      />
    );

    expectCovariateRow('Treatment', 'Ctrl');
    expectCovariateRow('Dose', '5');
    expectCovariateRow('Site', 'S2');
  });
});
