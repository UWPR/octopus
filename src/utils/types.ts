import { ALGORITHM_CONFIG, QUALITY_LEVEL_CONFIG, QualityLevel, isDeveloperMode } from './configs';

// Block types for distribution algorithms
export enum BlockType {
  PLATE = 'Plate',
  ROW = 'Row'
}

export interface SearchData {
  name: string;
  metadata: { [key: string]: string };
  covariateKey?: string;  // Covariate combination key, calculated based on selected covariates
  isQC?: boolean;  // Whether this sample is a QC/Reference sample
}

export interface CovariateConfig {
  selectedCovariates: string[];  // Treatment covariate column names
  qcColumn?: string;  // QC/Reference column name
  selectedQcValues?: string[];  // QC/Reference values
}

export type RandomizationAlgorithm = keyof typeof ALGORITHM_CONFIG;

// Utility functions for algorithm configuration
export const getAlgorithmName = (algorithm: RandomizationAlgorithm): string =>
  ALGORITHM_CONFIG[algorithm].name;

export const getAlgorithmDescription = (algorithm: RandomizationAlgorithm): string =>
  ALGORITHM_CONFIG[algorithm].description;

export const getAllAlgorithms = (): RandomizationAlgorithm[] =>
  Object.keys(ALGORITHM_CONFIG) as RandomizationAlgorithm[];

// Get algorithms in UI display order
export const getAlgorithmsInDisplayOrder = (): RandomizationAlgorithm[] => {
  const algorithms: RandomizationAlgorithm[] = ['balanced'];

  // Show all algorithms in developer mode, otherwise show only the base algorithm
  if (isDeveloperMode()) {
    return ['balanced', 'greedy'] as RandomizationAlgorithm[];
  }

  return algorithms;
};

export interface SummaryItem {
  combination: string;
  values: { [key: string]: string };
  count: number;
  color: string;
  useOutline: boolean;
  useStripes: boolean;
  qcColumnValue?: string; // Value from the QC column if applicable
}

export interface CovariateColorInfo {
  color: string;
  useOutline: boolean;
  useStripes: boolean;
  textColor: string; // Pre-calculated text color for readability (white or black)
}

export interface PlateQualityScore {
  plateIndex: number;
  balanceScore: number; // 0-100 (Proportional Accuracy)
  clusteringScore: number; // 0 - 100 (clustering: row, column and cross-row)
  rowClusteringScore: number; // 0-100 (Row Clustering)
  overallScore: number; // 0-100 (Average of scores)
  rowScores?: number[]; // Individual row scores (0-100)
  covariateGroupBalance: {
    [combination: string]: {
      actualCount: number;
      expectedCount: number;
      actualProportion: number;
      expectedProportion: number;
      relativeDeviation: number;
      weightedDeviation: number;
      balanceScore: number
    }
  };
}

export interface PlateDiversityMetrics {
  averageBalanceScore: number; // 0-100
  averageClusteringScore: number; // 0 - 100
  averageRowClusteringScore: number; // 0-100
  plateScores: PlateQualityScore[];
}

export interface OverallQualityAssessment {
  score: number; // 0-100
  level: QualityLevel;
  recommendations: string[];
}

export interface QualityMetrics {
  plateDiversity: PlateDiversityMetrics;
  overallQuality: OverallQualityAssessment;
}


// Repeated-Measures Grouping Constraints
export type GroupingConstraint = 'none' | 'same-plate' | 'same-row';

export interface RepeatedMeasuresConfig {
  subjectColumn: string | null;
  groupingConstraint: GroupingConstraint;
}

export interface SubjectGroup {
  subjectId: string;
  samples: SearchData[];
  size: number;
}

export interface GroupValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
