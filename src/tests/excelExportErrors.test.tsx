import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import { exportToExcel } from '../utils/excelExport';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

// App uses only exportToExcel, so the mock does not load exceljs.
jest.mock('../utils/excelExport', () => ({ exportToExcel: jest.fn() }));

const mockedExportToExcel = exportToExcel as jest.MockedFunction<typeof exportToExcel>;

const CSV = ['Sample ID,Treatment', 'S1,Drug', 'S2,Drug', 'S3,Placebo', 'S4,Placebo'].join('\n');
const ERROR_MESSAGE = 'Could not create the Excel file. Forced Excel failure';

// Exports the displayed layout to Excel with the preselected columns and waits for the export to settle.
const exportExcel = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export (1 selected)' }));
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
};

// Generates a layout of CSV and exports it to Excel once, with the export failing.
const generateAndFailExport = async () => {
  render(<App />);
  await loadFile('Choose File', csvFile(CSV, 'samples.csv'));
  selectCovariate('Treatment (Drug, Placebo)');
  fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));
  await screen.findByTitle('Re-randomize this plate');

  mockedExportToExcel.mockRejectedValueOnce(new Error('Forced Excel failure'));
  await exportExcel();
};

describe('App Excel export errors', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('displays the error message in an alert when the Excel export fails', async () => {
    await generateAndFailExport();

    expect(mockedExportToExcel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_MESSAGE);
    expect(consoleError).toHaveBeenCalledWith('Excel export failed:', new Error('Forced Excel failure'));
  });

  it('clears the error message when the next Excel export succeeds', async () => {
    await generateAndFailExport();

    mockedExportToExcel.mockResolvedValueOnce(undefined);
    await exportExcel();

    expect(mockedExportToExcel).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(ERROR_MESSAGE)).not.toBeInTheDocument();
  });

  it('clears the error message when the plates are re-randomized', async () => {
    await generateAndFailExport();

    fireEvent.click(screen.getByRole('button', { name: 'Re-randomize' }));

    expect(screen.queryByText(ERROR_MESSAGE)).not.toBeInTheDocument();
  });
});
