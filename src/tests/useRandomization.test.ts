import { renderHook, act } from '@testing-library/react';
import { useRandomization, MAX_PACKING_RETRIES } from '../hooks/useRandomization';
import { groupAwareRandomization, PackingError } from '../algorithms/repeatedMeasuresDistribution';
import { SearchData, RepeatedMeasuresConfig } from '../utils/types';

jest.mock('../algorithms/repeatedMeasuresDistribution', () => {
  const actual = jest.requireActual('../algorithms/repeatedMeasuresDistribution');
  return { ...actual, groupAwareRandomization: jest.fn() };
});

const mockedGroupAware = groupAwareRandomization as jest.MockedFunction<typeof groupAwareRandomization>;
const { groupAwareRandomization: realGroupAware } = jest.requireActual('../algorithms/repeatedMeasuresDistribution');

const sameRow: RepeatedMeasuresConfig = { subjectColumn: 'SubjectID', groupingConstraint: 'same-row' };

const makeSubject = (subjectId: string, count: number, treatment: string): SearchData[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `${subjectId}_T${i}`,
    metadata: { SubjectID: subjectId, Treatment: treatment },
  }));

beforeEach(() => {
  // CRA resets mock implementations before each test, so the pass-through is set here.
  mockedGroupAware.mockImplementation(realGroupAware);
});

describe('useRandomization.reRandomizeSinglePlate with a grouping constraint', () => {
  it('rethrows an algorithm error and keeps the previous plates', () => {
    const samples = [
      ...makeSubject('A', 4, 'Drug'),
      ...makeSubject('B', 4, 'Placebo'),
      ...makeSubject('C', 4, 'Drug'),
      ...makeSubject('D', 4, 'Placebo'),
    ];
    const { result } = renderHook(() => useRandomization());

    act(() => {
      result.current.processRandomization(samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
    });
    const platesBefore = result.current.randomizedPlates;
    expect(platesBefore.length).toBe(1);

    mockedGroupAware.mockImplementationOnce(() => {
      throw new Error('Forced algorithm failure');
    });
    expect(() =>
      act(() => {
        result.current.reRandomizeSinglePlate(0, samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
      })
    ).toThrow('Forced algorithm failure');
    expect(result.current.randomizedPlates).toBe(platesBefore);
  });
});

describe('useRandomization retry on a packing error', () => {
  const samples = [...makeSubject('A', 4, 'Drug'), ...makeSubject('B', 4, 'Placebo')];
  const throwPacking = () => {
    throw new PackingError('Forced packing failure');
  };

  it('returns the layout when the last allowed retry succeeds', () => {
    const { result } = renderHook(() => useRandomization());
    for (let i = 0; i < MAX_PACKING_RETRIES; i++) {
      mockedGroupAware.mockImplementationOnce(throwPacking);
    }

    act(() => {
      result.current.processRandomization(samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
    });
    expect(mockedGroupAware).toHaveBeenCalledTimes(6);
    expect(result.current.isProcessed).toBe(true);
  });

  it('rethrows the packing error after the retries run out', () => {
    const { result } = renderHook(() => useRandomization());
    mockedGroupAware.mockImplementation(throwPacking);

    expect(() =>
      act(() => {
        result.current.processRandomization(samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
      })
    ).toThrow('Forced packing failure');
    expect(mockedGroupAware).toHaveBeenCalledTimes(6);
    expect(result.current.isProcessed).toBe(false);
  });

  it('does not retry an error that is not a packing error', () => {
    const { result } = renderHook(() => useRandomization());
    mockedGroupAware.mockImplementation(() => {
      throw new Error('Forced validation failure');
    });

    expect(() =>
      act(() => {
        result.current.processRandomization(samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
      })
    ).toThrow('Forced validation failure');
    expect(mockedGroupAware).toHaveBeenCalledTimes(1);
  });

  it('retries a packing error from single-plate re-randomize', () => {
    const { result } = renderHook(() => useRandomization());
    act(() => {
      result.current.processRandomization(samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
    });
    mockedGroupAware.mockClear();
    mockedGroupAware.mockImplementationOnce(throwPacking);

    let reRandomized = false;
    act(() => {
      reRandomized = result.current.reRandomizeSinglePlate(0, samples, ['Treatment'], 'balanced', false, 4, 6, sameRow);
    });
    expect(reRandomized).toBe(true);
    expect(mockedGroupAware).toHaveBeenCalledTimes(2);
  });
});
