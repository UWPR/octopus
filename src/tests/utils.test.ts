import { formatTimestampForFilename, withTimestamp, buildLayoutFileName } from '../utils/utils';

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
