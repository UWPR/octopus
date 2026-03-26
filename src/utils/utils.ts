import { SearchData, RandomizationAlgorithm, CovariateConfig, RepeatedMeasuresConfig } from './types';
import { QualityLevel, QUALITY_LEVEL_CONFIG } from './configs';
import Papa from 'papaparse';
import { balancedBlockRandomization } from '../algorithms/balancedRandomization';
import { greedyRandomization } from '../algorithms/greedyRandomization';
import { groupAwareRandomization } from '../algorithms/repeatedMeasuresDistribution';
// import { groupAwareDPRandomization } from '../algorithms/repeatedMeasuresDPDistribution';

// Utility functions
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a covariate key for a search sample, optionally including QC prefix
 * @param search - The search sample
 * @param config - Covariate configuration (treatment covariates and QC/Reference settings)
 * @returns Covariate key string (e.g., "QC|Balb_cJ|Control|0" or "Balb_cJ|Control|0")
 */
/**
 * Get the covariate key for a sample, throwing an error if not set
 * @param sample - The search sample
 * @returns The covariate key (includes QC prefix if applicable)
 * @throws Error if covariateKey is not set
 */
export function getCovariateKey(sample: SearchData): string {
  if (!sample.covariateKey) {
    throw new Error(`covariateKey not set for sample: ${sample.name}`);
  }
  return sample.covariateKey;
}

export function buildCovariateKey(
  search: SearchData,
  config: CovariateConfig
): string {
  const { selectedCovariates, qcColumn: qcColumn, selectedQcValues: selectedQcValues } = config;

  // Build the base covariate key
  const baseKey = selectedCovariates
    .map(cov => search.metadata[cov] || 'N/A')
    .join('|');

// Check if this sample is a QC sample and QC column is not in covariates
  if (qcColumn && selectedQcValues && selectedQcValues.length > 0
    && !selectedCovariates.includes(qcColumn))
   {
    const sampleValue = search.metadata[qcColumn];
    const isQC = sampleValue && selectedQcValues.includes(sampleValue);

    // Prepend QC value if sample is QC and QC column is not a covariate
    if (isQC) {
      return `${sampleValue}|${baseKey}`;
    }
  }

  return baseKey;
}

/**
 * Sort covariate combinations by count (descending), then alphabetically
 * @param combinations - Array of combination keys to sort
 * @param counts - Map of combination keys to their counts
 * @returns Sorted array of combination keys
 */
export function sortCombinationsByCountAndName(
  combinations: string[],
  counts: Map<string, number>
): string[] {
  return [...combinations].sort((a, b) => {
    const countA = counts.get(a) || 0;
    const countB = counts.get(b) || 0;

    // Sort by count descending
    if (countB !== countA) {
      return countB - countA;
    }

    // If counts are equal, sort alphabetically
    return a.localeCompare(b);
  });
}

/**
 * Calculate appropriate text color (white or black) based on background color luminance
 * Uses WCAG formula for relative luminance calculation
 */
export function getTextColorForBackground(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate relative luminance using WCAG formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return white for dark backgrounds, black for light backgrounds
  return luminance > 0.5 ? '#000' : '#fff';
}

export function groupByCovariates(searches: SearchData[], selectedCovariates: string[]): Map<string, SearchData[]> {
  const groups = new Map<string, SearchData[]>();

  searches.forEach(search => {
    // covariateKey should already be set by processMetadata
    if (!search.covariateKey) {
      throw new Error(`treatmentKey not set for sample: ${search.name}`);
    }
    const key = search.covariateKey;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(search);
  });

  return groups;
}


// Main randomization function with algorithm selection
export function randomizeSearches(
  searches: SearchData[],
  selectedCovariates: string[],
  algorithm: RandomizationAlgorithm = 'balanced',
  keepEmptyInLastPlate: boolean = true,
  numRows: number = 8,
  numColumns: number = 12,
  repeatedMeasuresConfig?: RepeatedMeasuresConfig
): {
  plates: (SearchData | undefined)[][][];
  plateAssignments?: Map<number, SearchData[]>;
} {
  // When a subject column is set, use group-aware randomization
  if (repeatedMeasuresConfig?.subjectColumn) {
    return groupAwareRandomization(
      searches,
      selectedCovariates,
      repeatedMeasuresConfig,
      keepEmptyInLastPlate,
      numRows,
      numColumns
    );
  }

  switch (algorithm) {
    case 'balanced':
      return balancedBlockRandomization(searches, selectedCovariates, keepEmptyInLastPlate, numRows, numColumns);
    case 'greedy':
    default:
      return greedyRandomization(searches, selectedCovariates);
  }
}


