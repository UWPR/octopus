import { formatTimestampForFilename, withTimestamp, buildLayoutFileName, buildCovariateKey, effectiveValue, effectiveDisplayValue } from '../utils/utils';
import { SearchData, CovariateConfig } from '../utils/types';

const mkSample = (metadata: { [key: string]: string }): SearchData => ({ name: 'sample', metadata });

describe('formatTimestampForFilename', () => {
  it('formats a date as YYYY-MM-DD_HH-mm-ss in local time', () => {
    // Local-time constructor: month is 0-based, so 5 = June.
    expect(formatTimestampForFilename(new Date(2026, 5, 22, 11, 8, 9))).toBe('2026-06-22_11-08-09');
  });

  it('zero-pads single-digit month, day, hour, minute, and second', () => {
    expect(formatTimestampForFilename(new Date(2026, 0, 5, 3, 4, 7))).toBe('2026-01-05_03-04-07');
  });

  it('produces only filename-safe characters (digits, hyphen, underscore)', () => {
    const stamp = formatTimestampForFilename(new Date(2026, 11, 31, 23, 59, 59));
    expect(stamp).toBe('2026-12-31_23-59-59');
    expect(stamp).toMatch(/^[0-9_-]+$/);
  });
});

describe('withTimestamp', () => {
  // 2026-06-22_11-08-09 (local-time constructor: month is 0-based, so 5 = June).
  const AT = new Date(2026, 5, 22, 11, 8, 9);

  it('inserts the timestamp before the final extension', () => {
    expect(withTimestamp('trx_octopus.csv', AT)).toBe('trx_octopus_2026-06-22_11-08-09.csv');
    expect(withTimestamp('report.xlsx', AT)).toBe('report_2026-06-22_11-08-09.xlsx');
  });

  it('appends the timestamp when there is no extension', () => {
    expect(withTimestamp('layout', AT)).toBe('layout_2026-06-22_11-08-09');
  });

  it('splits on the final dot only', () => {
    expect(withTimestamp('a.b_octopus.csv', AT)).toBe('a.b_octopus_2026-06-22_11-08-09.csv');
  });
});

describe('buildLayoutFileName', () => {
  it('appends _octopus_layout.json to a plain sample file name', () => {
    expect(buildLayoutFileName('mydata.csv')).toBe('mydata_octopus_layout.json');
  });

  it('returns the default name when no file is loaded', () => {
    expect(buildLayoutFileName('')).toBe('octopus_layout.json');
    expect(buildLayoutFileName(undefined)).toBe('octopus_layout.json');
  });

  it('does not stack the suffix when re-saving a loaded layout (with timestamp)', () => {
    expect(buildLayoutFileName('mydata_octopus_layout_2026-06-30_10-00-00.json'))
      .toBe('mydata_octopus_layout.json');
  });

  it('strips a prior _octopus_layout suffix that has no timestamp', () => {
    expect(buildLayoutFileName('mydata_octopus_layout.json')).toBe('mydata_octopus_layout.json');
  });

  it('collapses an already double-stacked name back to a single suffix', () => {
    expect(buildLayoutFileName('mydata_octopus_layout_2026-06-01_09-00-00_octopus_layout_2026-06-30_10-00-00.json'))
      .toBe('mydata_octopus_layout.json');
  });

  it('falls back to the default when the name is only the suffix', () => {
    expect(buildLayoutFileName('_octopus_layout_2026-06-30_10-00-00.json')).toBe('octopus_layout.json');
  });
});

