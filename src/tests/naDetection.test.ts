import { detectNaTypeValues } from '../utils/utils';
import { SearchData } from '../utils/types';

const mkSample = (metadata: { [key: string]: string }): SearchData => ({ name: 's', metadata });

describe('detectNaTypeValues', () => {
  it('returns the exact distinct spellings per column', () => {
    const samples = [
      mkSample({ Dose: 'na', Site: 'FA1' }),
      mkSample({ Dose: 'NA', Site: 'FA2' }),
      mkSample({ Dose: '108', Site: 'na' }),
    ];
    const result = detectNaTypeValues(samples, ['Dose', 'Site']);
    expect(result.byColumn.get('Dose')).toEqual(new Set(['na', 'NA']));
    expect(result.byColumn.get('Site')).toEqual(new Set(['na']));
    expect(result.spellings).toEqual(new Set(['na', 'NA']));
  });

  it('flags a column that mixes two or more distinct N/A-type spellings', () => {
    const samples = [
      mkSample({ Dose: 'na' }),
      mkSample({ Dose: 'NA' }),
    ];
    expect(detectNaTypeValues(samples, ['Dose']).hasAmbiguousColumn).toBe(true);
  });

  it('does not flag a column with a single N/A-type spelling', () => {
    const samples = [
      mkSample({ Dose: 'na' }),
      mkSample({ Dose: 'na' }),
      mkSample({ Dose: '108' }),
    ];
    const result = detectNaTypeValues(samples, ['Dose']);
    expect(result.byColumn.get('Dose')).toEqual(new Set(['na']));
    expect(result.hasAmbiguousColumn).toBe(false);
  });

  it('treats blank and whitespace-only cells as the one blank token, and mixing blank with a spelling is ambiguous', () => {
    const samples = [
      mkSample({ Dose: '' }),
      mkSample({ Dose: '   ' }),
      mkSample({ Dose: 'na' }),
    ];
    const result = detectNaTypeValues(samples, ['Dose']);
    // '' and '   ' collapse to the single blank token '', so the column holds { blank, na }.
    expect(result.byColumn.get('Dose')).toEqual(new Set(['', 'na']));
    expect(result.hasAmbiguousColumn).toBe(true);
  });

  it('does not flag a column whose only N/A-type value is blank', () => {
    const samples = [
      mkSample({ Dose: '' }),
      mkSample({ Dose: '  ' }),
      mkSample({ Dose: '108' }),
    ];
    const result = detectNaTypeValues(samples, ['Dose']);
    expect(result.byColumn.get('Dose')).toEqual(new Set(['']));
    expect(result.hasAmbiguousColumn).toBe(false);
  });

  it('omits columns that hold no N/A-type value', () => {
    const samples = [mkSample({ Treatment: 'Drug', Dose: 'na' })];
    const result = detectNaTypeValues(samples, ['Treatment', 'Dose']);
    expect(result.byColumn.has('Treatment')).toBe(false);
    expect(result.byColumn.has('Dose')).toBe(true);
  });

  it('does not treat None, null, or - as N/A-type', () => {
    const samples = [
      mkSample({ Dose: 'None' }),
      mkSample({ Dose: 'null' }),
      mkSample({ Dose: '-' }),
    ];
    const result = detectNaTypeValues(samples, ['Dose']);
    expect(result.byColumn.has('Dose')).toBe(false);
    expect(result.hasAmbiguousColumn).toBe(false);
  });

  it('reports ambiguity across the whole set even if no single sample shows both spellings', () => {
    const samples = [
      mkSample({ Focus: 'n/a' }),
      mkSample({ Focus: 'N/A' }),
    ];
    const result = detectNaTypeValues(samples, ['Focus']);
    expect(result.byColumn.get('Focus')).toEqual(new Set(['n/a', 'N/A']));
    expect(result.hasAmbiguousColumn).toBe(true);
  });
});
