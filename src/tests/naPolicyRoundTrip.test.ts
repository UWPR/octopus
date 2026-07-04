/**
 * Exhaustive N/A-policy tests: every combination of the "N/A values" checklist choices.
 *
 * The checklist has four toggles: (blank), na, NA, n/a. The literal N/A is always folded. This
 * suite permutes all 2^4 = 16 combinations and, for each policy:
 *   1. asserts the covariate groups the key builder produces match an INDEPENDENT reference
 *      implementation (so a bug in effectiveValue cannot silently agree with itself), and
 *   2. asserts a Save -> parse -> validate -> Load round-trip reproduces the exact same groups,
 *      with validateLayout accepting the file (colors match the groups one-to-one).
 *
 * A negative test confirms validateLayout now rejects a file whose colors do not cover every
 * group (the class of drift that previously rendered uncolored cells gray instead of failing).
 */

import {
  serializeLayout,
  parseLayout,
  validateLayout,
  buildPlatesFromRows,
  LayoutSettings,
  CovariateColorMap,
} from '../utils/layoutIO';
import { buildProcessedSearches } from '../utils/utils';
import { SearchData, NaPolicy, CovariateColorInfo } from '../utils/types';

const COVARIATES = ['Treatment', 'Dose'];
const QC_COLUMN = 'QC';
const QC_VALUES = ['Ref'];
const METADATA_COLUMNS = ['Treatment', 'Dose', 'QC'];

// Samples covering every N/A form in Dose, a second value in Treatment, plus a QC sample whose
// Dose is an N/A form (so folding must also apply to a QC-prefixed key's covariate part).
const RAW_SAMPLES: Array<{ name: string; Treatment: string; Dose: string; QC: string }> = [
  { name: 's0', Treatment: 'A', Dose: '0', QC: '' },
  { name: 's1', Treatment: 'A', Dose: 'na', QC: '' },
  { name: 's2', Treatment: 'A', Dose: 'NA', QC: '' },
  { name: 's3', Treatment: 'A', Dose: 'n/a', QC: '' },
  { name: 's4', Treatment: 'A', Dose: 'N/A', QC: '' },
  { name: 's5', Treatment: 'A', Dose: '', QC: '' }, // genuinely blank
  { name: 's6', Treatment: 'B', Dose: 'na', QC: '' },
  { name: 's7', Treatment: 'B', Dose: '0', QC: '' },
  { name: 'q0', Treatment: 'A', Dose: 'na', QC: 'Ref' }, // QC sample
];

const makeSamples = (): SearchData[] =>
  RAW_SAMPLES.map(r => ({ name: r.name, metadata: { Treatment: r.Treatment, Dose: r.Dose, QC: r.QC } }));

// --- Independent reference for the expected covariate key (mirrors the spec, not the code) ---

const MARKER = '\\';
function refEffective(raw: string, policy: NaPolicy): string {
  const blank = raw.trim() === '';
  const lower = raw.toLowerCase();
  const isNa = blank || lower === 'na' || lower === 'n/a';
  if (!isNa) return raw; // no delimiters/escapes in this fixture, so raw === escaped
  if (blank) return policy.foldBlank ? 'N/A' : MARKER;
  if (raw === 'N/A') return 'N/A';
  return policy.foldSpellings.includes(raw) ? 'N/A' : raw;
}
function refKey(s: { Treatment: string; Dose: string; QC: string }, policy: NaPolicy): string {
  const base = [s.Treatment, s.Dose].map(v => refEffective(v, policy)).join('|');
  const isQc = !!s.QC && QC_VALUES.includes(s.QC) && !COVARIATES.includes(QC_COLUMN);
  return isQc ? `${refEffective(s.QC, policy)}|${base}` : base;
}

// --- Enumerate all 16 policies (foldBlank x subset of {na, NA, n/a}) ---

const TOGGLE_SPELLINGS = ['na', 'NA', 'n/a'];
function allPolicies(): NaPolicy[] {
  const policies: NaPolicy[] = [];
  for (const foldBlank of [false, true]) {
    for (let mask = 0; mask < 1 << TOGGLE_SPELLINGS.length; mask++) {
      const foldSpellings = TOGGLE_SPELLINGS.filter((_, i) => mask & (1 << i));
      policies.push({ foldBlank, foldSpellings });
    }
  }
  return policies;
}

const sortedKeys = (keys: Iterable<string>): string[] => Array.from(new Set(keys)).sort();

const DARK: CovariateColorInfo = { color: '#101010', useOutline: false, useStripes: false, textColor: '#fff' };

