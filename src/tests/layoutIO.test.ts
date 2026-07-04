import {
  serializeLayout,
  parseLayout,
  validateLayout,
  buildPlatesFromRows,
  wellToIndices,
  LayoutSettings,
  LAYOUT_FORMAT,
  LAYOUT_SCHEMA_VERSION,
  CovariateColorMap,
} from '../utils/layoutIO';
import { buildPlacementCsv, buildProcessedSearches, getWell } from '../utils/utils';
import { buildLayoutWorkbook } from '../utils/excelExport';
import { SearchData } from '../utils/types';
import ExcelJS from 'exceljs';

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
  naPolicy: { foldBlank: false, foldSpellings: [] },
};

// Every color key matches a covariate combination the samples actually produce, so the
// well-formed fixture passes validateLayout's covariate-color consistency check.
// Dark colors -> recomputed textColor is always '#fff', so round-trip equality holds.
const COLORS: CovariateColorMap = {
  'Drug|0': { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
  'Placebo|0': { color: '#222222', useOutline: true, useStripes: false, textColor: '#fff' },
  'Drug|10': { color: '#333333', useOutline: false, useStripes: true, textColor: '#fff' },
  'Placebo|10': { color: '#444444', useOutline: false, useStripes: false, textColor: '#fff' },
};

function fullFile(appVersion?: string): string {
  return serializeLayout({
    searches: SEARCHES,
    randomizedPlates: PLATES,
    settings: SETTINGS,
    covariateColors: COLORS,
    appVersion,
  });
}

/** Parse the well-formed file into a plain object so a test can tweak one field and re-serialize. */
function doc(): { [key: string]: unknown } {
  return JSON.parse(fullFile());
}
function ser(d: unknown): string {
  return JSON.stringify(d);
}

describe('serializeLayout', () => {
  it('emits a JSON document with the marker, version, plate count, settings, colors, and samples', () => {
    const d = JSON.parse(fullFile()) as any;
    expect(d.format).toBe(LAYOUT_FORMAT);
    expect(d.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION);
    expect(d.plateCount).toBe(2);
    expect(d.settings.idColumn).toBe('Sample ID');
    expect(d.settings.covariates).toEqual(['Treatment', 'Dose']);
    expect(d.settings.qcValues).toEqual(['Placebo']);
    expect(d.settings.plateRows).toBe(2);
    expect(d.settings.metadataColumns).toEqual(['Treatment', 'Dose']);
    // Colors are encoded as { color, fill } with a single fill enum.
    expect(d.covariateColors['Drug|10']).toEqual({ color: '#333333', fill: 'stripes' });
    expect(d.covariateColors['Placebo|0']).toEqual({ color: '#222222', fill: 'outline' });
    expect(d.covariateColors['Drug|0']).toEqual({ color: '#111111', fill: 'solid' });
    // Samples carry id, 1-based plate, well, and exactly the declared metadata columns.
    expect(d.samples).toHaveLength(6);
    expect(d.samples[0]).toEqual({ id: 'S1', plate: 1, well: 'A01', metadata: { Treatment: 'Drug', Dose: '0' } });
    expect(d.samples[5]).toEqual({ id: 'S6', plate: 2, well: 'A01', metadata: { Treatment: 'Placebo', Dose: '10' } });
  });

  it('records the app version when given and round-trips it without leaking into settings', () => {
    const withVersion = JSON.parse(fullFile('1.1.0')) as any;
    expect(withVersion.appVersion).toBe('1.1.0');
    const parsed = parseLayout(fullFile('1.1.0'));
    expect(parsed.appVersion).toBe('1.1.0');
    expect(parsed.settings).toEqual(SETTINGS);
  });

  it('omits the app version when none is given (parsed appVersion is null)', () => {
    expect('appVersion' in (JSON.parse(fullFile()) as object)).toBe(false);
    expect(parseLayout(fullFile()).appVersion).toBeNull();
  });

  it('refuses to save a layout with no covariate colors', () => {
    // A layout must record a color for every covariate group, so saving without colors is refused.
    expect(() =>
      serializeLayout({ searches: SEARCHES, randomizedPlates: PLATES, settings: SETTINGS, covariateColors: {} })
    ).toThrow(/covariate colors/i);
  });

  it('throws when a sample is not on any plate instead of emitting an invalid plate', () => {
    const orphan = makeSample('ORPHAN', 'Drug', '0'); // in searches but not placed in PLATES
    expect(() =>
      serializeLayout({ searches: [...SEARCHES, orphan], randomizedPlates: PLATES, settings: SETTINGS, covariateColors: COLORS })
    ).toThrow(/sample "ORPHAN" is not placed on any plate/);
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
    expect(parsed.hasMarker).toBe(true);
    expect(parsed.structuralErrors).toEqual([]);
    expect(parsed.settings).toEqual(SETTINGS);
    expect(parsed.plateCount).toBe(2);
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
  // Each variant changes a single setting away from the default. Re-serializing with the same
  // placement and re-parsing must return exactly the varied settings object, proving each field
  // is carried through the file independently. Plate dims are only ever widened (never below the
  // 2x3 placement) so the table stays valid.
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
    { name: 'naPolicy folds blank and a spelling', settings: { ...SETTINGS, naPolicy: { foldBlank: true, foldSpellings: ['na'] } } },
  ];

  it.each(variants)('preserves: $name', ({ settings }) => {
    const text = serializeLayout({
      searches: SEARCHES,
      randomizedPlates: PLATES,
      settings,
      covariateColors: COLORS,
    });
    const parsed = parseLayout(text);
    expect(parsed.hasMarker).toBe(true);
    expect(parsed.structuralErrors).toEqual([]);
    expect(parsed.settings).toEqual(settings);
  });

  it('validates covariate-color keys derived under the saved naPolicy', () => {
    // Samples carry an N/A-type spelling. A layout saved with a policy that folds 'na' into N/A
    // must store the folded color key 'N/A' and reload cleanly, since validateLayout re-derives
    // keys through the saved policy. With the default policy the same file would instead expect
    // the literal 'na' key, so this proves the policy actually drives the re-derivation.
    const naSamples = [makeSample('N1', 'na', '0'), makeSample('N2', 'Drug', '0')];
    const naPlates: (SearchData | undefined)[][][] = [[[naSamples[0], naSamples[1], undefined], [undefined, undefined, undefined]]];
    const foldSettings: LayoutSettings = {
      ...SETTINGS,
      qcColumn: '',
      selectedQcValues: [],
      naPolicy: { foldBlank: false, foldSpellings: ['na'] },
    };
    // Under this policy 'na' folds to N/A, so the group key for N1 is 'N/A|0'.
    const foldColors: CovariateColorMap = {
      'N/A|0': { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
      'Drug|0': { color: '#222222', useOutline: false, useStripes: false, textColor: '#fff' },
    };
    const text = serializeLayout({ searches: naSamples, randomizedPlates: naPlates, settings: foldSettings, covariateColors: foldColors });
    const parsed = parseLayout(text);
    expect(parsed.settings!.naPolicy).toEqual({ foldBlank: false, foldSpellings: ['na'] });
    expect(validateLayout(parsed)).toEqual([]);
  });
});

describe('color and style round-trip', () => {
  it('preserves every fill style (solid, outline, stripes) verbatim', () => {
    // COLORS already covers solid (Drug|0, Placebo|10), outline (Placebo|0), stripes (Drug|10).
    const parsed = parseLayout(fullFile());
    expect(parsed.covariateColors).toEqual(COLORS);
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
    expect(nameAt(0, 0, 0)).toBe('S1'); // A01
    expect(nameAt(0, 0, 1)).toBe('S2'); // A02
    expect(nameAt(0, 0, 2)).toBe('S3'); // A03
    expect(nameAt(0, 1, 0)).toBe('S4'); // B01
    expect(nameAt(0, 1, 1)).toBe('S5'); // B02
    expect(plates[0][1][2]).toBeUndefined(); // B03 empty
    expect(nameAt(1, 0, 0)).toBe('S6'); // A01
    expect(plates[1][0][1]).toBeUndefined();
    expect(plates[1][1][0]).toBeUndefined();
  });

  it('preserves metadata values containing commas and spaces', () => {
    const tricky: SearchData = { name: 'X1', metadata: { Treatment: 'Drug, high', Dose: '10 mg' } };
    const trickyPlates: (SearchData | undefined)[][][] = [
      [
        [tricky, undefined, undefined],
        [undefined, undefined, undefined],
      ],
    ];
    const settings: LayoutSettings = { ...SETTINGS, qcColumn: '', selectedQcValues: [] };
    // The one sample forms the group "Drug, high|10 mg"; colors are required, so give it one.
    const trickyColors: CovariateColorMap = {
      'Drug, high|10 mg': { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
    };
    const text = serializeLayout({
      searches: [tricky],
      randomizedPlates: trickyPlates,
      settings,
      covariateColors: trickyColors,
    });
    const { samples } = buildPlatesFromRows(parseLayout(text).rows, settings);
    expect(samples).toHaveLength(1);
    expect(samples[0].metadata).toEqual({ Treatment: 'Drug, high', Dose: '10 mg' });
  });
});

describe('export round-trip fidelity', () => {
  // Mirrors the user workflow: export an artifact, save the layout, load it back, export again.
  // The second artifact must match the first. These exercise the real export code paths
  // (buildPlacementCsv and buildLayoutWorkbook), not just the layout file.

  it('re-exporting the placement CSV after a layout round trip is byte-identical', () => {
    const csvBefore = buildPlacementCsv(SEARCHES, PLATES, SETTINGS.selectedIdColumn);

    const parsed = parseLayout(fullFile());
    const { plates, samples } = buildPlatesFromRows(parsed.rows, parsed.settings!);
    const csvAfter = buildPlacementCsv(samples, plates, parsed.settings!.selectedIdColumn);

    expect(csvAfter).toBe(csvBefore);
  });

  it('re-exporting the Excel workbook after a layout round trip has identical content', () => {
    const clone = (list: SearchData[]): SearchData[] =>
      list.map(s => ({ name: s.name, metadata: { ...s.metadata } }));
    const platesFrom = (byName: Map<string, SearchData>): (SearchData | undefined)[][][] =>
      PLATES.map(plate => plate.map(row => row.map(cell => (cell ? byName.get(cell.name) : undefined))));

    const beforeSearches = clone(SEARCHES);
    const beforeByName = new Map(beforeSearches.map(s => [s.name, s]));
    const beforePlates = platesFrom(beforeByName);
    buildProcessedSearches(beforeSearches, {
      selectedCovariates: SETTINGS.selectedCovariates,
      qcColumn: SETTINGS.qcColumn,
      selectedQcValues: SETTINGS.selectedQcValues,
    });

    const parsed = parseLayout(fullFile());
    const { plates: afterPlates, samples: afterSearches } = buildPlatesFromRows(parsed.rows, parsed.settings!);
    buildProcessedSearches(afterSearches, {
      selectedCovariates: parsed.settings!.selectedCovariates,
      qcColumn: parsed.settings!.qcColumn,
      selectedQcValues: parsed.settings!.selectedQcValues,
    });

    const optionsFor = (s: SearchData[], p: (SearchData | undefined)[][][]) => ({
      searches: s,
      randomizedPlates: p,
      covariateColors: COLORS,
      treatmentCovariates: SETTINGS.selectedCovariates,
      exportCovariates: SETTINGS.selectedCovariates,
      numRows: SETTINGS.plateRows,
      numColumns: SETTINGS.plateColumns,
      qcColumn: SETTINGS.qcColumn || undefined,
    });

    const wbBefore = buildLayoutWorkbook(optionsFor(beforeSearches, beforePlates));
    const wbAfter = buildLayoutWorkbook(optionsFor(afterSearches, afterPlates));

    expect(projectWorkbook(wbAfter)).toEqual(projectWorkbook(wbBefore));
  });
});

function projectWorkbook(workbook: ExcelJS.Workbook) {
  return workbook.worksheets.map(sheet => {
    const cells: Array<{ row: number; col: number; value: unknown; style: unknown }> = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells.push({ row: rowNumber, col: colNumber, value: cell.value, style: cell.style });
      });
    });
    return { name: sheet.name, cells };
  });
}

