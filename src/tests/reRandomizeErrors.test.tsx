import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import App from '../App';
import { groupAwareRandomization } from '../algorithms/repeatedMeasuresDistribution';

jest.mock('../algorithms/repeatedMeasuresDistribution', () => {
  const actual = jest.requireActual('../algorithms/repeatedMeasuresDistribution');
  return { ...actual, groupAwareRandomization: jest.fn() };
});

const mockedGroupAware = groupAwareRandomization as jest.MockedFunction<typeof groupAwareRandomization>;
const { groupAwareRandomization: realGroupAware } = jest.requireActual('../algorithms/repeatedMeasuresDistribution');

// 4 subjects x 4 samples, one 8x12 plate.
const CSV = ['Sample ID,Subject,Treatment']
  .concat(
    ['A', 'B', 'C', 'D'].flatMap((subject, s) =>
      [0, 1, 2, 3].map(t => `${subject}${t},${subject},${s % 2 === 0 ? 'Drug' : 'Placebo'}`)
    )
  )
  .join('\n');

// Well tooltips of the first plate in grid order. Only occupied wells carry a title.
const plateFingerprint = (): string =>
  within(screen.getByTestId('plate-grid-0'))
    .getAllByTitle(/./)
    .map(el => el.getAttribute('title'))
    .join('|');

beforeEach(() => {
  // CRA resets mock implementations before each test, so the pass-through is set here.
  mockedGroupAware.mockImplementation(realGroupAware);
});

describe('App per-plate re-randomize', () => {
  it('displays the algorithm error and keeps the plate when single-plate re-randomize throws', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Choose File'), { target: { files: [new File([CSV], 'subjects.csv', { type: 'text/csv' })] } });
    await screen.findByText('(16 samples)');
    // The file is read outside act, so the new-file reset effect is still pending here. Let it run
    // first, or it clears the selections made below.
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));

    (screen.getByRole('option', { name: 'Treatment (Drug, Placebo)' }) as HTMLOptionElement).selected = true;
    fireEvent.change(screen.getByLabelText('Select Covariates:'));
    fireEvent.change(screen.getByLabelText('Subject ID Column (optional):'), { target: { value: 'Subject' } });
    await screen.findByText('Grouping Constraint:');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));

    const reRandomizeButton = await screen.findByTitle('Re-randomize this plate');
    const before = plateFingerprint();
    expect(before.split('|').length).toBe(16);

    mockedGroupAware.mockImplementationOnce(() => {
      throw new Error('Forced re-randomize failure');
    });
    fireEvent.click(reRandomizeButton);
    expect(mockedGroupAware).toHaveBeenCalledTimes(2);

    expect(await screen.findByText('Forced re-randomize failure')).toBeInTheDocument();
    expect(plateFingerprint()).toBe(before);
  });
});
