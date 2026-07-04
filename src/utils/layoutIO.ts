import {
  SearchData,
  RandomizationAlgorithm,
  GroupingConstraint,
  CovariateColorInfo,
  NaPolicy,
  getAllAlgorithms,
} from './types';
import {
  getPlateNumber,
  getWell,
  getTextColorForBackground,
  buildProcessedSearches,
} from './utils';

/**
 * Save/load of a generated layout together with the settings that produced it.
 *
 * A layout file is a single JSON document:
 *   {
 *     "format": "octopus-layout",   // marker: identifies the file as an Octopus layout
 *     "schemaVersion": 1,           // integer; a newer version is refused
 *     "appVersion": "1.4.0",        // optional, provenance only
 *     "plateCount": 3,              // number of plates, enforced on load
 *     "settings": { ... },          // the user-chosen configuration (LayoutSettings)
 *     "covariateColors": { ... },   // required; key -> { color, fill }, one per covariate group
 *     "samples": [ { id, plate, well, metadata } ]
 *   }
 *
 * Reproduction restores the recorded placement DIRECTLY (parse plate/well -> grid). It never
 * re-runs randomization, which uses unseeded Math.random and could not reproduce a prior
 * layout. `covariateKey`/`isQC` are derived (recomputed from settings + metadata on load) and
 * `textColor` is recomputed from the color, so none of the three are stored.
 *
 * The file is validated strictly. parseLayout catches structural problems (wrong field types,
 * missing required fields, bad enums). A non-JSON file, or JSON without the Octopus marker, is
 * treated as "not a saved layout" (hasMarker false). validateLayout catches semantic problems
 * (well bounds, plate count, covariate and column consistency, etc.). Any problem is fatal and
 * the current app state is left unchanged.
 */

export const LAYOUT_SCHEMA_VERSION = 1;
export const LAYOUT_FORMAT = 'octopus-layout';

/** Fill-style tokens as stored in the file (single enum, replacing the two boolean flags). */
const FILL_TOKENS = ['solid', 'outline', 'stripes'] as const;
type FillToken = (typeof FILL_TOKENS)[number];

/** GroupingConstraint has no runtime enumeration, so list its literals for validation. */
const GROUPING_CONSTRAINTS: GroupingConstraint[] = ['none', 'same-plate', 'same-row'];

/** The user-chosen configuration that produced a layout. */
export interface LayoutSettings {
  selectedIdColumn: string;
  selectedCovariates: string[];
  qcColumn: string;
  selectedQcValues: string[];
  selectedAlgorithm: RandomizationAlgorithm;
  keepEmptyInLastPlate: boolean;
  plateRows: number;
  plateColumns: number;
  subjectColumn: string;
  groupingConstraint: GroupingConstraint;
  /** Metadata column names in display order, so re-exports keep stable column order. */
  metadataColumns: string[];
  /** Global N/A grouping choice, so a reloaded layout re-derives the same covariate groups. */
  naPolicy: NaPolicy;
}

export type CovariateColorMap = { [key: string]: CovariateColorInfo };

/** A single placement-table row, as parsed from the file. */
export interface LayoutRow {
  name: string;
  metadata: { [key: string]: string };
  plate: number;
  well: string;
}

export interface ParsedLayout {
  /**
   * True when the document is an object whose `format` is the Octopus marker. This is the
   * authoritative "is this a layout file" signal. A non-JSON file, or any JSON without the
   * marker, has hasMarker false and is not treated as a layout.
   */
  hasMarker: boolean;
  /** Schema version declared in the file, or null when absent/unreadable. */
  schemaVersion: number | null;
  /** App version recorded for provenance, or null when absent. */
  appVersion: string | null;
  /** Declared plate count, or null when absent/invalid. */
  plateCount: number | null;
  /** Settings from the file, or null when the settings object is missing/invalid. */
  settings: LayoutSettings | null;
  /** Colors from the file (required), or null when the covariateColors object is missing/invalid. */
  covariateColors: CovariateColorMap | null;
  /** Placement rows parsed from `samples` (empty when samples are missing/invalid). */
  rows: LayoutRow[];
  /**
   * Fatal problems found during the strict structural parse (bad JSON is not reported here -
   * it makes hasMarker false instead). When non-empty, validateLayout returns these and skips
   * the semantic checks.
   */
  structuralErrors: LayoutValidationError[];
}

