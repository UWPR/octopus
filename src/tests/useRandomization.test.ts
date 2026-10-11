import { renderHook, act } from '@testing-library/react';
import { useRandomization } from '../hooks/useRandomization';
import { groupAwareRandomization } from '../algorithms/repeatedMeasuresDistribution';
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