describe('marker detection (parseLayout.hasMarker)', () => {
  it('detects a real layout document', () => {
    expect(parseLayout(fullFile()).hasMarker).toBe(true);
  });

  it('does not treat a non-JSON file as a layout', () => {
    expect(parseLayout('Sample ID,Note\nS1,see the Octopus Layout guide\n').hasMarker).toBe(false);
    expect(parseLayout('not json at all {[').hasMarker).toBe(false);
  });

  it('does not treat JSON without the format marker as a layout', () => {
    expect(parseLayout('{"foo":"bar","samples":[]}').hasMarker).toBe(false);
  });
});

describe('parseLayout strict structural validation', () => {
  it('flags an unreadable (non-integer) schema version', () => {
    const d = doc();
    d.schemaVersion = 'x';
    const parsed = parseLayout(ser(d));
    expect(parsed.hasMarker).toBe(true);
    expect(parsed.structuralErrors.some(e => e.fatal)).toBe(true);
    expect(validateLayout(parsed).some(e => e.fatal)).toBe(true);
  });

  it('flags a schema version newer than supported', () => {
    const d = doc();
    d.schemaVersion = LAYOUT_SCHEMA_VERSION + 1;
    const parsed = parseLayout(ser(d));
    expect(parsed.structuralErrors.some(e => e.fatal && /newer version/.test(e.message))).toBe(true);
  });

  it('flags an invalid plate count', () => {
    const d = doc();
    d.plateCount = 0;
    expect(parseLayout(ser(d)).structuralErrors.some(e => e.fatal && /plate count/.test(e.message))).toBe(true);
  });

  it.each([
    ['non-integer plateRows', (d: any) => { d.settings.plateRows = 'abc'; }],
    ['non-positive plateColumns', (d: any) => { d.settings.plateColumns = 0; }],
    ['unknown algorithm', (d: any) => { d.settings.algorithm = 'quantum'; }],
    ['unknown groupingConstraint', (d: any) => { d.settings.groupingConstraint = 'same-galaxy'; }],
    ['covariates not an array', (d: any) => { d.settings.covariates = 'Treatment'; }],
    ['idColumn not a string', (d: any) => { d.settings.idColumn = 5; }],
    ['naPolicy missing', (d: any) => { delete d.settings.naPolicy; }],
    ['naPolicy.foldBlank not a boolean', (d: any) => { d.settings.naPolicy.foldBlank = 'yes'; }],
    ['naPolicy.foldSpellings not a string array', (d: any) => { d.settings.naPolicy.foldSpellings = 'na'; }],
  ])('flags bad settings: %s', (_label, mutate) => {
    const d = doc();
    mutate(d);
    const parsed = parseLayout(ser(d));
    expect(parsed.settings).toBeNull();
    expect(parsed.structuralErrors.some(e => e.fatal)).toBe(true);
  });

  it.each([
    ['bad color hex', (d: any) => { d.covariateColors['Drug|0'].color = 'red'; }],
    ['bad fill token', (d: any) => { d.covariateColors['Drug|0'].fill = 'zebra'; }],
    ['covariateColors missing', (d: any) => { delete d.covariateColors; }],
    ['covariateColors empty', (d: any) => { d.covariateColors = {}; }],
  ])('flags bad covariateColors: %s', (_label, mutate) => {
    const d = doc();
    mutate(d);
    expect(parseLayout(ser(d)).structuralErrors.some(e => e.fatal)).toBe(true);
  });

  it.each([
    ['plate not an integer', (d: any) => { d.samples[0].plate = '1'; }],
    ['missing id', (d: any) => { delete d.samples[0].id; }],
    ['well not a string', (d: any) => { d.samples[0].well = 12; }],
    ['metadata value not a string', (d: any) => { d.samples[0].metadata.Dose = 0; }],
  ])('flags bad samples: %s', (_label, mutate) => {
    const d = doc();
    mutate(d);
    const parsed = parseLayout(ser(d));
    expect(parsed.rows).toEqual([]);
    expect(parsed.structuralErrors.some(e => e.fatal)).toBe(true);
  });

  it('flags an empty samples array', () => {
    const d = doc();
    d.samples = [];
    expect(parseLayout(ser(d)).structuralErrors.some(e => e.fatal && /no samples/.test(e.message))).toBe(true);
  });
});

