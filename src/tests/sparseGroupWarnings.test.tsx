/**
 * Component tests for the sparse group warnings in App. A treatment group with fewer samples than
 * plates cannot appear on every plate. App warns before Generate, and after Generate shows the
 * group distribution warnings above the plates without opening the Covariate Summary.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from '../App';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

// 8 samples on 2x2 plates is 2 plates. The group b|y has 1 sample, so it cannot reach both plates.
const CSV = [
  'Sample ID,Cond,Site',
  'S0,a,x', 'S1,a,x', 'S2,a,x', 'S3,a,x',
  'S4,b,x', 'S5,b,x', 'S6,b,x',
  'S7,b,y',
].join('\n');

async function loadAndSelectSparseCovariates() {
  render(<App />);
  await loadFile('Choose File', csvFile(CSV, 'data.csv'));
  const [rows, columns] = screen.getAllByRole('spinbutton');
  fireEvent.change(rows, { target: { value: '2' } });
  fireEvent.change(columns, { target: { value: '2' } });
  selectCovariate('Cond (a, b)');
  selectCovariate('Site (x, y)');
}

describe('App sparse group warnings', () => {
  it('warns before Generate when a treatment group has fewer samples than plates', async () => {
    await loadAndSelectSparseCovariates();

    // The leading ! is the banner icon, hidden from screen readers
    expect(screen.getByTestId('planned-coverage-banner').textContent).toBe(
      '!With these covariates, 1 of the 3 treatment groups has fewer samples than the 2 plates, ' +
      'so it cannot appear on every plate. Selecting fewer covariates makes larger groups.' +
      'Smallest groups: b | y (1 sample)'
    );
    expect(screen.getByRole('button', { name: 'Generate Randomized Plates' })).toBeEnabled();
  });

  it('does not warn before Generate when every group can reach every plate', async () => {
    await loadAndSelectSparseCovariates();
    // Cond alone gives groups of 4 and 4, which both reach the 2 plates
    (screen.getByRole('option', { name: 'Site (x, y)' }) as HTMLOptionElement).selected = false;
    fireEvent.change(screen.getByLabelText('Select Covariates:'));

    expect(screen.queryByTestId('planned-coverage-banner')).not.toBeInTheDocument();
  });

  it('shows the warnings above the plates after Generate, with a button that opens the summary', async () => {
    await loadAndSelectSparseCovariates();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));

    expect(screen.queryByTestId('planned-coverage-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('distribution-warning-banner')).not.toBeInTheDocument();
    const banner = screen.getByTestId('layout-warning-banner');
    expect(banner).toHaveAttribute('data-severity', 'error');
    // Checked line by line, since a balance line can follow, depending on the random placement
    expect(within(banner).getByText(
      '1 of the treatment covariate groups is not represented on every plate. ' +
      'Ideally, each plate should have at least one sample from every treatment covariate group.'
    )).toBeInTheDocument();
    expect(within(banner).getByText('Smallest groups: b | y (1 sample)')).toBeInTheDocument();

    // The summary shows the same warnings, so the banner above the plates hides while it is open
    fireEvent.click(screen.getByRole('button', { name: 'Show affected groups' }));
    expect(screen.getByTestId('distribution-warning-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-warning-banner')).not.toBeInTheDocument();
  });

  it('renders the warning live region before the warning appears', async () => {
    render(<App />);
    await loadFile('Choose File', csvFile(CSV, 'data.csv'));
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0].textContent).toBe('');

    const [rows, columns] = screen.getAllByRole('spinbutton');
    fireEvent.change(rows, { target: { value: '2' } });
    fireEvent.change(columns, { target: { value: '2' } });
    selectCovariate('Cond (a, b)');
    selectCovariate('Site (x, y)');

    expect(screen.getAllByRole('status')[0]).toBe(regions[0]);
    expect(within(regions[0]).getByTestId('planned-coverage-banner')).toBeInTheDocument();
  });
});