function colorsForGroups(groups: string[]): CovariateColorMap {
  const map: CovariateColorMap = {};
  groups.forEach(g => { map[g] = { ...DARK }; });
  return map;
}

function settingsFor(naPolicy: NaPolicy): LayoutSettings {
  return {
    selectedIdColumn: 'Sample ID',
    selectedCovariates: COVARIATES,
    qcColumn: QC_COLUMN,
    selectedQcValues: QC_VALUES,
    selectedAlgorithm: 'balanced',
    keepEmptyInLastPlate: false,
    plateRows: 3,
    plateColumns: 4,
    subjectColumn: '',
    groupingConstraint: 'none',
    metadataColumns: METADATA_COLUMNS,
    naPolicy,
  };
}

// Place the 9 samples row-major on a single 3x4 plate.
function buildPlates(samples: SearchData[]): (SearchData | undefined)[][][] {
  const rows = 3, cols = 4;
  const plate: (SearchData | undefined)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => undefined as SearchData | undefined)
  );
  samples.forEach((s, i) => { plate[Math.floor(i / cols)][i % cols] = s; });
  return [plate];
}

describe('N/A policy permutations: covariate groups and layout round-trip', () => {
  const policies = allPolicies();

  it('enumerates all 16 checklist combinations', () => {
    expect(policies.length).toBe(16);
  });

  it.each(policies.map(p => [JSON.stringify(p), p] as const))(
    'produces the reference groups and round-trips exactly: %s',
    (_label, policy) => {
      // 1. Correctness: the key builder must match the independent reference, group for group.
      const samples = makeSamples();
      buildProcessedSearches(samples, {
        selectedCovariates: COVARIATES,
        qcColumn: QC_COLUMN,
        selectedQcValues: QC_VALUES,
        naPolicy: policy,
      });
      const producedGroups = sortedKeys(samples.map(s => s.covariateKey!));
      const referenceGroups = sortedKeys(RAW_SAMPLES.map(r => refKey(r, policy)));
      expect(producedGroups).toEqual(referenceGroups);

      // 2. Round-trip: serialize with a color per group, then parse/validate/load and re-derive.
      const settings = settingsFor(policy);
      const covariateColors = colorsForGroups(producedGroups);
      const text = serializeLayout({
        searches: samples,
        randomizedPlates: buildPlates(samples),
        settings,
        covariateColors,
      });

      const parsed = parseLayout(text);
      expect(parsed.structuralErrors).toEqual([]);
      // Colors correspond one-to-one with the groups, so validation is clean.
      expect(validateLayout(parsed)).toEqual([]);
      // The saved policy round-trips verbatim.
      expect(parsed.settings!.naPolicy).toEqual(policy);

      const { samples: loaded } = buildPlatesFromRows(parsed.rows, parsed.settings!);
      buildProcessedSearches(loaded, {
        selectedCovariates: parsed.settings!.selectedCovariates,
        qcColumn: parsed.settings!.qcColumn,
        selectedQcValues: parsed.settings!.selectedQcValues,
        naPolicy: parsed.settings!.naPolicy,
      });
      const reloadedGroups = sortedKeys(loaded.map(s => s.covariateKey!));

      // Exact reproduction: same groups after load, matching the stored colors one-to-one.
      expect(reloadedGroups).toEqual(producedGroups);
      expect(reloadedGroups).toEqual(sortedKeys(Object.keys(covariateColors)));
    }
  );

  it('rejects a layout whose colors do not cover every produced group', () => {
    // Fold nothing extra: na/NA/n/a stay distinct, so the samples form more groups than a color
    // map that only colors the folded (N/A) groups would cover. This is the drift that used to
    // render uncolored cells gray; validateLayout must now reject it.
    const foldNone: NaPolicy = { foldBlank: false, foldSpellings: [] };
    const samples = makeSamples();
    buildProcessedSearches(samples, {
      selectedCovariates: COVARIATES,
      qcColumn: QC_COLUMN,
      selectedQcValues: QC_VALUES,
      naPolicy: foldNone,
    });
    const producedGroups = sortedKeys(samples.map(s => s.covariateKey!));

    // Drop one group's color to simulate a colors/groups mismatch.
    const droppedGroup = producedGroups[0];
    const covariateColors = colorsForGroups(producedGroups.filter(g => g !== droppedGroup));

    const text = serializeLayout({
      searches: samples,
      randomizedPlates: buildPlates(samples),
      settings: settingsFor(foldNone),
      covariateColors,
    });
    const errors = validateLayout(parseLayout(text));
    expect(errors.some(e => e.fatal && e.message.includes(droppedGroup))).toBe(true);
  });
});
