/**
 * Component tests for what an ID column change does beyond clearing conflicting selections. The
 * N/A values checklist is set as a file load with the new ID column would set it, and a loaded
 * layout keeps its ID column, since it has no CSV rows to rebuild the samples from.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { serializeLayout, LayoutSettings, CovariateColorMap } from '../utils/layoutIO';
import { SearchData } from '../utils/types';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

const changeSelect = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const idSelect = () => screen.getByLabelText('Select ID Column:') as HTMLSelectElement;

const naCheckbox = (label: string) => screen.getByLabelText(`Treat ${label} as N/A`) as HTMLInputElement;

// A saved layout of 4 samples on one 2x2 plate, covariate Cond, with a Type column for QC.
function layoutJson(): string {
  const samples: SearchData[] = [
    { name: 'L1', metadata: { Cond: 'a', Type: 'Sample' } },
    { name: 'L2', metadata: { Cond: 'b', Type: 'Sample' } },
    { name: 'L3', metadata: { Cond: 'a', Type: 'Pool' } },
    { name: 'L4', metadata: { Cond: 'b', Type: 'Sample' } },
  ];
  const settings: LayoutSettings = {
    selectedIdColumn: 'Sample ID',
    selectedCovariates: ['Cond'],
    qcColumn: '',
    selectedQcValues: [],
    selectedAlgorithm: 'balanced',
    keepEmptyInLastPlate: false,
    plateRows: 2,
    plateColumns: 2,
    subjectColumn: '',
    groupingConstraint: 'none',
    metadataColumns: ['Cond', 'Type'],
    naPolicy: { foldBlank: false, foldSpellings: [] },
  };
  const colors: CovariateColorMap = {
    a: { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
    b: { color: '#222222', useOutline: false, useStripes: false, textColor: '#fff' },
  };
  return serializeLayout({
    searches: samples,
    randomizedPlates: [[[samples[0], samples[1]], [samples[2], samples[3]]]],
    settings,
    covariateColors: colors,
  });
}

const loadLayout = () => loadFile('Load Layout', new File([layoutJson()], 'lay.json', { type: 'application/json' }));

describe('App ID column change and the N/A values checklist', () => {
  it('checks the N/A spellings of a column that stops being the ID column', async () => {
    render(<App />);
    // Code is the first column, so it is the default ID column and its N/A spellings are not scanned.
    await loadFile('Choose File', csvFile('Code,Name,Dose\nNA,S1,1\n,S2,2\nX,S3,3\n', 'data.csv'));
    expect(screen.queryByText('N/A values:')).not.toBeInTheDocument();

    changeSelect('Select ID Column:', 'Name');

    // A file load with Name as the ID column folds both spellings of the Code column.
    expect(naCheckbox('NA').checked).toBe(true);
    expect(naCheckbox('(blank)').checked).toBe(true);
  });

  it('sets the checklist as a file load would, replacing a manual change', async () => {
    render(<App />);
    await loadFile('Choose File', csvFile('ID,Alt,Code\nS1,A1,NA\nS2,A2,\nS3,A3,X\n', 'data.csv'));
    expect(naCheckbox('NA').checked).toBe(true);
    fireEvent.click(naCheckbox('NA'));
    expect(naCheckbox('NA').checked).toBe(false);

    changeSelect('Select ID Column:', 'Alt');

    expect(naCheckbox('NA').checked).toBe(true);
    expect(naCheckbox('(blank)').checked).toBe(true);
  });
});

describe('App ID column select with a loaded layout', () => {
  it('is disabled after a layout load and enabled after a sample CSV load', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<App />);
      await loadLayout();
      expect(screen.getByText('Layout file')).toBeInTheDocument();
      expect(idSelect().disabled).toBe(true);

      await loadFile('Choose File', csvFile('Sample ID,Cond\nN1,x\nN2,y\n', 'new.csv'));
      expect(screen.getByText('new.csv')).toBeInTheDocument();
      expect(idSelect().disabled).toBe(false);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('generates plates after a covariate change on a loaded layout', async () => {
    render(<App />);
    await loadLayout();

    selectCovariate('Type (Pool, Sample)');
    expect(screen.queryByTestId('plate-grid-0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));

    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();
  });

  it('lists the values of a QC column chosen on a loaded layout', async () => {
    render(<App />);
    await loadLayout();

    changeSelect('QC/Reference Column (optional):', 'Type');

    expect(screen.getByRole('checkbox', { name: 'Pool' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sample' })).toBeInTheDocument();
  });
});
