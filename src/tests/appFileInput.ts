import { screen, fireEvent, act } from '@testing-library/react';
import { serializeLayout, LayoutSettings, CovariateColorMap } from '../utils/layoutIO';
import { SearchData } from '../utils/types';

/**
 * Drive one of App's file inputs with an in-memory file and wait until App has handled the file
 * text. The read is asynchronous, so this waits for the reader's loadend event, which fires after
 * App's onload handler. Waiting inside act also runs the effects of that state update.
 */
export async function loadFile(inputLabel: 'Choose File' | 'Load Layout', file: File): Promise<void> {
  const readSpy = jest.spyOn(FileReader.prototype, 'readAsText');
  let reader: FileReader;
  try {
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { files: [file] } });
    expect(readSpy).toHaveBeenCalledTimes(1);
    reader = readSpy.mock.instances[0] as unknown as FileReader;
  } finally {
    readSpy.mockRestore();
  }
  await act(() => new Promise<void>(resolve => reader.addEventListener('loadend', () => resolve())));
}

export const csvFile = (text: string, name: string) => new File([text], name, { type: 'text/csv' });

/** Select one option of the covariate multi-select by its displayed text. */
export function selectCovariate(optionName: string) {
  (screen.getByRole('option', { name: optionName }) as HTMLOptionElement).selected = true;
  fireEvent.change(screen.getByLabelText('Select Covariates:'));
}

/** Choose a value in a single-value select found by its label. */
export const changeSelect = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/**
 * A saved layout file of up to 4 samples on one 2x2 plate, filled row by row with empty wells at
 * the end. The covariate is Cond with the values a and b, which the stored colors cover.
 * `naPolicy` overrides the saved N/A policy.
 */
export function layoutFile(
  samples: SearchData[],
  metadataColumns: string[],
  settings: Pick<Partial<LayoutSettings>, 'naPolicy'> = {}
): File {
  if (samples.length > 4) throw new Error(`layoutFile fits 4 samples on its 2x2 plate, got ${samples.length}`);
  const fullSettings: LayoutSettings = {
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
    metadataColumns,
    naPolicy: { foldBlank: false, foldSpellings: [] },
    ...settings,
  };
  const colors: CovariateColorMap = {
    a: { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
    b: { color: '#222222', useOutline: false, useStripes: false, textColor: '#fff' },
  };
  const well = (i: number) => samples[i];
  const json = serializeLayout({
    searches: samples,
    randomizedPlates: [[[well(0), well(1)], [well(2), well(3)]]],
    settings: fullSettings,
    covariateColors: colors,
  });
  return new File([json], 'lay.json', { type: 'application/json' });
}
