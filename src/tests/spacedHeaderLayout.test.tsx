/**
 * Component test for a CSV header with a space after the comma. The saved layout must record the
 * trimmed column name and each sample's value under it, not a blank value.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { loadFile, csvFile, selectCovariate } from './appFileInput';

// Read a Blob through FileReader, since the jsdom Blob has no text().
const readBlob = (blob: Blob) =>
  new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe('App save layout with a spaced CSV header', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let savedBlobs: Blob[];
  let anchorClickSpy: jest.SpyInstance;

  beforeEach(() => {
    savedBlobs = [];
    // jsdom has no object URLs. Capture the Blob that Save Layout downloads.
    URL.createObjectURL = jest.fn((blob: Blob) => {
      savedBlobs.push(blob);
      return 'blob:saved-layout';
    });
    URL.revokeObjectURL = jest.fn();
    // jsdom does not implement the navigation that clicking the download link starts.
    anchorClickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    anchorClickSpy.mockRestore();
  });

  it('records the Condition value of each sample under the trimmed column name', async () => {
    render(<App />);

    await loadFile('Choose File', csvFile('Sample ID, Condition\nS1,A\nS2,B\n', 'spaced.csv'));
    selectCovariate('Condition (A, B)');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Randomized Plates' }));
    expect(screen.getByTestId('plate-grid-0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout' }));
    expect(savedBlobs.length).toBe(1);

    const doc = JSON.parse(await readBlob(savedBlobs[0]));
    expect(doc.settings.metadataColumns).toEqual(['Condition']);
    expect(doc.settings.covariates).toEqual(['Condition']);
    const metadataById = Object.fromEntries(
      doc.samples.map((s: { id: string; metadata: Record<string, string> }) => [s.id, s.metadata])
    );
    expect(metadataById).toEqual({ S1: { Condition: 'A' }, S2: { Condition: 'B' } });
  });
});