describe('validateLayout semantic checks', () => {
  it('accepts a well-formed layout with no errors', () => {
    expect(validateLayout(parseLayout(fullFile()))).toEqual([]);
  });

  it('rejects an out-of-bounds well', () => {
    const d = doc() as any;
    d.samples[0].well = 'C01'; // row C (index 2) is outside the 2-row plate
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal)).toBe(true);
  });

  it('rejects two samples in the same well', () => {
    const d = doc() as any;
    d.samples[1].plate = 1;
    d.samples[1].well = 'A01'; // same as samples[0]
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /occupy/.test(e.message))).toBe(true);
  });

  it('rejects a plate number outside the plate count', () => {
    const d = doc() as any;
    d.samples[0].plate = 5; // plateCount is 2
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /outside the layout's 2 plate/.test(e.message))).toBe(true);
  });

  it('rejects a declared plate with no samples', () => {
    const d = doc() as any;
    d.plateCount = 3; // but only plates 1 and 2 hold samples
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /samples appear on 2 distinct plate\(s\)/.test(e.message))).toBe(true);
  });

  it('rejects a huge plate count without looping over it', () => {
    const d = doc() as any;
    d.plateCount = 1_000_000_000; // corrupt/hand-edited: must be rejected without a per-plate loop
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /samples appear on 2 distinct plate\(s\)/.test(e.message))).toBe(true);
  });

  it('rejects duplicate sample ids', () => {
    const d = doc() as any;
    d.samples[1].id = 'S1';
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /Duplicate/.test(e.message))).toBe(true);
  });

  it('rejects a covariate that is not a metadata column', () => {
    const d = doc() as any;
    d.settings.covariates = ['Treatment', 'Ghost'];
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /Covariate column "Ghost"/.test(e.message))).toBe(true);
  });

  it('rejects a sample missing a declared metadata column', () => {
    const d = doc() as any;
    delete d.samples[0].metadata.Dose;
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /metadata columns/.test(e.message))).toBe(true);
  });

  it('rejects a sample with an extra metadata column', () => {
    const d = doc() as any;
    d.samples[0].metadata.Extra = 'x';
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /metadata columns/.test(e.message))).toBe(true);
  });

  it('rejects a QC column that is not a metadata column', () => {
    const d = doc() as any;
    d.settings.qcColumn = 'Ghost';
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /QC column "Ghost"/.test(e.message))).toBe(true);
  });

  it('rejects a subject column that overlaps a covariate', () => {
    const d = doc() as any;
    d.settings.subjectColumn = 'Treatment'; // Treatment is a covariate
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /cannot also be a covariate/.test(e.message))).toBe(true);
  });

  it('rejects a covariate color for a combination no sample produces', () => {
    const d = doc() as any;
    d.covariateColors['Ghost|0'] = { color: '#abcdef', fill: 'solid' };
    expect(validateLayout(parseLayout(ser(d))).some(e => e.fatal && /no sample produces/.test(e.message))).toBe(true);
  });
});

