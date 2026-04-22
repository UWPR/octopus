import React from 'react';
import { QualityMetrics } from '../utils/types';
import { QUALITY_DISPLAY_CONFIG } from '../utils/configs';
import { getQualityColor, getQualityLevelColor, getQualityLevel, getCompactQualityLevel, formatScore } from '../utils/utils';

interface QualityMetricsPanelProps {
  metrics: QualityMetrics | null;
  show: boolean;
  onClose: () => void;
  numPlates: number;
}

const QualityMetricsPanel: React.FC<QualityMetricsPanelProps> = ({
  metrics,
  show,
  onClose,
  numPlates
}) => {



  if (!show) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={handleOverlayClick}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Quality Assessment</h3>
          <button
            onClick={onClose}
            style={styles.modalCloseButton}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e9ecef'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            ×
          </button>
        </div>
        <div style={styles.modalBody}>
          {!metrics && (
            <div style={styles.loadingMessage}>
              <div style={styles.loadingIcon}>⏳</div>
              <div>Calculating quality metrics...</div>
              <div style={styles.loadingSubtext}>This may take a moment for large datasets</div>
            </div>
          )}

          {metrics && (
            <div style={styles.panel}>
              {/* Compact Quality Summary */}
              <div style={styles.compactSummarySection}>
                <div style={styles.compactOverallScore}>
                  <div style={styles.compactScoreValue}>

                    <span style={{
                      ...styles.compactScore,
                      color: getQualityLevelColor(metrics.overallQuality.level)
                    }}>
                      {formatScore(metrics.overallQuality.score)}
                    </span>
                    <span style={{
                      ...styles.fullQualityBadge,
                      backgroundColor: getQualityLevelColor(metrics.overallQuality.level)
                    }}>
                      {metrics.overallQuality.level.charAt(0).toUpperCase() + metrics.overallQuality.level.slice(1)}
                    </span>
                  </div>

                </div>
                <div style={styles.compactAverageScores}>
                  {numPlates > 1 && (
                  <div style={styles.compactScoreItem}>
                    <span style={styles.compactItemLabel}>Avg Balance:</span>
                    <span style={{
                      ...styles.compactItemValue,
                      color: getQualityColor(metrics.plateDiversity.averageBalanceScore)
                    }}>
                      {formatScore(metrics.plateDiversity.averageBalanceScore)}
                    </span>
                    <span style={{
                      ...styles.qualityBadge,
                      backgroundColor: getQualityLevelColor(getQualityLevel(metrics.plateDiversity.averageBalanceScore))
                    }}>
                      {getCompactQualityLevel(metrics.plateDiversity.averageBalanceScore)}
                    </span>
                  </div>
                  )}
                  {QUALITY_DISPLAY_CONFIG.showClusteringScore && (
                    <div style={styles.compactScoreItem}>
                      <span style={styles.compactItemLabel}>Avg Clustering Score:</span>
                      <span style={{
                        ...styles.compactItemValue,
                        color: getQualityColor(metrics.plateDiversity.averageClusteringScore)
                      }}>
                        {formatScore(metrics.plateDiversity.averageClusteringScore)}
                      </span>
                      <span style={{
                        ...styles.qualityBadge,
                        backgroundColor: getQualityLevelColor(getQualityLevel(metrics.plateDiversity.averageClusteringScore))
                      }}>
                        {getCompactQualityLevel(metrics.plateDiversity.averageClusteringScore)}
                      </span>
                    </div>
                  )}
                </div>
              </div>



              {/* Individual Plate Scores */}
              <div style={styles.plateScoresSection}>
                <h4 style={styles.sectionTitle}>Individual Plate Scores</h4>
                <div style={styles.plateScoresGrid}>
                  {metrics.plateDiversity.plateScores
                    .sort((a, b) => a.plateIndex - b.plateIndex) // Sort numerically by plate index
                    .map((plate) => (
                      <div key={plate.plateIndex} style={styles.plateScoreCard}>
                        <div style={styles.plateScoreHeader}>
                          <span style={styles.plateNumber}>Plate {plate.plateIndex + 1}</span>
                          <div style={styles.overallScoreContainer}>
                            <span style={{
                              ...styles.fullQualityBadge,
                              backgroundColor: getQualityLevelColor(getQualityLevel(plate.overallScore))
                            }}>
                              {getQualityLevel(plate.overallScore)}
                            </span>
                            <span style={{
                              ...styles.overallScoreValue,
                              color: getQualityColor(plate.overallScore)
                            }}>
                              {formatScore(plate.overallScore)}
                            </span>
                          </div>
                        </div>
                        <div style={styles.plateScoreDetails}>
                          {numPlates > 1 && (
                          <div style={styles.scoreItem}>
                            <span style={styles.scoreLabel}>Balance:</span>
                            <span style={{
                              ...styles.scoreValue,
                              color: getQualityColor(plate.balanceScore)
                            }}>
                              <span style={{
                                ...styles.qualityBadge,
                                backgroundColor: getQualityLevelColor(getQualityLevel(plate.balanceScore))
                              }}>
                                {getCompactQualityLevel(plate.balanceScore)}
                              </span>
                              {' '}{formatScore(plate.balanceScore)}
                            </span>
                          </div>
                          )}
                          {QUALITY_DISPLAY_CONFIG.showClusteringScore && (
                            <div style={styles.scoreItem}>
                              <span style={styles.scoreLabel}>Clustering Score:</span>
                              <span style={{
                                ...styles.scoreValue,
                                color: getQualityColor(plate.clusteringScore)
                              }}>
                                <span style={{
                                  ...styles.qualityBadge,
                                  backgroundColor: getQualityLevelColor(getQualityLevel(plate.clusteringScore))
                                }}>
                                  {getCompactQualityLevel(plate.clusteringScore)}
                                </span>
                                {' '}{formatScore(plate.clusteringScore)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Recommendations */}
              {metrics.overallQuality.recommendations.length > 0 && (
                <div style={styles.recommendationsSection}>
                  <h4 style={styles.sectionTitle}>Recommendations</h4>
                  <ul style={styles.recommendationsList}>
                    {metrics.overallQuality.recommendations.map((recommendation, index) => (
                      <li key={index} style={styles.recommendationItem}>
                        {recommendation}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    width: '80%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#f8f9fa',
    flexShrink: 0,
  },
  modalTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '700',
    color: '#333',
  },
  modalCloseButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#666',
    padding: '2px',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'background-color 0.2s ease',
  },
  modalBody: {
    padding: '16px',
    overflow: 'auto',
    flex: 1,
  },
  panel: {
    fontWeight: '600',
  },
  loadingMessage: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    color: '#666',
  },
  loadingIcon: {
    fontSize: '32px',
    marginBottom: '12px',
  },
  loadingSubtext: {
    fontSize: '12px',
    color: '#999',
    marginTop: '8px',
  },
  compactSummarySection: {
    marginBottom: '20px',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
  },
  compactOverallScore: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  compactScoreValue: {
    textAlign: 'center' as const,
  },
  compactScore: {
    fontSize: '24px',
    fontWeight: 'bold',
    display: 'block',
  },
  compactScoreLabel: {
    fontSize: '11px',
    color: '#666',
    marginTop: '2px',
  },

  compactAverageScores: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  compactScoreItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  compactItemLabel: {
    fontSize: '12px',
    color: '#666',
    minWidth: '100px',
  },
  compactItemValue: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#333',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
    marginBottom: '20px',
  },
  metricSection: {
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
    border: '1px solid #e9ecef',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  summaryMetrics: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  metricItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 8px',
    backgroundColor: '#fff',
    borderRadius: '3px',
    fontSize: '12px',
  },
  metricLabel: {
    color: '#666',
  },
  metricValue: {
    fontWeight: '600',
    color: '#333',
  },
  groupBreakdown: {
    padding: '4px 8px',
    backgroundColor: '#e3f2fd',
    borderRadius: '3px',
    fontSize: '11px',
  },
  breakdownText: {
    color: '#1565c0',
  },
  plateScoresSection: {
    marginBottom: '20px',
  },
  plateScoresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
  },
  plateScoreCard: {
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  plateScoreHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  plateNumber: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  overallScoreBadge: {
    padding: '2px 8px',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: '600',
  },
  overallScoreContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  overallQualityBadge: {
    padding: '2px 4px',
    borderRadius: '3px',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    display: 'inline-block',
    minWidth: '14px',
    textAlign: 'center' as const,
  },
  overallScoreValue: {
    fontSize: '13px',
    fontWeight: '600',
  },
  plateScoreDetails: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  scoreItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: '12px',
    color: '#666',
  },
  scoreValue: {
    fontSize: '12px',
    fontWeight: '600',
  },
  recommendationsSection: {
    padding: '12px',
    backgroundColor: '#e3f2fd',
    borderRadius: '4px',
    border: '1px solid #bbdefb',
  },
  recommendationsList: {
    margin: '0',
    paddingLeft: '16px',
  },
  recommendationItem: {
    fontSize: '12px',
    color: '#1565c0',
    marginBottom: '4px',
    lineHeight: '1.4',
  },
  qualityBadge: {
    padding: '1px 3px',
    borderRadius: '2px',
    color: '#fff',
    fontSize: '9px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    display: 'inline-block',
    minWidth: '12px',
    textAlign: 'center' as const,
  },
  fullQualityBadge: {
    padding: '2px 6px',
    borderRadius: '3px',
    color: '#fff',
    fontSize: '10px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    display: 'inline-block',
    marginLeft: '6px',
  },
};

export default QualityMetricsPanel;