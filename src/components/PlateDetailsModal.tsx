import React from 'react';
import { SearchData, CovariateColorInfo, PlateQualityScore } from '../utils/types';
import { QUALITY_DISPLAY_CONFIG } from '../utils/configs';
import { getCovariateKey, getQualityColor, getCompactQualityLevel, formatScore } from '../utils/utils';

interface PlateDetailsModalProps {
  show: boolean;
  plateIndex: number | null;
  plateAssignments?: Map<number, SearchData[]>;
  searches: SearchData[];
  selectedCovariates: string[];
  covariateColors: { [key: string]: CovariateColorInfo };
  selectedCombination: string | null;
  plateRows: number;
  plateColumns: number;
  modalPosition: { x: number; y: number };
  isDraggingModal: boolean;
  onClose: () => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  plateQuality?: PlateQualityScore;
  randomizedPlates?: (SearchData | undefined)[][][];
  numPlates?: number;
}

const PlateDetailsModal: React.FC<PlateDetailsModalProps> = ({
  show,
  plateIndex,
  plateAssignments,
  searches,
  selectedCovariates,
  covariateColors,
  selectedCombination,
  plateRows,
  plateColumns,
  modalPosition,
  isDraggingModal,
  onClose,
  onMouseDown,
  plateQuality,
  randomizedPlates,
  numPlates = 1,
}) => {



  if (!show || plateIndex === null) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!isDraggingModal && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={handleOverlayClick}>
      <div
        data-modal-content
        style={{
          ...styles.modalContent,
          ...(modalPosition.x !== 0 || modalPosition.y !== 0 ? {
            position: 'absolute' as const,
            left: `${modalPosition.x}px`,
            top: `${modalPosition.y}px`,
            transform: 'none'
          } : {}),
          cursor: isDraggingModal ? 'grabbing' : 'default'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            ...styles.modalHeader,
            cursor: 'grab'
          }}
          onMouseDown={onMouseDown}
        >
          <h3 style={styles.modalTitle}>Plate {plateIndex + 1} Details</h3>
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
          {plateAssignments && plateAssignments.has(plateIndex) && (
            <>
              <div style={styles.modalSummary}>
                <span><strong>Capacity:</strong> {plateRows * plateColumns}</span>
                <span><strong>Samples:</strong> {plateAssignments.get(plateIndex)!.length}</span>
                {plateQuality && (
                  <>
                    {numPlates > 1 && (
                    <span>
                      <strong>Balance:</strong>{' '}
                      <span style={{ color: getQualityColor(plateQuality.balanceScore) }}>
                        {formatScore(plateQuality.balanceScore)}
                      </span>
                      {' '}
                      <span style={{
                        ...styles.qualityBadge,
                        backgroundColor: getQualityColor(plateQuality.balanceScore)
                      }}>
                        {getCompactQualityLevel(plateQuality.balanceScore)}
                      </span>
                    </span>
                    )}
                    {QUALITY_DISPLAY_CONFIG.showClusteringScore && (
                      <span>
                        <strong>Clustering:</strong>{' '}
                        <span style={{ color: getQualityColor(plateQuality.clusteringScore) }}>
                          {formatScore(plateQuality.clusteringScore)}
                        </span>
                        {' '}
                        <span style={{
                          ...styles.qualityBadge,
                          backgroundColor: getQualityColor(plateQuality.clusteringScore)
                        }}>
                          {getCompactQualityLevel(plateQuality.clusteringScore)}
                        </span>
                      </span>
                    )}
                     {QUALITY_DISPLAY_CONFIG.showRowScore && (
                      <span>
                        <strong>Row Score:</strong>{' '}
                        <span style={{ color: getQualityColor(plateQuality.rowClusteringScore) }}>
                          {formatScore(plateQuality.rowClusteringScore)}
                        </span>
                        {' '}
                        <span style={{
                          ...styles.qualityBadge,
                          backgroundColor: getQualityColor(plateQuality.rowClusteringScore)
                        }}>
                          {getCompactQualityLevel(plateQuality.rowClusteringScore)}
                        </span>
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Row Scores Section */}
              {QUALITY_DISPLAY_CONFIG.showRowScore && plateQuality?.rowScores && plateQuality.rowScores.length > 0 && (
                <div style={styles.rowScoresSection}>
                  <h4 style={styles.sectionTitle}>Individual Row Scores</h4>
                  <div style={styles.rowScoresContainer}>
                    {plateQuality.rowScores.map((rowScore, rowIndex) => (
                      <div key={rowIndex} style={styles.rowScoreItem}>
                        <div style={styles.rowScoreHeader}>
                          <span style={styles.rowLabel}>Row {String.fromCharCode(65 + rowIndex)}</span>
                          <span style={{
                            ...styles.rowScoreValue,
                            color: getQualityColor(rowScore)
                          }}>
                            {formatScore(rowScore)}
                          </span>
                          <span style={{
                            ...styles.qualityBadge,
                            backgroundColor: getQualityColor(rowScore)
                          }}>
                            {getCompactQualityLevel(rowScore)}
                          </span>
                        </div>
                        {/* Optional: Show row composition */}
                        {randomizedPlates && randomizedPlates[plateIndex] && randomizedPlates[plateIndex][rowIndex] && (
                          <div style={styles.rowComposition}>
                            {randomizedPlates[plateIndex][rowIndex]
                              .filter(sample => sample !== undefined)
                              .map((sample, colIndex) => {
                                try {
                                  const key = getCovariateKey(sample!);
                                  const colorInfo = covariateColors[key] || { color: '#cccccc', useOutline: false, useStripes: false, textColor: '#000' };
                                  return (
                                    <div
                                      key={colIndex}
                                      style={{
                                        ...styles.rowCompositionCell,
                                        backgroundColor: colorInfo.useOutline ? 'transparent' : colorInfo.color,
                                        ...(colorInfo.useStripes && {
                                          background: `repeating-linear-gradient(45deg, ${colorInfo.color}, ${colorInfo.color} 2px, transparent 2px, transparent 4px)`
                                        }),
                                        border: colorInfo.useOutline ? `1px solid ${colorInfo.color}` : '1px solid rgba(0,0,0,0.1)',
                                      }}
                                      title={key}
                                    />
                                  );
                                } catch (error) {
                                  console.error(error);
                                  return null;
                                }
                              })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const plateSamples = plateAssignments.get(plateIndex)!;
                const groupBalance = plateQuality?.covariateGroupBalance || {};
                const covariateDistribution = new Map<string, number>();

                // Calculate distribution for this plate
                plateSamples.forEach(sample => {
                  try {
                    const key = getCovariateKey(sample);
                    covariateDistribution.set(key, (covariateDistribution.get(key) || 0) + 1);
                  } catch (error) {
                    console.error(error);
                  }
                });

                // Calculate global distribution for percentage calculation
                const globalDistribution = new Map<string, number>();
                searches.forEach(sample => {
                  try {
                    const key = getCovariateKey(sample);
                    globalDistribution.set(key, (globalDistribution.get(key) || 0) + 1);
                  } catch (error) {
                    console.error(error);
                  }
                });

                return (
                  <div style={styles.covariateDistribution}>
                    {numPlates > 1 && <h4 style={styles.sectionTitle}>Balance Scores</h4>}
                    {Array.from(globalDistribution.entries())
                      .sort((a, b) => {
                        // Sort by: 1) total samples in group (descending), 2) samples in plate (descending), 3) group name (ascending)
                        const globalCountA = a[1];
                        const globalCountB = b[1];
                        const plateCountA = covariateDistribution.get(a[0]) || 0;
                        const plateCountB = covariateDistribution.get(b[0]) || 0;

                        // First: sort by total samples in the covariate group (descending)
                        if (globalCountB !== globalCountA) return globalCountB - globalCountA;

                        // Second: sort by samples in this plate (descending)
                        if (plateCountB !== plateCountA) return plateCountB - plateCountA;

                        // Third: sort by group name (ascending)
                        return a[0].localeCompare(b[0]);
                      })
                      .map(([combination, globalCount]) => {
                        const count = covariateDistribution.get(combination) || 0;
                        const colorInfo = covariateColors[combination] || { color: '#cccccc', useOutline: false, useStripes: false, textColor: '#000' };
                        const percentage = globalCount > 0 ? ((count / globalCount) * 100).toFixed(1) : '0.0';
                        const balance = groupBalance[combination];

                        return (
                          <div key={combination} style={{
                            ...styles.distributionItem,
                            ...(count === 0 ? styles.distributionItemEmpty : {}),
                            ...(selectedCombination === combination ? styles.distributionItemSelected : {})
                          }}>
                            <div
                              style={{
                                ...styles.distributionColorIndicator,
                                backgroundColor: colorInfo.useOutline ? 'transparent' : colorInfo.color,
                                ...(colorInfo.useStripes && {
                                  background: `repeating-linear-gradient(45deg, ${colorInfo.color}, ${colorInfo.color} 2px, transparent 2px, transparent 4px)`
                                }),
                                border: colorInfo.useOutline ? `2px solid ${colorInfo.color}` : '1px solid rgba(0,0,0,0.2)',
                                ...(count === 0 ? { opacity: 0.4 } : {})
                              }}
                            />
                            <div style={styles.distributionText}>
                              <div style={styles.covariateInfo}>
                                <div style={styles.distributionStats}>
                                  <span style={{
                                    ...styles.distributionCount,
                                    ...(count === 0 ? { color: '#999' } : {})
                                  }}>
                                    {count}/{globalCount}
                                  </span>
                                  <span style={{
                                    ...styles.distributionPercentage,
                                    ...(count === 0 ? { color: '#999' } : {})
                                  }}>
                                    ({percentage}%)
                                  </span>
                                </div>
                                <div style={{
                                  ...styles.distributionCombination,
                                  ...(count === 0 ? { color: '#999' } : {})
                                }}>
                                  {selectedCovariates.map((cov, idx) => {
                                    const values = combination.split('|');
                                    return (
                                      <div key={cov} style={styles.covariateItem}>
                                        <strong>{cov}:</strong> {values[idx] || 'N/A'}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {balance && numPlates > 1 && (
                                <div style={styles.balanceInfo}>
                                  <div style={{
                                    ...styles.balanceScore,
                                    color: getQualityColor(balance.balanceScore)
                                  }}>
                                    <span style={{
                                      ...styles.qualityBadge,
                                      backgroundColor: getQualityColor(balance.balanceScore)
                                    }}>
                                      {getCompactQualityLevel(balance.balanceScore)}
                                    </span>
                                    {' '}Balance: {balance.balanceScore}
                                  </div>
                                  <div style={styles.balanceDetailLine}>
                                    Expected Proportion: {balance.expectedProportion.toFixed(4)}
                                  </div>
                                  <div style={styles.balanceDetailLine}>
                                    Actual Proportion: {balance.actualProportion.toFixed(4)}
                                  </div>
                                  <div style={styles.balanceDetailLine}>
                                    Deviation: {(balance.relativeDeviation * 100).toFixed(4)}%
                                  </div>
                                  <div style={styles.balanceDetailLine}>
                                    Weighted Deviation: {(balance.weightedDeviation * 100).toFixed(4)}%
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })()}
            </>
          )}
          {(!plateAssignments || !plateAssignments.has(plateIndex)) && (
            <div style={styles.noDataMessage}>No covariate distribution data available for this plate.</div>
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
    alignItems: 'top',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    maxWidth: '600px',
    maxHeight: '80vh',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid #e0e0e0',
    backgroundColor: '#f8f9fa',
    flexShrink: 0,
    userSelect: 'none' as const,
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
    fontSize: '18px',
    cursor: 'pointer',
    color: '#666',
    padding: '2px',
    width: '24px',
    height: '24px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '3px',
    transition: 'background-color 0.2s ease',
  },
  modalBody: {
    padding: '16px 20px',
    fontSize: '13px',
    lineHeight: '1.4',
    overflow: 'auto',
    flex: 1,
  },
  modalSummary: {
    display: 'flex',
    gap: '20px',
    marginBottom: '16px',
    padding: '8px 12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
    fontSize: '12px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    margin: '16px 0 8px 0',
  },
  rowScoresSection: {
    marginBottom: '16px',
  },
  rowScoresContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  rowScoreItem: {
    padding: '8px 10px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
    border: '1px solid #e9ecef',
  },
  rowScoreHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  rowLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#333',
    minWidth: '50px',
  },
  rowScoreValue: {
    fontSize: '12px',
    fontWeight: '600',
    flex: 1,
  },
  rowComposition: {
    display: 'flex',
    gap: '2px',
    marginTop: '6px',
  },
  rowCompositionCell: {
    width: '12px',
    height: '12px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  balanceScore: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '1px 0px',
    backgroundColor: '#f8f9fa',
    borderRadius: '2px',
  },
  balanceDetails: {
    padding: '1px 4px',
    fontSize: '10px',
    color: '#666',
  },
  balanceDetailLine: {
    fontSize: '10px',
    color: '#666',
    lineHeight: '1.3',
    textAlign: 'left' as const,
  },
  covariateDistribution: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  distributionItem: {
    display: 'flex',
    alignItems: 'top',
    gap: '8px',
    padding: '6px 8px',
    backgroundColor: '#f8f9fa',
    borderRadius: '3px',
    border: '1px solid #e9ecef',
  },
  distributionItemEmpty: {
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
  },
  distributionItemSelected: {
    backgroundColor: '#e3f2fd',
    border: '2px solid #2196f3',
    boxShadow: '0 0 4px rgba(33, 150, 243, 0.3)',
  },
  distributionColorIndicator: {
    width: '16px',
    height: '16px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  distributionText: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  covariateInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    flex: 1,
  },
  distributionCombination: {
    fontSize: '12px',
    color: '#333',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  covariateItem: {
    fontSize: '12px',
    lineHeight: '1.2',
  },
  distributionStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    marginBottom: '4px',
  },
  distributionCount: {
    fontSize: '12px',
    color: '#333',
    fontWeight: '600',
  },
  distributionPercentage: {
    fontSize: '11px',
    color: '#666',
  },
  balanceInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    alignItems: 'flex-start',
    minWidth: '120px',
    textAlign: 'left' as const,
  },
  noDataMessage: {
    textAlign: 'center' as const,
    color: '#666',
    fontStyle: 'italic',
    padding: '20px',
  },
  qualityBadge: {
    padding: '2px 6px',
    borderRadius: '3px',
    color: '#fff',
    fontSize: '10px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
};

export default PlateDetailsModal;