describe('collision-free layout for values containing the delimiter', () => {
  // Two combinations that both plain-join to "Drug|Hi|10" but are genuinely
  // different groups. The escape-encoded key keeps them distinct, so the saved
  // layout records two distinct color entries (Requirement 6).
  const A = makeSample('A', 'Drug|Hi', '10'); // tuple ["Drug|Hi", "10"]
  const B = makeSample('B', 'Drug', 'Hi|10'); // tuple ["Drug", "Hi|10"]
  const searches = [A, B];
  const plates: (SearchData | undefined)[][][] = [
    [
      [A, B, undefined],
      [undefined, undefined, undefined],
    ],
  ];
  const settings: LayoutSettings = { ...SETTINGS, qcColumn: '', selectedQcValues: [] };

  // Derive the escape-encoded keys exactly as the app does when saving.
  function derivedKeys(): { keyA: string; keyB: string } {
    const clones: SearchData[] = searches.map(s => ({ name: s.name, metadata: { ...s.metadata } }));
    buildProcessedSearches(clones, {
      selectedCovariates: settings.selectedCovariates,
      qcColumn: settings.qcColumn,
      selectedQcValues: settings.selectedQcValues,
    });
    return { keyA: clones[0].covariateKey!, keyB: clones[1].covariateKey! };
  }

  it('saves two distinct color entries for two distinct groups and round-trips', () => {
    const { keyA, keyB } = derivedKeys();
    expect(keyA).not.toBe(keyB);

    const colors: CovariateColorMap = {
      [keyA]: { color: '#111111', useOutline: false, useStripes: false, textColor: '#fff' },
      [keyB]: { color: '#222222', useOutline: false, useStripes: false, textColor: '#fff' },
    };

    const parsed = parseLayout(
      serializeLayout({ searches, randomizedPlates: plates, settings, covariateColors: colors })
    );

    expect(parsed.structuralErrors).toEqual([]);
    // Both keys match a real group derived through the single key builder.
    expect(validateLayout(parsed)).toEqual([]);
    expect(Object.keys(parsed.covariateColors!)).toHaveLength(2);
    expect(parsed.covariateColors).toEqual(colors);
  });
});