export type LayoutValidationError =
  | { fatal: true; message: string }
  | { fatal: false; warning: string };

function fatal(message: string): LayoutValidationError {
  return { fatal: true, message };
}

// --- Small typed guards used by the strict parse ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function isStringMap(v: unknown): v is { [key: string]: string } {
  return isRecord(v) && Object.values(v).every((x) => typeof x === 'string');
}
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** Encode a covariate color's fill style as a single token. */
function fillToken(info: CovariateColorInfo): FillToken {
  if (info.useStripes) return 'stripes';
  if (info.useOutline) return 'outline';
  return 'solid';
}

/** Decode a fill token back into the outline/stripes flags. */
function fillFlags(token: FillToken): { useOutline: boolean; useStripes: boolean } {
  return {
    useOutline: token === 'outline',
    useStripes: token === 'stripes',
  };
}

/** Convert a 1-based plate number to a 0-based plate index. */
export function plateToIndex(plate: number): number {
  return plate - 1;
}

/**
 * Convert a well label ("A01") to 0-based row/column indices. Inverse of getWell in utils.
 * @throws Error if the well is malformed or outside the plate bounds.
 */
export function wellToIndices(
  well: string,
  plateRows: number,
  plateColumns: number
): { row: number; col: number } {
  const match = /^([A-Za-z])(\d+)$/.exec(well.trim());
  if (!match) {
    throw new Error(`Malformed well "${well}" (expected a letter followed by digits, e.g. "A01")`);
  }
  const row = match[1].toUpperCase().charCodeAt(0) - 65; // A -> 0
  const col = parseInt(match[2], 10) - 1; // 01 -> 0
  if (row < 0 || row >= plateRows) {
    throw new Error(`Well "${well}" row is outside the plate (${plateRows} rows)`);
  }
  if (col < 0 || col >= plateColumns) {
    throw new Error(`Well "${well}" column is outside the plate (${plateColumns} columns)`);
  }
  return { row, col };
}

// --- Serialize ---

/** Build the settings object as it appears in the file (short keys). */
function settingsToJson(s: LayoutSettings) {
  return {
    idColumn: s.selectedIdColumn,
    covariates: s.selectedCovariates,
    qcColumn: s.qcColumn,
    qcValues: s.selectedQcValues,
    algorithm: s.selectedAlgorithm,
    keepEmptyInLastPlate: s.keepEmptyInLastPlate,
    plateRows: s.plateRows,
    plateColumns: s.plateColumns,
    subjectColumn: s.subjectColumn,
    groupingConstraint: s.groupingConstraint,
    metadataColumns: s.metadataColumns,
    naPolicy: { foldBlank: s.naPolicy.foldBlank, foldSpellings: s.naPolicy.foldSpellings },
  };
}

/** Build a sample's metadata object with exactly the declared columns, in order. */
function pickMetadata(source: { [key: string]: string }, columns: string[]): { [key: string]: string } {
  const md: { [key: string]: string } = {};
  columns.forEach((col) => {
    const v = source[col];
    md[col] = v === undefined || v === null ? '' : String(v);
  });
  return md;
}

/**
 * Serialize a layout plus its settings and colors to the JSON document string. Samples are
 * emitted in `searches` order (the same order as Download CSV), each carrying its 1-based plate
 * number and well label. `plateCount` is derived from the plates grid.
 */
export function serializeLayout(options: {
  searches: SearchData[];
  randomizedPlates: (SearchData | undefined)[][][];
  settings: LayoutSettings;
  covariateColors: CovariateColorMap;
  /** App version that produced the file, recorded for provenance. */
  appVersion?: string;
}): string {
  const { searches, randomizedPlates, settings, covariateColors, appVersion } = options;

  // A layout must record a color for every covariate group, so grouping reloads exactly and the
  // load-time color check has something to verify against. Refuse to save without colors.
  const colorEntries = Object.entries(covariateColors);
  if (colorEntries.length === 0) {
    throw new Error('Cannot save layout: a layout must include the covariate colors, but none were provided.');
  }
  const covariateColorsJson = Object.fromEntries(
    colorEntries.map(([key, info]) => [key, { color: info.color, fill: fillToken(info) }])
  );

  const doc = {
    format: LAYOUT_FORMAT,
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    ...(appVersion ? { appVersion } : {}),
    plateCount: randomizedPlates.length,
    settings: settingsToJson(settings),
    covariateColors: covariateColorsJson,
    samples: searches.map((search) => {
      // getPlateNumber/getWell return '' when the sample is not on the grid. That must never be
      // written (plate has to be a positive integer), so fail the save rather than emit a file the
      // strict parser would reject.
      const plate = getPlateNumber(search.name, randomizedPlates);
      const well = getWell(search.name, randomizedPlates);
      if (typeof plate !== 'number' || well === '') {
        throw new Error(`Cannot save layout: sample "${search.name}" is not placed on any plate.`);
      }
      return {
        id: search.name,
        plate,
        well,
        metadata: pickMetadata(search.metadata, settings.metadataColumns),
      };
    }),
  };

  return JSON.stringify(doc, null, 2);
}

