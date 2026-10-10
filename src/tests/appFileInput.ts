import { screen, fireEvent, act } from '@testing-library/react';

/**
 * Drive one of App's file inputs with an in-memory file and wait until App has handled the file
 * text. The read is asynchronous, so this waits for the reader's loadend event, which fires after
 * App's onload handler. Waiting inside act also runs the effects of that state update.
 */
export async function loadFile(inputLabel: 'Choose File' | 'Load Layout', file: File): Promise<void> {
  const readSpy = jest.spyOn(FileReader.prototype, 'readAsText');
  fireEvent.change(screen.getByLabelText(inputLabel), { target: { files: [file] } });
  expect(readSpy).toHaveBeenCalledTimes(1);
  const reader = readSpy.mock.instances[0] as unknown as FileReader;
  readSpy.mockRestore();
  await act(() => new Promise<void>(resolve => reader.addEventListener('loadend', () => resolve())));
}

export const csvFile = (text: string, name: string) => new File([text], name, { type: 'text/csv' });

/** Select one option of the covariate multi-select by its displayed text. */
export function selectCovariate(optionName: string) {
  (screen.getByRole('option', { name: optionName }) as HTMLOptionElement).selected = true;
  fireEvent.change(screen.getByLabelText('Select Covariates:'));
}
