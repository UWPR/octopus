// Bright color palette with 24 distinct colors in 4 randomized subgroups
export const BRIGHT_COLOR_PALETTE = [
  // Subgroup 1
  '#FF0000', // Pure Red
  '#0000FF', // Pure Blue
  '#32CD32', // Lime Green
  '#FF8000', // Pure Orange
  '#FFFF00', // Pure Yellow
  '#FF00FF', // Magenta

  // Subgroup 2
  '#87CEEB', // Sky Blue
  '#8000FF', // Pure Purple
  '#FF1493', // Deep Pink
  '#006400', // Dark Forest Green
  '#4169E1', // Royal Blue
  '#20B2AA', // Light Sea Green


  // Subgroup 3
  '#F08080', // Light Coral
  '#40E0D0', // Turquoise
  '#D2691E', // Chocolate
  '#9370DB', // Medium Purple
  '#98FB98', // Pale Green
  '#C0C0C0', // Silver


  // Subgroup 4
  '#FF4500', // Orange Red
  '#483D8B', // Dark blue slate
  '#BA55D3', // Medium Orchid
  '#B8860B', // Dark Gold
  '#008B8B', // Dark Cyan
  '#FF69B4', // Hot Pink
];

// Bright color palette with 24 distinct colors in 4 randomized subgroups
export const QC_COLOR_PALETTE = [
  '#000000', // Black
  '#800080', // Purple
  '#000080', // Navy
  '#8B0000', // Dark Red
];


// Algorithm configuration with descriptions
export const ALGORITHM_CONFIG = {
  balanced: {
    name: 'Balanced Block Randomization',
    description: 'Proportional distribution across plates and within plate rows'
  },
  greedy: {
    name: 'Greedy Randomization',
    description: 'Greedy Randomization'
  }
} as const;


// Quality levels
export const QUALITY_LEVEL_CONFIG = {
  excellent: {
    name: 'Excellent',
    shortLabel: 'E',
    color: '#4caf50',      // Green
    lowScore: 90,
    highScore: 100
  },
  good: {
    name: 'Good',
    shortLabel: 'G',
    color: '#9ACD32',      // Greenish Yellow
    lowScore: 80,
    highScore: 89
  },
  fair: {
    name: 'Fair',
    shortLabel: 'F',
    color: '#ff9800',      // Orange
    lowScore: 70,
    highScore: 79
  },
  poor: {
    name: 'Poor',
    shortLabel: 'P',
    color: '#D2691E', // Chocolate
    lowScore: 60,
    highScore: 69
  },
  bad: {
    name: 'Bad',
    shortLabel: 'B',
    color: '#f44336',      // Red
    lowScore: 0,
    highScore: 59
  }
} as const;

export type QualityLevel = keyof typeof QUALITY_LEVEL_CONFIG;


// Quality display configuration
export interface QualityDisplayConfig {
  showRowScore: boolean;
  showClusteringScore: boolean;
}

// Default quality display configuration
export const DEFAULT_QUALITY_DISPLAY_CONFIG: QualityDisplayConfig = {
  showRowScore: false,
  showClusteringScore: true
};

// Global quality display configuration - change this flag to control row score visibility
export const QUALITY_DISPLAY_CONFIG: QualityDisplayConfig = {
  showRowScore: false,  // Set to false to hide row scores
  showClusteringScore: true
};

// Developer mode configuration
const getUrlParams = (): URLSearchParams => {
  return new URLSearchParams(window.location.search);
};

// Check if developer mode is enabled via URL parameter
// Usage: Add ?dev=true to the URL to enable developer features
export const isDeveloperMode = (): boolean => {
  // debugger;
  const params = getUrlParams();
  return params.get('dev') === 'true' || params.get('developer') === 'true';
};