// --- Parse (strict, structural) ---

/** Validate and read the settings object. Returns the settings or the problems found. */
function parseSettings(raw: unknown): { value: LayoutSettings | null; errors: LayoutValidationError[] } {
  if (!isRecord(raw)) {
    return { value: null, errors: [fatal('The layout file is missing its "settings" object.')] };
  }
  const r = raw;
  const errors: LayoutValidationError[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(fatal(msg));
  };

  need(isNonEmptyString(r.idColumn), 'settings.idColumn must be a non-empty string.');
  need(isStringArray(r.covariates), 'settings.covariates must be an array of strings.');
  need(isString(r.qcColumn), 'settings.qcColumn must be a string.');
  need(isStringArray(r.qcValues), 'settings.qcValues must be an array of strings.');
  need(
    isString(r.algorithm) && getAllAlgorithms().includes(r.algorithm as RandomizationAlgorithm),
    `settings.algorithm must be one of: ${getAllAlgorithms().join(', ')}.`
  );
  need(typeof r.keepEmptyInLastPlate === 'boolean', 'settings.keepEmptyInLastPlate must be a boolean.');
  need(isPositiveInt(r.plateRows), 'settings.plateRows must be a positive integer.');
  need(isPositiveInt(r.plateColumns), 'settings.plateColumns must be a positive integer.');
  need(isString(r.subjectColumn), 'settings.subjectColumn must be a string.');
  need(
    isString(r.groupingConstraint) && GROUPING_CONSTRAINTS.includes(r.groupingConstraint as GroupingConstraint),
    `settings.groupingConstraint must be one of: ${GROUPING_CONSTRAINTS.join(', ')}.`
  );
  need(isStringArray(r.metadataColumns), 'settings.metadataColumns must be an array of strings.');
  const naPolicy = r.naPolicy;
  need(
    isRecord(naPolicy) && typeof naPolicy.foldBlank === 'boolean' && isStringArray(naPolicy.foldSpellings),
    'settings.naPolicy must be an object with a boolean foldBlank and a string-array foldSpellings.'
  );

  if (errors.length) return { value: null, errors };
  const validNaPolicy = naPolicy as { foldBlank: boolean; foldSpellings: string[] };
  return {
    value: {
      selectedIdColumn: r.idColumn as string,
      selectedCovariates: r.covariates as string[],
      qcColumn: r.qcColumn as string,
      selectedQcValues: r.qcValues as string[],
      selectedAlgorithm: r.algorithm as RandomizationAlgorithm,
      keepEmptyInLastPlate: r.keepEmptyInLastPlate as boolean,
      plateRows: r.plateRows as number,
      plateColumns: r.plateColumns as number,
      subjectColumn: r.subjectColumn as string,
      groupingConstraint: r.groupingConstraint as GroupingConstraint,
      metadataColumns: r.metadataColumns as string[],
      naPolicy: { foldBlank: validNaPolicy.foldBlank, foldSpellings: validNaPolicy.foldSpellings },
    },
    errors: [],
  };
}