describe('buildCovariateKey injectivity (escape encoding)', () => {
  const config: CovariateConfig = { selectedCovariates: ['Treatment', 'Dose', 'Site'] };

  it('produces distinct keys when a covariate value contains the delimiter', () => {
    // Two different combinations that both plain-join to "Drug|Hi|10|S1".
    const a = mkSample({ Treatment: 'Drug|Hi', Dose: '10', Site: 'S1' });
    const b = mkSample({ Treatment: 'Drug', Dose: 'Hi|10', Site: 'S1' });
    expect(buildCovariateKey(a, config)).not.toBe(buildCovariateKey(b, config));
    expect(buildCovariateKey(a, config)).toBe('Drug\\|Hi|10|S1');
    expect(buildCovariateKey(b, config)).toBe('Drug|Hi\\|10|S1');
  });

  it('preserves injectivity when a value contains the escape character', () => {
    // Both plain-join to "\||x"; escaping the backslash keeps them distinct.
    const c2: CovariateConfig = { selectedCovariates: ['C1', 'C2'] };
    const t1 = mkSample({ C1: '\\|', C2: 'x' });
    const t2 = mkSample({ C1: '\\', C2: '|x' });
    expect(buildCovariateKey(t1, c2)).not.toBe(buildCovariateKey(t2, c2));
  });

  it('escapes the delimiter inside the prepended QC value', () => {
    const qcConfig: CovariateConfig = {
      selectedCovariates: ['Dose', 'Site'],
      qcColumn: 'Condition',
      selectedQcValues: ['Batch|QC'],
    };
    const qc = mkSample({ Condition: 'Batch|QC', Dose: '108', Site: 'FA1' });
    expect(buildCovariateKey(qc, qcConfig)).toBe('Batch\\|QC|108|FA1');
  });

  it('is byte-identical to the legacy pipe-join for clean data', () => {
    const clean = mkSample({ Treatment: 'Training', Dose: '108', Site: 'FA1' });
    expect(buildCovariateKey(clean, config)).toBe('Training|108|FA1');
  });

  it('represents a genuinely-missing value with the missing marker by default', () => {
    // Under na-value-handling the default policy keeps a blank cell distinct from a literal
    // N/A: it becomes the lone-backslash missing marker, not the string N/A.
    const missing = mkSample({ Treatment: 'Training', Dose: '', Site: 'FA1' });
    expect(buildCovariateKey(missing, config)).toBe('Training|\\|FA1');
  });

  it('preserves the QC prefix for clean data', () => {
    const qcConfig: CovariateConfig = {
      selectedCovariates: ['Dose', 'Site'],
      qcColumn: 'Condition',
      selectedQcValues: ['BatchQC'],
    };
    const qc = mkSample({ Condition: 'BatchQC', Dose: '108', Site: 'FA1' });
    expect(buildCovariateKey(qc, qcConfig)).toBe('BatchQC|108|FA1');
  });

  it('does not prepend the QC value when the QC column is also a selected covariate', () => {
    // The prepend only fires when the QC column is not itself a covariate. Here
    // Condition is both the QC column and a selected covariate, so its value already
    // sits in the base key and must not be duplicated as a prefix.
    const qcConfig: CovariateConfig = {
      selectedCovariates: ['Condition', 'Dose', 'Site'],
      qcColumn: 'Condition',
      selectedQcValues: ['BatchQC'],
    };
    const qc = mkSample({ Condition: 'BatchQC', Dose: '108', Site: 'FA1' });
    // Not the doubled 'BatchQC|BatchQC|108|FA1' that a stray prepend would produce.
    expect(buildCovariateKey(qc, qcConfig)).toBe('BatchQC|108|FA1');
  });
});

