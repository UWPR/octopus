import { useState, useCallback, useMemo } from 'react';
import { SearchData, QualityMetrics, GroupingConstraint } from '../utils/types';
import { QUALITY_DISPLAY_CONFIG } from '../utils/configs';

import { calculateQualityMetrics } from '../utils/qualityMetrics';

/**
 * Custom hook for managing quality metrics calculation and state
 *
 * Provides:
 * - Quality metrics calculation
 * - Caching and memoization
 * - Loading states
 * - Error handling
 */
export function useQualityMetrics() {
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [showMetrics, setShowMetrics] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calculate quality metrics for the current randomization
   */
  const calculateMetrics = useCallback(async (
    searches: SearchData[],
    randomizedPlates: (SearchData | undefined)[][][],
    plateAssignments: Map<number, SearchData[]> | undefined,
    selectedCovariates: string[],
    groupingConstraint?: GroupingConstraint
  ) => {
    if (!searches.length || !selectedCovariates.length || !plateAssignments || !plateAssignments.size) {
      setMetrics(null);
      return;
    }

    setIsCalculating(true);
    setError(null);

    try {
      const qualityMetrics = calculateQualityMetrics(
        searches,
        plateAssignments,
        randomizedPlates,
        selectedCovariates,
        QUALITY_DISPLAY_CONFIG,
        groupingConstraint
      );

      setMetrics(qualityMetrics);
      setIsCalculating(false);
    } catch (err) {
      console.error('Error calculating quality metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to calculate quality metrics');
      setIsCalculating(false);
    }
  }, []);

  /**
   * Reset metrics state
   */
  const resetMetrics = useCallback(() => {
    setMetrics(null);
    setError(null);
    setIsCalculating(false);
  }, []);

  /**
   * Toggle metrics panel visibility
   */
  const toggleMetrics = useCallback(() => {
    setShowMetrics(prev => !prev);
  }, []);

  /**
   * Get quality summary for display in other components
   */
  const qualitySummary = useMemo(() => {
    if (!metrics) return null;

    return {
      overallScore: metrics.overallQuality.score,
      qualityLevel: metrics.overallQuality.level,
      hasIssues: metrics.overallQuality.recommendations.some(rec =>
        rec.includes('re-randomization') ||
        rec.includes('poor balance') ||
        rec.includes('Low plate')
      ),
      criticalIssues: metrics.overallQuality.recommendations.filter(rec =>
        rec.includes('re-randomization') || rec.includes('systematic imbalance')
      ).length,
      totalRecommendations: metrics.overallQuality.recommendations.length
    };
  }, [metrics]);

  /**
   * Get plate-specific quality indicators
   */
  const plateQuality = useMemo(() => {
    if (!metrics) return {};

    const quality: { [plateIndex: string]: { score: number; status: 'good' | 'warning' | 'poor' } } = {};

    metrics.plateDiversity.plateScores.forEach((plate) => {
      let status: 'good' | 'warning' | 'poor';
      if (plate.overallScore >= 80) status = 'good';
      else if (plate.overallScore >= 65) status = 'warning';
      else status = 'poor';

      quality[`plate-${plate.plateIndex}`] = {
        score: plate.overallScore,
        status
      };
    });

    return quality;
  }, [metrics]);



  /**
   * Get performance insights
   */
  const performanceInsights = useMemo(() => {
    if (!metrics) return null;

    const insights = {
      bestPlates: [] as number[],
      worstPlates: [] as number[],
      averageBalanceScore: metrics.plateDiversity.averageBalanceScore,
      // averageRowClusteringScore: metrics.plateDiversity.averageRowClusteringScore,
      overallConsistency: metrics.overallQuality.score
    };

    // Find best and worst performing plates
    const sortedPlates = [...metrics.plateDiversity.plateScores]
      .sort((a, b) => b.overallScore - a.overallScore);

    insights.bestPlates = sortedPlates.slice(0, 2).map(plate => plate.plateIndex);
    insights.worstPlates = sortedPlates.slice(-2).map(plate => plate.plateIndex);

    return insights;
  }, [metrics]);

  return {
    // State
    metrics,
    isCalculating,
    showMetrics,
    error,

    // Actions
    calculateMetrics,
    resetMetrics,
    toggleMetrics,

    // Computed values
    qualitySummary,
    plateQuality,
    performanceInsights,

    // Convenience getters
    hasMetrics: !!metrics,
    isGoodQuality: metrics ? metrics.overallQuality.score >= 75 : false,
    isExcellentQuality: metrics ? metrics.overallQuality.score >= 90 : false
  };
}