/** Validate and read the optional covariateColors object. */
function parseColors(raw: unknown): { value: CovariateColorMap; errors: LayoutValidationError[] } {
  if (!isRecord(raw)) {
    return { value: {}, errors: [fatal('covariateColors must be an object.')] };
  }
  const errors: LayoutValidationError[] = [];
  const out: CovariateColorMap = {};
  Object.entries(raw).forEach(([key, v]) => {
    if (!isRecord(v)) {
      errors.push(fatal(`covariateColors["${key}"] must be an object.`));
      return;
    }
    const color = v.color;
    const fill = v.fill;
    if (!isString(color) || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      errors.push(fatal(`covariateColors["${key}"].color must be a #RRGGBB hex string.`));
      return;
    }
    if (!isString(fill) || !FILL_TOKENS.includes(fill as FillToken)) {
      errors.push(fatal(`covariateColors["${key}"].fill must be one of: ${FILL_TOKENS.join(', ')}.`));
      return;
    }
    out[key] = {
      color,
      ...fillFlags(fill as FillToken),
      textColor: getTextColorForBackground(color),
    };
  });
  return { value: out, errors };
}

/** Validate and read the samples array into placement rows. */
function parseSamples(raw: unknown): { value: LayoutRow[]; errors: LayoutValidationError[] } {
  if (!Array.isArray(raw)) {
    return { value: [], errors: [fatal('"samples" must be an array.')] };
  }
  if (raw.length === 0) {
    return { value: [], errors: [fatal('The layout contains no samples.')] };
  }
  const errors: LayoutValidationError[] = [];
  const rows: LayoutRow[] = [];
  raw.forEach((entry, i) => {
    if (!isRecord(entry)) {
      errors.push(fatal(`samples[${i}] must be an object.`));
      return;
    }
    const e = entry;
    if (!isNonEmptyString(e.id)) {
      errors.push(fatal(`samples[${i}].id must be a non-empty string.`));
      return;
    }
    if (!isPositiveInt(e.plate)) {
      errors.push(fatal(`Sample "${String(e.id)}" has an invalid plate (must be a positive integer).`));
      return;
    }
    if (!isNonEmptyString(e.well)) {
      errors.push(fatal(`Sample "${String(e.id)}" has an invalid well (must be a non-empty string).`));
      return;
    }
    if (!isStringMap(e.metadata)) {
      errors.push(fatal(`Sample "${String(e.id)}" has invalid metadata (must be an object of string values).`));
      return;
    }
    rows.push({ name: e.id, plate: e.plate, well: e.well, metadata: { ...e.metadata } });
  });
  return { value: rows, errors };
}

/**
 * Parse a JSON layout file into settings, colors, and placement rows, validating its structure
 * strictly. A non-JSON file, or JSON without the Octopus marker, returns hasMarker false and no
 * errors (the caller reports "not a saved Octopus layout"). A marked file with a structural
 * problem returns hasMarker true and one or more fatal structuralErrors.
 */
export function parseLayout(fileText: string): ParsedLayout {
  const base: ParsedLayout = {
    hasMarker: false,
    schemaVersion: null,
    appVersion: null,
    plateCount: null,
    settings: null,
    covariateColors: null,
    rows: [],
    structuralErrors: [],
  };

  let root: unknown;
  try {
    root = JSON.parse(fileText);
  } catch {
    return base; // not JSON -> not a layout file
  }

  if (!isRecord(root) || root.format !== LAYOUT_FORMAT) {
    return base; // no marker -> not a layout file
  }

  base.hasMarker = true;
  const errors: LayoutValidationError[] = [];

  // Schema version gate. An unreadable or newer version stops further structural parsing.
  const rawVersion = root.schemaVersion;
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    base.structuralErrors = [fatal('The layout file has an unreadable schema version.')];
    return base;
  }
  base.schemaVersion = rawVersion;
  if (rawVersion > LAYOUT_SCHEMA_VERSION) {
    base.structuralErrors = [
      fatal(
        `This layout was saved by a newer version of Octopus (schema version ${rawVersion}). ` +
          'Please update Octopus to load it.'
      ),
    ];
    return base;
  }

  base.appVersion = isString(root.appVersion) ? root.appVersion : null;

  if (isPositiveInt(root.plateCount)) {
    base.plateCount = root.plateCount;
  } else {
    errors.push(fatal('The layout file has an invalid plate count (must be a positive integer).'));
  }

  const settingsResult = parseSettings(root.settings);
  if (settingsResult.errors.length) errors.push(...settingsResult.errors);
  else base.settings = settingsResult.value;

  // covariateColors is required: a saved layout always records a color for every covariate group.
  if (root.covariateColors === undefined) {
    errors.push(fatal('The layout file is missing its "covariateColors" object.'));
  } else {
    const colorsResult = parseColors(root.covariateColors);
    if (colorsResult.errors.length) errors.push(...colorsResult.errors);
    else if (Object.keys(colorsResult.value).length === 0) {
      errors.push(fatal('The layout file records no covariate colors; a layout must color every covariate group.'));
    } else {
      base.covariateColors = colorsResult.value;
    }
  }

  const samplesResult = parseSamples(root.samples);
  if (samplesResult.errors.length) errors.push(...samplesResult.errors);
  else base.rows = samplesResult.value;

  base.structuralErrors = errors;
  return base;
}

