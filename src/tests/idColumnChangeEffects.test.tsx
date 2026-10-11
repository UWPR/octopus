/**
 * Component tests for what an ID column change does beyond clearing conflicting selections, and
 * for the settings that stay usable on a loaded layout.
 * - The N/A values checklist is set as a file load with the new ID column would set it.
 * - A loaded layout keeps its ID column, since it has no CSV rows to rebuild the samples from.
 *   Covariates and the QC column can still be changed on it.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { SearchData } from '../utils/types';
import { loadFile, csvFile, selectCovariate, changeSelect, layoutFile } from './appFileInput';

const idSelect = () => screen.getByLabelText('Select ID Column:') as HTMLSelectElement;

const naCheckbox = (label: string) => screen.getByLabelText(`Treat ${label} as N/A`) as HTMLInputElement;

const LAYOUT_ID_NOTE = 'Saved layouts keep their ID column.';

// 4 samples for a 2x2 layout, covariate Cond, with a Type column for QC.
const typedSamples: SearchData[] = [
  { name: 'L1', metadata: { Cond: 'a', Type: 'Sample' } },
  { name: 'L2', metadata: { Cond: 'b', Type: 'Sample' } },
  { name: 'L3', metadata: { Cond: 'a', Type: 'Pool' } },
  { name: 'L4', metadata: { Cond: 'b', Type: 'Sample' } },
];

const loadLayout = () => loadFile('Load Layout', layoutFile(typedSamples, ['Cond', 'Type']));

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

  it('keeps the N/A policy a layout restores when the layout is loaded after an ID column change', async () => {
    render(<App />);
    await loadFile('Choose File', csvFile('ID,Alt,Code\nS1,A1,NA\nS2,A2,\nS3,A3,X\n', 'data.csv'));
    changeSelect('Select ID Column:', 'Alt');
    expect(naCheckbox('NA').checked).toBe(true);

    // The layout's Note column mixes two N/A spellings, and the layout saved them unfolded.
    const notedSamples: SearchData[] = [
      { name: 'L1', metadata: { Cond: 'a', Note: 'NA' } },
      { name: 'L2', metadata: { Cond: 'b', Note: '' } },
      { name: 'L3', metadata: { Cond: 'a', Note: 'x' } },
    ];
    await loadFile('Load Layout', layoutFile(notedSamples, ['Cond', 'Note']));

    expect(screen.getByText('Layout file')).toBeInTheDocument();
    expect(naCheckbox('NA').checked).toBe(false);
    expect(naCheckbox('(blank)').checked).toBe(false);
  });
});

describe('App ID column select with a loaded layout', () => {
  it('is disabled with a visible note after a layout load, and enabled after a sample CSV load', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<App />);
      await loadLayout();
      expect(screen.getByText('Layout file')).toBeInTheDocument();
      expect(idSelect().disabled).toBe(true);
      expect(screen.getByText(LAYOUT_ID_NOTE)).toBeInTheDocument();
      expect(idSelect()).toHaveAccessibleDescription(LAYOUT_ID_NOTE);

      await loadFile('Choose File', csvFile('Sample ID,Cond\nN1,x\nN2,y\n', 'new.csv'));
      expect(screen.getByText('new.csv')).toBeInTheDocument();
      expect(idSelect().disabled).toBe(false);
      expect(screen.queryByText(LAYOUT_ID_NOTE)).not.toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('keeps the ID column when a change event reaches the select of a loaded layout', async () => {
    render(<App />);
    await loadLayout();

    // A disabled select does not take user input, but a change event can still reach its handler.
    changeSelect('Select ID Column:', 'Cond');

    expect(idSelect().value).toBe('Sample ID');
    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();
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
