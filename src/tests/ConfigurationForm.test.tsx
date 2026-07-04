/**
 * Component tests for the "N/A values" checklist in ConfigurationForm.
 *
 * The section appears only when a column mixes two or more N/A-type spellings. It lists the union
 * of spellings (blank shown as "(blank)"), all checked by default, with the literal N/A checkbox
 * checked and disabled. Unchecking a value calls onNaPolicyToggle with that value's token.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigurationForm from '../components/ConfigurationForm';
import { detectNaTypeValues } from '../utils/utils';
import { SearchData, NaPolicy, DEFAULT_NA_POLICY } from '../utils/types';

const mkSample = (dose: string): SearchData => ({ name: 's', metadata: { Dose: dose } });

const noop = () => {};

function renderForm(overrides: {
  samples: SearchData[];
  naPolicy: NaPolicy;
  onNaPolicyToggle?: (token: string) => void;
}) {
  const { samples, naPolicy, onNaPolicyToggle = noop } = overrides;
  const naDetection = detectNaTypeValues(samples, ['Dose']);
  render(
    <ConfigurationForm
      availableColumns={['Sample ID', 'Dose']}
      selectedFileName="data.csv"
      isLayoutFile={false}
      selectedIdColumn="Sample ID"
      onIdColumnChange={noop}
      searches={samples}
      selectedCovariates={[]}
      onCovariateChange={noop}
      qcColumn=""
      onQcColumnChange={noop}
      qcColumnValues={[]}
      selectedQcValues={[]}
      onQcValueToggle={noop}
      naDetection={naDetection}
      naPolicy={naPolicy}
      onNaPolicyToggle={onNaPolicyToggle}
      selectedAlgorithm="balanced"
      onAlgorithmChange={noop}
      keepEmptyInLastPlate={false}
      onKeepEmptyInLastPlateChange={noop}
      plateRows={8}
      plateColumns={12}
      onPlateRowsChange={noop}
      onPlateColumnsChange={noop}
      onResetCovariateState={noop}
      subjectColumn=""
      onSubjectColumnChange={noop}
      groupingConstraint="none"
      onGroupingConstraintChange={noop}
      groupValidation={null}
      subjectGroups={[]}
    />
  );
  return naDetection;
}

describe('ConfigurationForm N/A values checklist', () => {
  it('renders one entry per distinct spelling across the column, with blank labeled (blank)', () => {
    renderForm({
      samples: [mkSample('na'), mkSample('NA'), mkSample('')],
      naPolicy: { foldBlank: true, foldSpellings: ['na', 'NA'] },
    });
    expect(screen.getByText('N/A values:')).toBeInTheDocument();
    expect(screen.getByLabelText('Treat na as N/A')).toBeInTheDocument();
    expect(screen.getByLabelText('Treat NA as N/A')).toBeInTheDocument();
    expect(screen.getByLabelText('Treat (blank) as N/A')).toBeInTheDocument();
  });

  it('checks the literal N/A entry and disables it', () => {
    renderForm({
      samples: [mkSample('na'), mkSample('N/A')],
      naPolicy: { foldBlank: false, foldSpellings: ['na'] },
    });
    const literal = screen.getByLabelText('Treat N/A as N/A') as HTMLInputElement;
    expect(literal.checked).toBe(true);
    expect(literal.disabled).toBe(true);
  });

  it('reflects the policy: a folded spelling is checked, an unfolded one is unchecked', () => {
    renderForm({
      samples: [mkSample('na'), mkSample('NA')],
      naPolicy: { foldBlank: false, foldSpellings: ['na'] },
    });
    expect((screen.getByLabelText('Treat na as N/A') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Treat NA as N/A') as HTMLInputElement).checked).toBe(false);
  });

  it('calls onNaPolicyToggle with the exact spelling when a box is clicked', () => {
    const toggled: string[] = [];
    renderForm({
      samples: [mkSample('na'), mkSample('NA')],
      naPolicy: { foldBlank: false, foldSpellings: ['na', 'NA'] },
      onNaPolicyToggle: t => toggled.push(t),
    });
    fireEvent.click(screen.getByLabelText('Treat NA as N/A'));
    expect(toggled).toEqual(['NA']);
  });

  it('uses the empty-string token when the blank entry is clicked', () => {
    const toggled: string[] = [];
    renderForm({
      samples: [mkSample('na'), mkSample('')],
      naPolicy: { foldBlank: true, foldSpellings: ['na'] },
      onNaPolicyToggle: t => toggled.push(t),
    });
    fireEvent.click(screen.getByLabelText('Treat (blank) as N/A'));
    expect(toggled).toEqual(['']);
  });

  it('does not render the section when no column mixes spellings', () => {
    renderForm({
      samples: [mkSample('na'), mkSample('na'), mkSample('108')],
      naPolicy: DEFAULT_NA_POLICY,
    });
    expect(screen.queryByText('N/A values:')).not.toBeInTheDocument();
  });
});
