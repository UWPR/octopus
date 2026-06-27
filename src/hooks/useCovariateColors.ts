import { useState, useCallback } from 'react';
import { SearchData, SummaryItem, CovariateColorInfo } from '../utils/types';
import { getTextColorForBackground, sortCombinationsByCountAndName, getCovariateKey } from '../utils/utils';
import { BRIGHT_COLOR_PALETTE, QC_COLOR_PALETTE } from '../utils/configs';

/**
 * Check if all samples in a combination are QCs
 * @param searches - All search samples
 * @param combination - The combination key to check
 * @returns true if all samples with this combination are QC / refernece samples
 */
function isQcCombination(searches: SearchData[], combination: string): boolean {
  const samplesInCombination = searches.filter(search => search.covariateKey === combination);
  return samplesInCombination.length > 0 && samplesInCombination.every(search => search.isQC);
}

export function useCovariateColors() {
  const [covariateColors, setCovariateColors] = useState<{ [key: string]: CovariateColorInfo }>({});
  const [summaryData, setSummaryData] = useState<SummaryItem[]>([]);

  const generateCovariateColors = useCallback((
    searches: SearchData[],
    selectedCovariates: string[],
    qcColumn?: string,
    selectedQcValues?: string[]
  ) => {
    if (selectedCovariates.length > 0 && searches.length > 0) {
      // Group searches by covariate combinations and count them
      // covariateKey should always be set by processMetadata
      const combinationCounts = new Map<string, number>();
      searches.forEach((search) => {
        const combination = getCovariateKey(search);
        combinationCounts.set(combination, (combinationCounts.get(combination) || 0) + 1);
      });

      // Separate QC combinations from regular combinations
      const qcCombinations: string[] = [];
      const regularCombinations: string[] = [];

      Array.from(combinationCounts.keys()).forEach((combination) => {
        if (isQcCombination(searches, combination)) {
          qcCombinations.push(combination);
        } else {
          regularCombinations.push(combination);
        }
      });

      // Sort QC combinations by count (descending), then alphabetically
      const sortedQcCombinations = sortCombinationsByCountAndName(qcCombinations, combinationCounts);

      // Sort regular combinations by count (descending), then alphabetically
      const sortedRegularCombinations = sortCombinationsByCountAndName(regularCombinations, combinationCounts);

      // Assign colors in the new order
      const covariateColorsMap: { [key: string]: CovariateColorInfo } = {};

      // debugger; // 🔍 BREAKPOINT: Check QC color assignment logic
      sortedQcCombinations.forEach((combination, colorIndex) => {
        const paletteIndex = colorIndex % QC_COLOR_PALETTE.length;
        const cycle = Math.floor(colorIndex / QC_COLOR_PALETTE.length);
        const color = QC_COLOR_PALETTE[paletteIndex];

        covariateColorsMap[combination] = {
          color: color,
          useOutline: cycle === 1, // Second cycle uses outline
          useStripes: cycle === 0,  // First cycle uses diagonal lines
          textColor: getTextColorForBackground(color) // Pre-calculate text color
        };
      });

      sortedRegularCombinations.forEach((combination, colorIndex) => {
        const paletteIndex = colorIndex % BRIGHT_COLOR_PALETTE.length;
        const cycle = Math.floor(colorIndex / BRIGHT_COLOR_PALETTE.length);
        const color = BRIGHT_COLOR_PALETTE[paletteIndex];

        covariateColorsMap[combination] = {
          color: color,
          useOutline: cycle === 1, // Second cycle (25-48)
          useStripes: cycle === 2,  // Third cycle (49-72)
          textColor: getTextColorForBackground(color) // Pre-calculate text color
        };
      });

      setCovariateColors(covariateColorsMap);
      return covariateColorsMap;
    }
    return {};
  }, []);

  // Generate summary data for the panel
  const generateSummaryData = useCallback((
    colors: { [key: string]: CovariateColorInfo },
    searches: SearchData[],
    selectedCovariates: string[],
    qcColumn?: string,
    selectedQcValues?: string[]
  ) => {
    if (selectedCovariates.length > 0 && searches.length > 0) {
      // Group searches by their covariate combinations using getCovariateKey
      const combinationsMap = new Map<string, {
        values: { [key: string]: string };
        count: number;
        qcColumnValue?: string;
      }>();

      searches.forEach((search) => {
        const covariateValues: { [key: string]: string } = {};
        selectedCovariates.forEach((covariate) => {
          covariateValues[covariate] = search.metadata[covariate] || 'N/A';
        });

        // covariateKey should always be set
        const combinationKey = getCovariateKey(search);

        if (combinationsMap.has(combinationKey)) {
          const existing = combinationsMap.get(combinationKey)!;
          existing.count++;
        } else {
          // Get QC column value if QC column is selected
          let qcValue: string | undefined = undefined;
          if (qcColumn) {
            qcValue = search.metadata[qcColumn] || undefined;
          }

          combinationsMap.set(combinationKey, {
            values: covariateValues,
            count: 1,
            qcColumnValue: qcValue
          });
        }
      });

      // Convert to summary data with colors
      const summary: SummaryItem[] = Array.from(combinationsMap.entries()).map(([combinationKey, data]) => {
        const colorInfo = colors[combinationKey] || {
          color: '#cccccc',
          useOutline: false,
          useStripes: false,
          textColor: '#000' // Default gray is light, so use black text
        };
        return {
          combination: combinationKey, // Use the same key format as colors
          values: data.values,
          count: data.count,
          color: colorInfo.color,
          useOutline: colorInfo.useOutline,
          useStripes: colorInfo.useStripes,
          qcColumnValue: data.qcColumnValue
        };
      });

      // Separate QCs and regular combinations for sorting
      const qcSummary: SummaryItem[] = [];
      const regularSummary: SummaryItem[] = [];

      summary.forEach(item => {
        if (isQcCombination(searches, item.combination)) {
          qcSummary.push(item);
        } else {
          regularSummary.push(item);
        }
      });

      // Create count maps for sorting
      const qcCounts = new Map(qcSummary.map(item => [item.combination, item.count]));
      const regularCounts = new Map(regularSummary.map(item => [item.combination, item.count]));

      // Sort each group using the common helper
      const sortedQcKeys = sortCombinationsByCountAndName(
        qcSummary.map(item => item.combination),
        qcCounts
      );
      const sortedRegularKeys = sortCombinationsByCountAndName(
        regularSummary.map(item => item.combination),
        regularCounts
      );

      // Rebuild summary in sorted order: QCs first, then regular
      const sortedSummary: SummaryItem[] = [];
      sortedQcKeys.forEach(key => {
        const item = qcSummary.find(s => s.combination === key);
        if (item) sortedSummary.push(item);
      });
      sortedRegularKeys.forEach(key => {
        const item = regularSummary.find(s => s.combination === key);
        if (item) sortedSummary.push(item);
      });

      setSummaryData(sortedSummary);
      return sortedSummary;

    }
    return [];
  }, []);

  const resetColors = () => {
    setCovariateColors({});
    setSummaryData([]);
  };

  /**
   * Restore covariate colors from a saved layout, preserving any manual color/fill edits.
   * Callers should follow with generateSummaryData so the summary swatches stay in sync.
   */
  const restoreColors = useCallback((colorsMap: { [key: string]: CovariateColorInfo }) => {
    setCovariateColors(colorsMap);
  }, []);

  const updateCovariateColor = useCallback((
    combination: string,
    updates: { color?: string; useOutline?: boolean; useStripes?: boolean }
  ) => {
    setCovariateColors(prev => {
      const existing = prev[combination];
      if (!existing) return prev;
      const newColor = updates.color ?? existing.color;
      const updated: CovariateColorInfo = {
        ...existing,
        color: newColor,
        useOutline: updates.useOutline ?? existing.useOutline,
        useStripes: updates.useStripes ?? existing.useStripes,
        textColor: updates.color ? getTextColorForBackground(newColor) : existing.textColor,
      };
      return { ...prev, [combination]: updated };
    });
    // Also update summaryData to keep swatches in sync
    setSummaryData(prev => prev.map(item => {
      if (item.combination !== combination) return item;
      return {
        ...item,
        color: updates.color ?? item.color,
        useOutline: updates.useOutline ?? item.useOutline,
        useStripes: updates.useStripes ?? item.useStripes,
      };
    }));
  }, []);

  return {
    covariateColors,
    summaryData,
    generateCovariateColors,
    generateSummaryData,
    resetColors,
    restoreColors,
    updateCovariateColor,
  };
}