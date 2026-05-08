/**
 * Types for the Injection Sequence Export feature.
 * Used by the wizard hook, UI components, and sequence generation utilities.
 */

/** Autosampler slot colors — four physical tray positions */
export type SlotColor = 'Y' | 'B' | 'R' | 'G';

/** Map from sample name → category label */
export interface SampleCategoryConfig {
  assignments: Record<string, string>;
  /** All available category labels (e.g., ["Experimental", "BatchQC", "BatchRef"]) */
  categories: string[];
}

/** System suitability run configuration */
export interface SystemSuitabilityConfig {
  enabled: boolean;
  /** Number of SS runs before experimental samples (0–10) */
  runsAtStart: number;
  /** Number of SS runs after all experimental samples (0–10) */
  runsAtEnd: number;
  /** Number of SS runs to insert during experiment */
  runsDuring: number;
  /** Number of experimental samples between each SS insertion */
  insertionInterval: number;
  /** Folder path for SS data files */
  path: string;
  /** Instrument method path for SS runs */
  instrumentMethod: string;
  /** Injection volume for SS runs (µL) */
  injectionVolume: number;
  /** Sample identifier used in SS filenames (default: "SS") */
  sampleIdentifier: string;
}

/** Plate-to-slot mapping */
export interface SlotAssignment {
  /** Which slot is used for SS vial (null if SS disabled) */
  ssSlot: SlotColor | null;
  /** Well position for SS vial within the slot (e.g., "A1") */
  ssWell: string;
  /** Map from plate index (0-based) → assigned slot */
  plateSlots: Record<number, SlotColor>;
}

/** Per-category path, method, and volume settings */
export interface CategorySettings {
  path: string;
  instrumentMethod: string;
  injectionVolume: number;
}

/** Paths and methods configuration for all categories */
export interface PathsMethodsConfig {
  categorySettings: Record<string, CategorySettings>;
}

/** How sample IDs are represented in filenames */
export type SampleIdMode = 'original' | 'serial';

/** Configuration for serial ID generation */
export interface SerialIdConfig {
  prefix: string;
  startNumber: number;
}

/** A field available for inclusion in the filename template */
export interface FilenameField {
  id: string;
  label: string;
  /** For free-text fields (project, experiment, instrument): the user-entered value */
  value?: string;
}

/** Separator character for filename fields */
export type SeparatorChar = '-' | '_' | '.' | string;

/** File naming template configuration */
export interface FileNamingConfig {
  /** Ordered list of selected fields */
  selectedFields: FilenameField[];
  separator: SeparatorChar;
  sampleIdMode: SampleIdMode;
  serialIdConfig: SerialIdConfig;
  /** Whether to generate a mapping CSV when serial IDs are used */
  generateMappingFile: boolean;
}

/** A single row in the generated injection sequence */
export interface SequenceRow {
  fileName: string;
  path: string;
  instrumentMethod: string;
  position: string;
  injectionVolume: number;
  /** Metadata for preview display — category label */
  category: string;
  /** 1-based global run number */
  runNumber: number;
  /** Original sample ID (for mapping CSV); empty for SS rows */
  originalSampleId: string;
  /** Plate number (1-based); null for SS rows */
  plateNumber: number | null;
  /** Well position (e.g., "A01"); empty for SS rows */
  wellPosition: string;
}

/** The complete generated sequence output */
export interface GeneratedSequence {
  rows: SequenceRow[];
  /** Breakdown of row counts by category */
  categoryCounts: Record<string, number>;
  totalRuns: number;
  /** Total non-SS sample count (used for serial ID padding) */
  totalSampleCount: number;
}

/** Mapping between serial IDs and original sample IDs */
export interface IdMapping {
  serialId: string;
  originalSampleId: string;
  plateNumber: number;
  wellPosition: string;
}

/** Regex matching characters unsafe for Windows filenames */
export const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/;
