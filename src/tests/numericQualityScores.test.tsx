/**
 * Component tests for how App displays quality scores. A score is its number with a swatch in the
 * color of its band, with no rating word (such as Excellent) and no letter badge.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from '../App';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

const RATING_WORDS = /Excellent|Good|Fair|Poor|Bad/;

// 8 samples in two groups on 2x2 plates, so the layout uses 2 plates and shows balance scores.
const CSV = ['Sample ID,Cond', ...Array.from({ length: 8 }, (_, i) => `S${i},${i % 2 === 0 ? 'a' : 'b'}`)].join('\n');

async function generateTwoPlates() {
  render(<App />);
  await loadFile('Choose File', csvFile(CSV, 'data.csv'));
  const [rows, columns] = screen.getAllByRole('spinbutton');
  fireEvent.change(rows, { target: { value: '2' } });
  fireEvent.change(columns, { target: { value: '2' } });
  selectCovariate('Cond (a, b)');
  fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));
  expect(screen.getByTestId('plate-grid-1')).toBeInTheDocument();
}

describe('App quality score display', () => {
  it('shows the overall score on the Quality button as a number and a swatch', async () => {
    await generateTwoPlates();

    const button = screen.getByRole('button', { name: /^Quality/ });
    expect(button.textContent).toMatch(/^Quality\d+(\.\d+)?$/);
    expect(within(button).getAllByTestId('quality-swatch')).toHaveLength(1);
  });

  it('shows plate scores without letter badges', async () => {
    await generateTwoPlates();

    [0, 1].forEach(plate => {
      const row = screen.getByTestId(`plate-quality-${plate}`);
      expect(row.textContent).toMatch(/^Quality:\s*Bal: [\d.]+\s*Clust: [\d.]+$/);
      expect(within(row).getAllByTestId('quality-swatch')).toHaveLength(2);
    });
  });

  it('shows the legend as swatches and ranges, and no rating words anywhere', async () => {
    await generateTwoPlates();

    const legend = screen.getByTestId('quality-legend');
    expect(legend.textContent).toBe('Quality Scores:90-10080-8970-7960-690-59');
    expect(within(legend).getAllByTestId('quality-swatch')).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: /^Quality/ }));
    fireEvent.click(screen.getAllByTitle('Show plate details')[0]);
    expect(document.body.textContent).not.toMatch(RATING_WORDS);
  });
});
