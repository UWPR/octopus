/**
 * Component tests for the new-file reset in App. Every successful load of a sample CSV must clear
 * the previous plates and settings, also when the file name and the sample count are unchanged,
 * and also after the same saved layout was loaded twice.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { serializeLayout, LayoutSettings, CovariateColorMap } from '../utils/layoutIO';
import { SearchData } from '../utils/types';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

const REPLACE_DESIGN_MESSAGE = 'This will replace the current plate design and settings. Continue?';

const selectedCovariateCount = () =>
  (screen.getByLabelText('Select Covariates:') as HTMLSelectElement).selectedOptions.length;

const plateDimensionInputs = () =>
  (screen.getAllByRole('spinbutton') as HTMLInputElement[]).map(input => input.value);

// A saved layout of 3 samples on one 2x2 plate, covariate Cond.
function layoutJson(): string {
  const samples: SearchData[] = [
    { name: 'L1', metadata: { Cond: 'a' } },
    { name: 'L2', metadata: { Cond: 'b' } },
    { name: 'L3', metadata: { Cond: 'a' } },
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
    metadataColumns: ['Cond'],
    naPolicy: { foldBlank: false, foldSpellings: [] },
  };
  const colors: CovariateColorMap = {
    a: { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
    b: { color: '#222222', useOutline: false, useStripes: false, textColor: '#fff' },
  };
  return serializeLayout({
    searches: samples,
    randomizedPlates: [[[samples[0], samples[1]], [samples[2], undefined]]],
    settings,
    covariateColors: colors,
  });
}

let confirmSpy: jest.SpyInstance;

beforeEach(() => {
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe('App new-file reset', () => {
  it('clears the plates and covariates when an edited CSV with the same name and row count is chosen', async () => {
    render(<App />);

    await loadFile('Choose File', csvFile('Sample ID,Cond\nX1,a\nX2,b\nX3,a\n', 'data.csv'));
    selectCovariate('Cond (a, b)');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));
    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();

    await loadFile('Choose File', csvFile('Sample ID,Cond\nX1,c\nX2,d\nX3,c\n', 'data.csv'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(REPLACE_DESIGN_MESSAGE);
    expect(screen.getByText('(3 samples)')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cond (c, d)' })).toBeInTheDocument();

    expect(screen.queryByTestId('plate-grid-0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Randomized Plates' })).toBeInTheDocument();
    expect(selectedCovariateCount()).toBe(0);
  });

  it('clears a layout loaded twice when a sample CSV is chosen next', async () => {
    render(<App />);
    const json = layoutJson();

    await loadFile('Load Layout', new File([json], 'lay.json', { type: 'application/json' }));
    expect(screen.getByText('Layout file')).toBeInTheDocument();
    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();
    expect(plateDimensionInputs()).toEqual(['2', '2']);
    expect(confirmSpy).toHaveBeenCalledTimes(0);

    await loadFile('Load Layout', new File([json], 'lay.json', { type: 'application/json' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();
    expect(plateDimensionInputs()).toEqual(['2', '2']);

    await loadFile('Choose File', csvFile('Sample ID,Cond\nN1,x\nN2,y\n', 'new.csv'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText('new.csv')).toBeInTheDocument();
    expect(screen.getByText('(2 samples)')).toBeInTheDocument();

    expect(screen.queryByTestId('plate-grid-0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Randomized Plates' })).toBeInTheDocument();
    expect(plateDimensionInputs()).toEqual(['8', '12']);
  });
});