// --- Build plates ---

/**
 * Rebuild the plates grid and plateAssignments map from parsed placement rows.
 * Metadata is rebuilt in the settings' metadataColumns order so re-exports stay stable.
 * Assumes the rows have already passed validateLayout.
 */
export function buildPlatesFromRows(
  rows: LayoutRow[],
  settings: LayoutSettings
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments: Map<number, SearchData[]>;
  /** All placed samples in file-row order (same object references held by the plates). */
  samples: SearchData[];
} {
  const { plateRows, plateColumns, metadataColumns } = settings;
  const numPlates = rows.reduce((max, r) => Math.max(max, r.plate), 0);

  const plates: (SearchData | undefined)[][][] = Array.from({ length: numPlates }, () =>
    Array.from({ length: plateRows }, () =>
      Array.from({ length: plateColumns }, () => undefined as SearchData | undefined)
    )
  );
  const plateAssignments = new Map<number, SearchData[]>();
  const samples: SearchData[] = [];

  rows.forEach((row) => {
    // Rebuild metadata in the recorded column order.
    const metadata: { [key: string]: string } = {};
    metadataColumns.forEach((col) => {
      if (col in row.metadata) metadata[col] = row.metadata[col];
    });
    // Include any extra metadata columns not listed (defensive), preserving their values.
    Object.keys(row.metadata).forEach((col) => {
      if (!(col in metadata)) metadata[col] = row.metadata[col];
    });

    const sample: SearchData = { name: row.name, metadata };
    samples.push(sample);
    const plateIndex = plateToIndex(row.plate);
    const { row: r, col: c } = wellToIndices(row.well, plateRows, plateColumns);
    plates[plateIndex][r][c] = sample;

    const assigned = plateAssignments.get(plateIndex) ?? [];
    assigned.push(sample);
    plateAssignments.set(plateIndex, assigned);
  });

  return { plates, plateAssignments, samples };
}

// --- Validate (semantic) ---

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/**
 * Validate a parsed layout before applying it. Structural problems (from parseLayout) are
 * returned first and short-circuit the semantic checks. The semantic checks enforce that the
 * recorded placement is internally consistent and matches the recorded settings:
 *   - every well is inside the plate dimensions and no two samples share a well,
 *   - plates 1..plateCount each hold at least one sample (a missing/empty plate is rejected),
 *   - no duplicate sample ids,
 *   - covariates are a subset of the metadata columns and every sample carries exactly the
 *     declared metadata columns,
 *   - the QC and subject columns are declared columns and mutually exclusive,
 *   - every stored covariate color corresponds to a covariate combination the samples produce.
 * Returns all problems found; the caller aborts on any fatal error.
 */
