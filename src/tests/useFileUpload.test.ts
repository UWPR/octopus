/**
 * Tests for useFileUpload. A header cell with surrounding whitespace must give one column name,
 * the trimmed one, in availableColumns and in every sample's metadata keys.
 */

import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';
import { buildCovariateKey } from '../utils/utils';

describe('useFileUpload header whitespace', () => {
  it('trims a header with a leading space so the column works as a covariate', () => {
    const { result } = renderHook(() => useFileUpload());

    let outcome: ReturnType<typeof result.current.loadSampleCsvText> | undefined;
    act(() => {
      outcome = result.current.loadSampleCsvText('Sample ID, Condition\nS1,A\nS2,B\n', 'spaced.csv');
    });
    expect(outcome).toEqual({ ok: true, warning: undefined });

    const { availableColumns, selectedIdColumn, searches } = result.current;
    expect(availableColumns).toEqual(['Sample ID', 'Condition']);
    expect(selectedIdColumn).toBe('Sample ID');
    expect(searches).toEqual([
      { name: 'S1', metadata: { Condition: 'A' } },
      { name: 'S2', metadata: { Condition: 'B' } },
    ]);

    // Select the column by the name the selects offer, as the covariate select does.
    const covariate = availableColumns[1];
    const keys = searches.map(s =>
      buildCovariateKey(s, { selectedCovariates: [covariate], qcColumn: '', selectedQcValues: [] })
    );
    expect(keys).toEqual(['A', 'B']);
  });
});
