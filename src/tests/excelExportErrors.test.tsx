import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { exportToExcel } from '../utils/excelExport';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

jest.mock('../utils/excelExport', () => {
  const actual = jest.requireActual('../utils/excelExport');
  return { ...actual, exportToExcel: jest.fn() };
});

const mockedExportToExcel = exportToExcel as jest.MockedFunction<typeof exportToExcel>;

const CSV = ['Sample ID,Treatment', 'S1,Drug', 'S2,Drug', 'S3,Placebo', 'S4,Placebo'].join('\n');

// Generates a layout of CSV and exports it to Excel with the preselected columns.
const generateAndExportExcel = async () => {
  render(<App />);
  await loadFile('Choose File', csvFile(CSV, 'samples.csv'));
  selectCovariate('Treatment (Drug, Placebo)');
  fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));
  await screen.findByTitle('Re-randomize this plate');

  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export (1 selected)' }));
};

describe('App Excel export errors', () => {
  it('displays the error message when the Excel export fails', async () => {
    mockedExportToExcel.mockRejectedValueOnce(new Error('Forced Excel failure'));

    await generateAndExportExcel();

    expect(mockedExportToExcel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Could not create the Excel file. Forced Excel failure'))
      .toBeInTheDocument();
  });

  it('clears the error message when the next Excel export succeeds', async () => {
    mockedExportToExcel.mockRejectedValueOnce(new Error('Forced Excel failure'));
    await generateAndExportExcel();
    await screen.findByText('Could not create the Excel file. Forced Excel failure');

    mockedExportToExcel.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export (1 selected)' }));

    expect(mockedExportToExcel).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Could not create the Excel file. Forced Excel failure')).not.toBeInTheDocument();
  });
});
