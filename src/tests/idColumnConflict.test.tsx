/**
 * Component tests for changing the ID column in App. The ID column cannot also be a covariate,
 * the QC column or the subject column, so choosing a column already used in one of those roles
 * must clear that selection.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { loadFile, csvFile, selectCovariate, changeSelect } from './appFileInput';

const selectedCovariateCount = () =>
  (screen.getByLabelText('Select Covariates:') as HTMLSelectElement).selectedOptions.length;

describe('App ID column change', () => {
  it('clears the covariate and QC selections that use the new ID column', async () => {
    render(<App />);
    await loadFile('Choose File', csvFile('ID,Cond,Other\nS1,p,x\nS2,q,y\nS3,r,x\n', 'data.csv'));

    changeSelect('QC/Reference Column (optional):', 'Cond');
    fireEvent.click(screen.getByRole('checkbox', { name: 'p' }));
    selectCovariate('Cond (p, q, r)');
    expect(screen.getByText('Selected:')).toBeInTheDocument();

    changeSelect('Select ID Column:', 'Cond');
    expect(screen.queryByText('Selected:')).not.toBeInTheDocument();

    // Choosing the original ID column again makes Cond selectable, so a stale selection would show.
    changeSelect('Select ID Column:', 'ID');
    expect(selectedCovariateCount()).toBe(0);
    expect((screen.getByLabelText('QC/Reference Column (optional):') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('checkbox', { name: 'p' })).not.toBeInTheDocument();
  });

  it('clears the subject column and grouping constraint when the subject column becomes the ID column', async () => {
    render(<App />);
    await loadFile('Choose File', csvFile('ID,Cond,Subj\nS1,p,A\nS2,q,A\nS3,p,B\n', 'data.csv'));

    selectCovariate('Cond (p, q)');
    changeSelect('Subject ID Column (optional):', 'Subj');
    expect(screen.getByText('Grouping Constraint:')).toBeInTheDocument();

    changeSelect('Select ID Column:', 'Subj');
    expect(screen.queryByText('Grouping Constraint:')).not.toBeInTheDocument();

    changeSelect('Select ID Column:', 'ID');
    expect((screen.getByLabelText('Subject ID Column (optional):') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('Grouping Constraint:')).not.toBeInTheDocument();
  });
});