// na-value-handling: a blank cell can stay distinct from a literal N/A, folded spellings
// collapse into N/A, and na/NA stay distinct unless folded. These are the green side of the
// red-green flip captured pre-policy in the covariate-key-fragility residual.
describe('buildCovariateKey under NaPolicy', () => {
  const cols = ['Treatment', 'Dose', 'Site'];
  const blank = mkSample({ Treatment: 'Training', Dose: '', Site: 'FA1' });
  const literalNA = mkSample({ Treatment: 'Training', Dose: 'N/A', Site: 'FA1' });

  it('keeps a blank cell distinct from a literal N/A by default', () => {
    const config: CovariateConfig = { selectedCovariates: cols };
    expect(buildCovariateKey(blank, config)).toBe('Training|\\|FA1');
    expect(buildCovariateKey(literalNA, config)).toBe('Training|N/A|FA1');
    expect(buildCovariateKey(blank, config)).not.toBe(buildCovariateKey(literalNA, config));
  });

  it('folds a blank cell into N/A when the policy folds blank', () => {
    const config: CovariateConfig = {
      selectedCovariates: cols,
      naPolicy: { foldBlank: true, foldSpellings: [] },
    };
    expect(buildCovariateKey(blank, config)).toBe('Training|N/A|FA1');
    expect(buildCovariateKey(blank, config)).toBe(buildCovariateKey(literalNA, config));
  });

  it('folds a listed spelling into N/A while a literal N/A always folds', () => {
    const config: CovariateConfig = {
      selectedCovariates: cols,
      naPolicy: { foldBlank: false, foldSpellings: ['na'] },
    };
    const na = mkSample({ Treatment: 'Training', Dose: 'na', Site: 'FA1' });
    expect(buildCovariateKey(na, config)).toBe('Training|N/A|FA1');
    expect(buildCovariateKey(na, config)).toBe(buildCovariateKey(literalNA, config));
  });

  it('keeps na and NA distinct when only na is folded (grouping is by exact text)', () => {
    const config: CovariateConfig = {
      selectedCovariates: cols,
      naPolicy: { foldBlank: false, foldSpellings: ['na'] },
    };
    const na = mkSample({ Treatment: 'Training', Dose: 'na', Site: 'FA1' });
    const NA = mkSample({ Treatment: 'Training', Dose: 'NA', Site: 'FA1' });
    expect(buildCovariateKey(na, config)).toBe('Training|N/A|FA1');
    expect(buildCovariateKey(NA, config)).toBe('Training|NA|FA1');
    expect(buildCovariateKey(na, config)).not.toBe(buildCovariateKey(NA, config));
  });

  it('leaves na and NA as their own literal groups under the default policy', () => {
    const config: CovariateConfig = { selectedCovariates: cols };
    const na = mkSample({ Treatment: 'Training', Dose: 'na', Site: 'FA1' });
    const NA = mkSample({ Treatment: 'Training', Dose: 'NA', Site: 'FA1' });
    expect(buildCovariateKey(na, config)).toBe('Training|na|FA1');
    expect(buildCovariateKey(NA, config)).toBe('Training|NA|FA1');
  });
});

describe('effectiveValue and effectiveDisplayValue', () => {
  it('classifies raw values under the default policy', () => {
    expect(effectiveValue('Drug')).toEqual({ kind: 'value', value: 'Drug' });
    expect(effectiveValue('')).toEqual({ kind: 'missing' });
    expect(effectiveValue('   ')).toEqual({ kind: 'missing' });
    expect(effectiveValue('N/A')).toEqual({ kind: 'na' });
    expect(effectiveValue('na')).toEqual({ kind: 'value', value: 'na' });
  });

  it('folds blank and listed spellings when the policy says so', () => {
    const policy = { foldBlank: true, foldSpellings: ['na', 'n/a'] };
    expect(effectiveValue('', policy)).toEqual({ kind: 'na' });
    expect(effectiveValue('na', policy)).toEqual({ kind: 'na' });
    expect(effectiveValue('NA', policy)).toEqual({ kind: 'value', value: 'NA' });
  });

  it('maps effective values to display text: folded -> N/A, missing -> blank, value -> itself', () => {
    expect(effectiveDisplayValue('Drug')).toBe('Drug');
    expect(effectiveDisplayValue('N/A')).toBe('N/A');
    expect(effectiveDisplayValue('')).toBe(''); // missing renders blank by default
    expect(effectiveDisplayValue('', { foldBlank: true, foldSpellings: [] })).toBe('N/A');
    expect(effectiveDisplayValue('na', { foldBlank: false, foldSpellings: ['na'] })).toBe('N/A');
  });
});