// Updated to accept idColumn parameter instead of hardcoding "search name"
export function downloadCSV(
  searches: SearchData[],
  randomizedPlates: (SearchData | undefined)[][][],
  idColumn: string,
  inputFileName?: string
) {
  const csv = Papa.unparse(
    searches.map((search) => ({
      [idColumn]: search.name, // Use the selected ID column name
      ...search.metadata,
      plate: getPlateNumber(search.name, randomizedPlates),
      well: getWell(search.name, randomizedPlates),
    })),
    { header: true }
  );

  // Generate output filename based on input filename
  let outputFileName = 'randomized_searches_octopus.csv';
  if (inputFileName) {
    const baseName = inputFileName.replace(/\.[^/.]+$/, ''); // Remove extension
    outputFileName = `${baseName}_octopus.csv`;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', outputFileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getPlateNumber(searchName: string, randomizedPlates: (SearchData | undefined)[][][]) {
  for (let plateIndex = 0; plateIndex < randomizedPlates.length; plateIndex++) {
    const plate = randomizedPlates[plateIndex];
    for (let rowIndex = 0; rowIndex < plate.length; rowIndex++) {
      const row = plate[rowIndex];
      if (row.find((search) => search?.name === searchName)) {
        return plateIndex + 1;
      }
    }
  }
  return '';
}

export function getWell(searchName: string, randomizedPlates: (SearchData | undefined)[][][]): string {
  for (let plateIndex = 0; plateIndex < randomizedPlates.length; plateIndex++) {
    const plate = randomizedPlates[plateIndex];
    for (let rowIndex = 0; rowIndex < plate.length; rowIndex++) {
      const row = plate[rowIndex];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        if (row[columnIndex]?.name === searchName) {
          const rowLabel = String.fromCharCode(65 + rowIndex); // A, B, C...
          const colLabel = (columnIndex + 1).toString().padStart(2, '0'); // 01, 02, 03...
          return `${rowLabel}${colLabel}`;
        }
      }
    }
  }
  return '';
}

export function getRowName(searchName: string, randomizedPlates: (SearchData | undefined)[][][]) {
  for (let plateIndex = 0; plateIndex < randomizedPlates.length; plateIndex++) {
    const plate = randomizedPlates[plateIndex];
    for (let rowIndex = 0; rowIndex < plate.length; rowIndex++) {
      const row = plate[rowIndex];
      if (row.find((search) => search?.name === searchName)) {
        return String.fromCharCode(65 + rowIndex);
      }
    }
  }
  return '';
}

export function getColumnNumber(searchName: string, randomizedPlates: (SearchData | undefined)[][][]) {
  for (let plateIndex = 0; plateIndex < randomizedPlates.length; plateIndex++) {
    const plate = randomizedPlates[plateIndex];
    for (let rowIndex = 0; rowIndex < plate.length; rowIndex++) {
      const row = plate[rowIndex];
      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        if (row[columnIndex]?.name === searchName) {
          return (columnIndex + 1).toString().padStart(2, '0');
        }
      }
    }
  }
  return '';
}
/**

 * Get color for quality score based on standardized thresholds
 * @param score - Quality score (0-100)
 * @returns Hex color code
 */
export const getQualityColor = (score: number): string => {
  return getQualityLevelColor(getQualityLevel(score));
};

/**
 * Get color for quality level string
 * @param level - Quality level ('excellent', 'good', 'fair', 'poor', 'bad')
 * @returns Hex color code
 */
export const getQualityLevelColor = (level: QualityLevel): string => {
  return QUALITY_LEVEL_CONFIG[level].color;
};

// Presorted quality levels by descending lowScore (highest to lowest) - computed once at module load
const QUALITY_LEVELS_BY_SCORE = Object.entries(QUALITY_LEVEL_CONFIG)
  .sort(([, a], [, b]) => b.lowScore - a.lowScore);

/**
 * Get quality level for a given score
 * @param score - Quality score (0-100)
 * @returns Quality level
 */
export const getQualityLevel = (score: number): QualityLevel => {
  // Round to 1 decimal place to match display formatting
  const roundedScore = Math.round(score * 10) / 10;

  // Find the first quality level where score >= lowScore
  for (const [levelKey, config] of QUALITY_LEVELS_BY_SCORE) {
    if (roundedScore >= config.lowScore) {
      return levelKey as QualityLevel;
    }
  }

  // Fallback to 'bad' if no match found (should never happen)
  return 'bad';
};

/**
 * Format a quality score for display with consistent decimal precision
 * @param score - Quality score (0-100)
 * @returns Formatted score string with 1 decimal place
 */
export const formatScore = (score: number): string => {
  return score.toFixed(1);
};

/**
 * Get compact quality level (first letter) for a given score
 * @param score - Quality score (0-100)
 * @returns Single uppercase letter representing quality level
 */
export const getCompactQualityLevel = (score: number): string => {
  return getCompactQualityLevelFromString(getQualityLevel(score));
};

/**
 * Get compact quality level from quality level string
 * @param level - Quality level string
 * @returns Single uppercase letter representing quality level
 */
export const getCompactQualityLevelFromString = (level: QualityLevel): string => {
  return QUALITY_LEVEL_CONFIG[level].shortLabel;
};

/**
 * Get all quality levels with their score ranges, badges, and descriptions
 * @returns Array of quality level information sorted by score (best to worst)
 */
export const getAllQualityLevels = () => {
  return QUALITY_LEVELS_BY_SCORE.map(([levelKey, config]) => ({
    range: `${config.lowScore}-${config.highScore}`,
    level: levelKey as QualityLevel,
    badge: config.shortLabel,
    description: config.name,
    color: config.color
  }));
};
