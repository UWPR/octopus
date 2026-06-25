import {
  serializeLayout,
  parseLayout,
  validateLayout,
  buildPlatesFromRows,
  wellToIndices,
  LayoutSettings,
  LAYOUT_MARKER,
  LAYOUT_SCHEMA_VERSION,
  CovariateColorMap,
} from '../utils/layoutIO';
import { buildPlacementCsv, buildProcessedSearches, getWell } from '../utils/utils';
import { SearchData } from '../utils/types';

// --- Fixture: a small, fully-known 2-plate layout (2 rows x 3 columns) ---

const PLATE_ROWS = 2;
const PLATE_COLUMNS = 3;

function makeSample(name: string, treatment: string, dose: string): SearchData {
  return { name, metadata: { Treatment: treatment, Dose: dose } };
}

// Plate 1: A01=S1 A02=S2 A03=S3 / B01=S4 B02=S5 (B03 empty)
// Plate 2: A01=S6
const S1 = makeSample('S1', 'Drug', '0');
const S2 = makeSample('S2', 'Placebo', '0');
const S3 = makeSample('S3', 'Drug', '10');
const S4 = makeSample('S4', 'Placebo', '10');
const S5 = makeSample('S5', 'Drug', '0');
const S6 = makeSample('S6', 'Placebo', '10');

const SEARCHES: SearchData[] = [S1, S2, S3, S4, S5, S6];

const PLATES: (SearchData | undefined)[][][] = [
  [
    [S1, S2, S3],
    [S4, S5, undefined],
  ],
  [
    [S6, undefined, undefined],
    [undefined, undefined, undefined],
  ],
];

const SETTINGS: LayoutSettings = {
  selectedIdColumn: 'Sample ID',
  selectedCovariates: ['Treatment', 'Dose'],
  qcColumn: 'Treatment',
  selectedQcValues: ['Placebo'],
  selectedAlgorithm: 'balanced',
  keepEmptyInLastPlate: false,
  plateRows: PLATE_ROWS,
  plateColumns: PLATE_COLUMNS,
  subjectColumn: '',
  groupingConstraint: 'none',
  metadataColumns: ['Treatment', 'Dose'],
};

// Dark colors -> recomputed textColor is always '#fff', so round-trip equality holds.
const COLORS: CovariateColorMap = {
  'Drug|0': { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
  'Placebo|0': { color: '#222222', useOutline: true, useStripes: false, textColor: '#fff' },
  'Drug|10': { color: '#333333', useOutline: false, useStripes: true, textColor: '#fff' },
  'Placebo|10': { color: '#444444', useOutline: false, useStripes: false, textColor: '#fff' },
};

function fullFile(): string {
  return serializeLayout({
    searches: SEARCHES,
    randomizedPlates: PLATES,
    settings: SETTINGS,
    covariateColors: COLORS,
  });
}

/** The options block of a layout file (everything before the placement table). */
function optionsBlock(settings: LayoutSettings, colors: CovariateColorMap = {}): string {
  return serializeLayout({
    searches: [],
    randomizedPlates: [],
    settings,
    covariateColors: colors,
  }).split('\n\n')[0];
}

describe('serializeLayout', () => {
  it('starts with the marker row and writes settings as two-column rows', () => {
    const text = fullFile();
    const lines = text.split(/\r?\n/);
    expect(lines[0]).toBe(`${LAYOUT_MARKER},${LAYOUT_SCHEMA_VERSION}`);
    expect(text).toContain('idColumn,Sample ID');
    expect(text).toContain('covariates,Treatment|Dose');
    expect(text).toContain('qcValues,Placebo');
    expect(text).toContain('plateRows,2');
    // Colors are encoded as `color:<key>,#RRGGBB <fill>` rows.
    expect(text).toContain('color:Drug|10,#333333 stripes');
    expect(text).toContain('color:Placebo|0,#222222 outline');
  });

  it('placement table is byte-for-byte the Download CSV table', () => {
    const table = fullFile().split('\n\n')[1];
    const expectedTable = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);
    expect(table).toBe(expectedTable);
  });
});