export function validateLayout(parsed: ParsedLayout): LayoutValidationError[] {
  if (parsed.structuralErrors.length > 0) return parsed.structuralErrors;
  if (!parsed.settings || parsed.plateCount === null) {
    return [fatal('The layout file is missing settings, so it cannot be reproduced.')];
  }

  const s = parsed.settings;
  const plateCount = parsed.plateCount;
  const { plateRows, plateColumns } = s;
  const errors: LayoutValidationError[] = [];

  // Column integrity: covariates, QC, and subject columns must be declared metadata columns.
  const metaSet = new Set(s.metadataColumns);
  s.selectedCovariates.forEach((cov) => {
    if (!metaSet.has(cov)) {
      errors.push(fatal(`Covariate column "${cov}" is not one of the layout's metadata columns.`));
    }
  });
  if (s.qcColumn && !metaSet.has(s.qcColumn)) {
    errors.push(fatal(`QC column "${s.qcColumn}" is not one of the layout's metadata columns.`));
  }
  if (s.subjectColumn) {
    if (!metaSet.has(s.subjectColumn)) {
      errors.push(fatal(`Subject column "${s.subjectColumn}" is not one of the layout's metadata columns.`));
    }
    if (s.selectedCovariates.includes(s.subjectColumn)) {
      errors.push(fatal(`Subject column "${s.subjectColumn}" cannot also be a covariate.`));
    }
    if (s.subjectColumn === s.qcColumn) {
      errors.push(fatal(`Subject column "${s.subjectColumn}" cannot also be the QC column.`));
    }
  }

  // Per-sample checks: plate range, well bounds, single occupancy, metadata columns, duplicates.
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const occupied = new Set<string>();
  const platesWithSamples = new Set<number>();

  parsed.rows.forEach((row) => {
    if (seenNames.has(row.name)) duplicateNames.add(row.name);
    seenNames.add(row.name);

    if (!Number.isInteger(row.plate) || row.plate < 1 || row.plate > plateCount) {
      errors.push(
        fatal(`Sample "${row.name}" is on plate ${row.plate}, outside the layout's ${plateCount} plate(s).`)
      );
      return; // a bad plate makes the well key meaningless
    }
    platesWithSamples.add(row.plate);

    try {
      const { row: r, col: c } = wellToIndices(row.well, plateRows, plateColumns);
      const key = `${row.plate}:${r}:${c}`;
      if (occupied.has(key)) {
        errors.push(fatal(`Two samples occupy plate ${row.plate} well ${row.well}.`));
      }
      occupied.add(key);
    } catch (e) {
      errors.push(fatal(`Sample "${row.name}": ${(e as Error).message}`));
    }

    if (!sortedEqual(Object.keys(row.metadata), s.metadataColumns)) {
      errors.push(
        fatal(
          `Sample "${row.name}" has metadata columns [${Object.keys(row.metadata).join(', ')}] ` +
            `but the layout declares [${s.metadataColumns.join(', ')}].`
        )
      );
    }
  });

  if (duplicateNames.size > 0) {
    errors.push(fatal(`Duplicate sample name(s): ${Array.from(duplicateNames).join(', ')}`));
  }

  // Every declared plate must hold at least one sample. Each sample's plate was already checked to
  // be an integer in 1..plateCount, so the distinct plates that have samples number at most
  // plateCount and equal it exactly when none is empty (which also forces min plate 1 and max
  // plate plateCount). Comparing the set size avoids looping over plateCount, so a corrupt (huge)
  // plate count is rejected in O(1) instead of stalling the load.
  const distinctPlateCount = platesWithSamples.size;
  if (distinctPlateCount !== plateCount) {
    errors.push(
      fatal(
        `The layout declares ${plateCount} plate(s) but samples appear on ${distinctPlateCount} ` +
          `distinct plate(s). Every plate must have at least one sample.`
      )
    );
  }

  // Covariate-color consistency: the stored colors must correspond exactly to the covariate
  // groups the samples produce under the selected covariates and the saved N/A policy. Both
  // directions are enforced so a reloaded layout reproduces the file's grouping exactly:
  //   - every stored color must key a real group (no orphan colors), and
  //   - every produced group must have a stored color (no uncolored groups rendered gray).
  if (parsed.covariateColors) {
    const colors = parsed.covariateColors;
    const samples: SearchData[] = parsed.rows.map((r) => ({ name: r.name, metadata: r.metadata }));
    buildProcessedSearches(samples, {
      selectedCovariates: s.selectedCovariates,
      qcColumn: s.qcColumn,
      selectedQcValues: s.selectedQcValues,
      naPolicy: s.naPolicy,
    });
    const derivedKeys = new Set(samples.map((x) => x.covariateKey as string));
    const colorKeys = Object.keys(colors);
    colorKeys.forEach((key) => {
      if (!derivedKeys.has(key)) {
        errors.push(
          fatal(
            `The layout has a color for "${key}", which no sample produces under the selected covariates.`
          )
        );
      }
    });
    derivedKeys.forEach((key) => {
      if (!(key in colors)) {
        errors.push(
          fatal(
            `The layout produces the covariate group "${key}" but stores no color for it ` +
              `(the samples form ${derivedKeys.size} groups but the file records ${colorKeys.length} colors).`
          )
        );
      }
    });
  }

  return errors;
}