describe('wellToIndices', () => {
  it('is the exact inverse of getWell at boundaries', () => {
    expect(wellToIndices('A01', 8, 12)).toEqual({ row: 0, col: 0 });
    expect(wellToIndices('H12', 8, 12)).toEqual({ row: 7, col: 11 });
    const plates: (SearchData | undefined)[][][] = [
      Array.from({ length: 8 }, () => Array.from({ length: 12 }, () => undefined as SearchData | undefined)),
    ];
    plates[0][3][6] = { name: 'X', metadata: {} };
    const well = getWell('X', plates); // "D07"
    expect(well).toBe('D07');
    expect(wellToIndices(well, 8, 12)).toEqual({ row: 3, col: 6 });
  });

  it('rejects malformed and out-of-range wells', () => {
    expect(() => wellToIndices('AA1', 8, 12)).toThrow();
    expect(() => wellToIndices('I01', 8, 12)).toThrow(); // row 8 >= 8
    expect(() => wellToIndices('A13', 8, 12)).toThrow(); // col 12 >= 12
    expect(() => wellToIndices('A00', 8, 12)).toThrow(); // col -1
  });
});

describe('round trip', () => {
  it('serialize -> parse -> buildPlatesFromRows reproduces the exact plates', () => {
    const parsed = parseLayout(fullFile());
    expect(parsed.headerMissing).toBe(false);
    expect(parsed.settings).toEqual(SETTINGS);
    expect(parsed.rows.length).toBe(6);

    const { plates, plateAssignments, samples } = buildPlatesFromRows(parsed.rows, SETTINGS);
    expect(plates).toEqual(PLATES);

    expect(plateAssignments.get(0)!.map(s => s.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(plateAssignments.get(1)!.map(s => s.name)).toEqual(['S6']);

    expect(samples.map(s => s.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(Object.keys(samples[0].metadata)).toEqual(['Treatment', 'Dose']);
    expect(samples[0].metadata).toEqual({ Treatment: 'Drug', Dose: '0' });
  });

  it('restores covariateKey and isQC from settings (QC-prefix path included)', () => {
    const parsed = parseLayout(fullFile());
    const { samples } = buildPlatesFromRows(parsed.rows, parsed.settings!);
    buildProcessedSearches(samples, {
      selectedCovariates: parsed.settings!.selectedCovariates,
      qcColumn: parsed.settings!.qcColumn,
      selectedQcValues: parsed.settings!.selectedQcValues,
    });

    const byName = Object.fromEntries(samples.map(s => [s.name, s]));
    expect(byName['S1'].covariateKey).toBe('Drug|0');
    expect(byName['S1'].isQC).toBe(false);
    expect(byName['S2'].covariateKey).toBe('Placebo|0');
    expect(byName['S2'].isQC).toBe(true);
    expect(byName['S6'].covariateKey).toBe('Placebo|10');
    expect(byName['S6'].isQC).toBe(true);
  });

  it('restores covariate colors (fill + recomputed text color)', () => {
    const parsed = parseLayout(fullFile());
    expect(parsed.covariateColors).toEqual(COLORS);
  });
});

describe('settings round-trip (one field varied at a time)', () => {
  // Each variant changes a single setting away from the default. Re-serializing with the
  // same placement and re-parsing must return exactly the varied settings object, proving
  // each field is carried through the file independently. Plate dims are only ever widened
  // (never below the 2x3 placement) so the table stays valid.
  const variants: Array<{ name: string; settings: LayoutSettings }> = [
    { name: 'greedy algorithm', settings: { ...SETTINGS, selectedAlgorithm: 'greedy' } },
    { name: 'keepEmptyInLastPlate true', settings: { ...SETTINGS, keepEmptyInLastPlate: true } },
    { name: 'larger plate dimensions', settings: { ...SETTINGS, plateRows: 8, plateColumns: 12 } },
    { name: 'no QC column', settings: { ...SETTINGS, qcColumn: '', selectedQcValues: [] } },
    { name: 'multiple QC values', settings: { ...SETTINGS, qcColumn: 'Treatment', selectedQcValues: ['Drug', 'Placebo'] } },
    { name: 'single covariate', settings: { ...SETTINGS, selectedCovariates: ['Dose'] } },
    { name: 'reversed covariate order', settings: { ...SETTINGS, selectedCovariates: ['Dose', 'Treatment'] } },
    { name: 'subject column + same-row grouping', settings: { ...SETTINGS, subjectColumn: 'Dose', groupingConstraint: 'same-row' } },
    { name: 'subject column + same-plate grouping', settings: { ...SETTINGS, subjectColumn: 'Dose', groupingConstraint: 'same-plate' } },
  ];

  it.each(variants)('preserves: $name', ({ settings }) => {
    const text = serializeLayout({
      searches: SEARCHES,
      randomizedPlates: PLATES,
      settings,
      covariateColors: COLORS,
    });
    const parsed = parseLayout(text);
    expect(parsed.headerMissing).toBe(false);
    expect(parsed.settings).toEqual(settings);
  });
});

describe('color and style round-trip', () => {
  it('preserves every fill style (solid, outline, stripes) verbatim', () => {
    // COLORS already covers solid (Drug|0, Placebo|10), outline (Placebo|0), stripes (Drug|10).
    const parsed = parseLayout(fullFile());
    expect(parsed.covariateColors).toEqual(COLORS);
    // Spot-check each style flag explicitly so a silent flag swap is caught.
    expect(parsed.covariateColors!['Drug|0']).toEqual({ color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' });
    expect(parsed.covariateColors!['Placebo|0'].useOutline).toBe(true);
    expect(parsed.covariateColors!['Drug|10'].useStripes).toBe(true);
  });

  it('preserves light colors with a recomputed black text color', () => {
    // Light backgrounds -> getTextColorForBackground returns '#000'.
    const lightColors: CovariateColorMap = {
      'Drug|0': { color: '#FFFFFF', useOutline: false, useStripes: false, textColor: '#000' },
      'Placebo|0': { color: '#FFEEAA', useOutline: true, useStripes: false, textColor: '#000' },
      'Drug|10': { color: '#80C0FF', useOutline: false, useStripes: true, textColor: '#000' },
    };
    const text = serializeLayout({
      searches: SEARCHES,
      randomizedPlates: PLATES,
      settings: SETTINGS,
      covariateColors: lightColors,
    });
    const parsed = parseLayout(text);
    expect(parsed.covariateColors).toEqual(lightColors);
  });

  it('preserves a distinct color per group (no value bleeds across keys)', () => {
    const parsed = parseLayout(fullFile());
    const colorsByKey = parsed.covariateColors!;
    expect(colorsByKey['Drug|0'].color).toBe('#111111');
    expect(colorsByKey['Placebo|0'].color).toBe('#222222');
    expect(colorsByKey['Drug|10'].color).toBe('#333333');
    expect(colorsByKey['Placebo|10'].color).toBe('#444444');
  });
});

describe('per-cell placement', () => {
  it('puts every saved sample back in the exact same well', () => {
    const parsed = parseLayout(fullFile());
    const { plates } = buildPlatesFromRows(parsed.rows, parsed.settings!);
    const nameAt = (p: number, r: number, c: number) => plates[p][r][c]?.name;
    // Plate 1: A01..A03, B01..B02 occupied; B03 empty.
    expect(nameAt(0, 0, 0)).toBe('S1'); // A01
    expect(nameAt(0, 0, 1)).toBe('S2'); // A02
    expect(nameAt(0, 0, 2)).toBe('S3'); // A03
    expect(nameAt(0, 1, 0)).toBe('S4'); // B01
    expect(nameAt(0, 1, 1)).toBe('S5'); // B02
    expect(plates[0][1][2]).toBeUndefined(); // B03 empty
    // Plate 2: only A01 occupied.
    expect(nameAt(1, 0, 0)).toBe('S6'); // A01
    expect(plates[1][0][1]).toBeUndefined();
    expect(plates[1][1][0]).toBeUndefined();
  });

  it('preserves metadata values containing commas and spaces (CSV quoting)', () => {
    const tricky: SearchData = { name: 'X1', metadata: { Treatment: 'Drug, high', Dose: '10 mg' } };
    const trickyPlates: (SearchData | undefined)[][][] = [
      [
        [tricky, undefined, undefined],
        [undefined, undefined, undefined],
      ],
    ];
    const settings: LayoutSettings = { ...SETTINGS, qcColumn: '', selectedQcValues: [] };
    const text = serializeLayout({
      searches: [tricky],
      randomizedPlates: trickyPlates,
      settings,
      covariateColors: {},
    });
    const { samples } = buildPlatesFromRows(parseLayout(text).rows, settings);
    expect(samples).toHaveLength(1);
    expect(samples[0].metadata).toEqual({ Treatment: 'Drug, high', Dose: '10 mg' });
  });
});

describe('header degradation', () => {
  it('parses placement when the options block is entirely missing', () => {
    const table = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);
    const parsed = parseLayout(table);
    expect(parsed.headerMissing).toBe(true);
    expect(parsed.settings).toBeNull();
    expect(parsed.rows.length).toBe(6);
  });

  it('flags missing settings when only the marker row is present', () => {
    const table = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);
    const text = `${LAYOUT_MARKER},1\n\n${table}`;
    const parsed = parseLayout(text);
    expect(parsed.headerMissing).toBe(true);
    expect(parsed.settings).toBeNull();
  });

  it('flags missing settings when core options are incomplete', () => {
    const table = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);
    // idColumn present but plateRows/plateColumns missing.
    const text = `${LAYOUT_MARKER},1\nidColumn,Sample ID\n\n${table}`;
    const parsed = parseLayout(text);
    expect(parsed.headerMissing).toBe(true);
    expect(parsed.settings).toBeNull();
  });

  it('parses settings with no color rows (colors null, header present)', () => {
    const text = serializeLayout({
      searches: SEARCHES,
      randomizedPlates: PLATES,
      settings: SETTINGS,
      covariateColors: {},
    });
    const parsed = parseLayout(text);
    expect(parsed.headerMissing).toBe(false);
    expect(parsed.settings).toEqual(SETTINGS);
    expect(parsed.covariateColors).toBeNull();
  });

  it('survives an Excel-style round trip that pads rows and drops the blank line', () => {
    // Every row padded to the table width (6 cols), no blank separator line.
    const padded = fullFile()
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const cells = line.split(',');
        while (cells.length < 6) cells.push('');
        return cells.join(',');
      })
      .join('\n');
    const parsed = parseLayout(padded);
    expect(parsed.headerMissing).toBe(false);
    expect(parsed.settings).toEqual(SETTINGS);
    expect(parsed.rows.length).toBe(6);
    const { plates } = buildPlatesFromRows(parsed.rows, parsed.settings!);
    expect(plates).toEqual(PLATES);
  });
});

describe('validateLayout', () => {
  it('accepts a well-formed layout with no errors', () => {
    expect(validateLayout(parseLayout(fullFile()))).toEqual([]);
  });

  it('warns (non-fatal) when the options block is missing', () => {
    const table = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);
    const errors = validateLayout(parseLayout(table));
    expect(errors.length).toBe(1);
    expect(errors[0].fatal).toBe(false);
  });

  it('rejects a file saved by a newer schema version', () => {
    const text = fullFile().replace(`${LAYOUT_MARKER},${LAYOUT_SCHEMA_VERSION}`, `${LAYOUT_MARKER},${LAYOUT_SCHEMA_VERSION + 1}`);
    const errors = validateLayout(parseLayout(text));
    expect(errors.length).toBe(1);
    expect(errors[0].fatal).toBe(true);
  });

  it('rejects duplicate sample names', () => {
    const dup = makeSample('S1', 'Drug', '0');
    const dupSearches = [...SEARCHES, dup];
    const dupPlates: (SearchData | undefined)[][][] = [
      [
        [S1, S2, S3],
        [S4, S5, dup],
      ],
      [[S6, undefined, undefined], [undefined, undefined, undefined]],
    ];
    const text = serializeLayout({
      searches: dupSearches,
      randomizedPlates: dupPlates,
      settings: SETTINGS,
      covariateColors: COLORS,
    });
    const errors = validateLayout(parseLayout(text));
    expect(errors.some(e => e.fatal && e.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects an out-of-bounds well', () => {
    const text = `${optionsBlock(SETTINGS)}\n\nSample ID,Treatment,Dose,plate,well\nS1,Drug,0,1,C01\n`;
    const errors = validateLayout(parseLayout(text));
    expect(errors.some(e => e.fatal)).toBe(true);
  });

  it('rejects two samples in the same well', () => {
    const text = `${optionsBlock(SETTINGS)}\n\nSample ID,Treatment,Dose,plate,well\nS1,Drug,0,1,A01\nS2,Placebo,0,1,A01\n`;
    const errors = validateLayout(parseLayout(text));
    expect(errors.some(e => e.fatal && e.message.includes('occupy'))).toBe(true);
  });

  it('rejects an invalid plate number', () => {
    const text = `${optionsBlock(SETTINGS)}\n\nSample ID,Treatment,Dose,plate,well\nS1,Drug,0,0,A01\n`;
    const errors = validateLayout(parseLayout(text));
    expect(errors.some(e => e.fatal)).toBe(true);
  });
});
