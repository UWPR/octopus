import React from 'react';
import { SearchData, CovariateColorInfo, PlateQualityScore, NaPolicy, DEFAULT_NA_POLICY } from '../utils/types';
import { QUALITY_DISPLAY_CONFIG } from '../utils/configs';
import { getCovariateKey, getQualityColor, formatScore, effectiveDisplayValue } from '../utils/utils';
import { covariateGroupLabel } from '../utils/groupDistributionWarnings';
import QualitySwatch from './QualitySwatch';

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
  naPolicy?: NaPolicy;
  qcColumn?: string;
  selectedQcValues?: string[];
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
  naPolicy = DEFAULT_NA_POLICY,
  qcColumn = '',
  selectedQcValues = [],
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
                      <QualitySwatch color={getQualityColor(plateQuality.balanceScore)} />
                    </span>
                    )}
                    {QUALITY_DISPLAY_CONFIG.showClusteringScore && (
                      <span>
                        <strong>Clustering:</strong>{' '}
                        <span style={{ color: getQualityColor(plateQuality.clusteringScore) }}>
                          {formatScore(plateQuality.clusteringScore)}
                        </span>
                        {' '}
                        <QualitySwatch color={getQualityColor(plateQuality.clusteringScore)} />
                      </span>
                    )}
                     {QUALITY_DISPLAY_CONFIG.showRowScore && (
                      <span>
                        <strong>Row Score:</strong>{' '}
                        <span style={{ color: getQualityColor(plateQuality.rowClusteringScore) }}>
                          {formatScore(plateQuality.rowClusteringScore)}
                        </span>
                        {' '}
                        <QualitySwatch color={getQualityColor(plateQuality.rowClusteringScore)} />
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
                          <QualitySwatch color={getQualityColor(rowScore)} />
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

                // Count every group in the study, and keep one sample per group so the
                // covariate values come from metadata instead of from splitting the key.
                const globalDistribution = new Map<string, number>();
                const representativeByKey = new Map<string, SearchData>();
                searches.forEach(sample => {
                  try {
                    const key = getCovariateKey(sample);
                    globalDistribution.set(key, (globalDistribution.get(key) || 0) + 1);
                    if (!representativeByKey.has(key)) {
                      representativeByKey.set(key, sample);
                    }
                  } catch (error) {
                    console.error(error);
                  }
                });

                // The group label the Covariate Summary and the warning banner use, with the QC
                // value in front of a QC group unless the QC column is a selected covariate
                const groupLabel = (combination: string): string => {
                  const representative = representativeByKey.get(combination);
                  const values: { [covariate: string]: string } = {};
                  selectedCovariates.forEach((cov) => {
                    values[cov] = effectiveDisplayValue(representative?.metadata[cov] ?? '', naPolicy);
                  });
                  const label = covariateGroupLabel(values, selectedCovariates);
                  const qcValue = qcColumn ? representative?.metadata[qcColumn] : undefined;
                  const isQc = qcValue !== undefined && selectedQcValues.includes(qcValue);
                  return isQc && !Object.values(values).includes(qcValue) ? `${qcValue} | ${label}` : label;
                };

                const showBalance = plateQuality !== undefined && numPlates > 1;
                // Points each group takes off the plate's balance score. The plate score is 100
                // minus the sum over every group, rounded, and 0 at the lowest.
                const penaltyPoints = (weightedDeviation: number): number => weightedDeviation * 100;
                const totalPenalty = Object.values(groupBalance)
                  .reduce((sum, balance) => sum + penaltyPoints(balance.weightedDeviation), 0);

                const rows = Array.from(globalDistribution.entries())
                  .sort((a, b) => {
                    const plateCountA = covariateDistribution.get(a[0]) || 0;
                    const plateCountB = covariateDistribution.get(b[0]) || 0;
                    // Largest group in the study first, then most on this plate, then by name
                    return b[1] - a[1] || plateCountB - plateCountA || a[0].localeCompare(b[0]);
                  });

                return (
                  <div>
                    {showBalance && <h4 style={styles.sectionTitle}>Balance Scores</h4>}
                    <table style={styles.groupTable} data-testid="plate-group-table">
                      <thead>
                        <tr>
                          <th style={styles.groupHeaderCell}>Group ({selectedCovariates.join(' | ')})</th>
                          <th style={styles.numberHeaderCell}>Total samples</th>
                          <th style={styles.numberHeaderCell}>On plate</th>
                          {showBalance && (
                            <>
                              <th style={styles.numberHeaderCell}>Expected</th>
                              <th style={styles.numberHeaderCell}>Penalty</th>
                              <th style={styles.numberHeaderCell}>Group score</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(([combination, globalCount]) => {
                          const count = covariateDistribution.get(combination) || 0;
                          const colorInfo = covariateColors[combination] || { color: '#cccccc', useOutline: false, useStripes: false, textColor: '#000' };
                          const balance = groupBalance[combination];
                          const dimmed = count === 0 ? styles.dimmedCell : {};

                          return (
                            <tr
                              key={combination}
                              data-testid="plate-group-row"
                              style={selectedCombination === combination ? styles.selectedRow : {}}
                            >
                              <td style={{ ...styles.groupCell, ...dimmed }}>
                                <div style={styles.groupCellContent}>
                                <span
                                  style={{
                                    ...styles.groupColorIndicator,
                                    backgroundColor: colorInfo.useOutline ? 'transparent' : colorInfo.color,
                                    ...(colorInfo.useStripes && {
                                      background: `repeating-linear-gradient(45deg, ${colorInfo.color}, ${colorInfo.color} 2px, transparent 2px, transparent 4px)`
                                    }),
                                    border: colorInfo.useOutline ? `2px solid ${colorInfo.color}` : '1px solid rgba(0,0,0,0.2)',
                                    ...(count === 0 ? { opacity: 0.4 } : {})
                                  }}
                                />
                                <span>{groupLabel(combination)}</span>
                                </div>
                              </td>
                              <td style={{ ...styles.numberCell, ...dimmed }}>{globalCount}</td>
                              <td style={{ ...styles.numberCell, ...dimmed }}>{count}</td>
                              {showBalance && balance && (
                                <>
                                  <td style={{ ...styles.numberCell, ...dimmed }}>{balance.expectedCount.toFixed(1)}</td>
                                  <td style={{ ...styles.numberCell, ...dimmed }}>
                                    {penaltyPoints(balance.weightedDeviation).toFixed(1)}
                                  </td>
                                  <td
                                    style={{ ...styles.numberCell, ...dimmed }}
                                    title={`${(balance.relativeDeviation * 100).toFixed(1)}% from the expected count`}
                                  >
                                    {balance.balanceScore}{' '}
                                    <QualitySwatch color={getQualityColor(balance.balanceScore)} />
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      {showBalance && (
                        <tfoot>
                          <tr data-testid="plate-group-total">
                            <td style={styles.totalCell} colSpan={4}>Total penalty</td>
                            <td style={{ ...styles.numberCell, ...styles.totalCell }}>{totalPenalty.toFixed(1)}</td>
                            <td style={styles.totalCell} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                    {showBalance && (
                      <div style={styles.totalNote}>
                        <div style={styles.formula}>Penalty = |On plate - Expected| / Samples &times; 100</div>
                        <div style={styles.formula}>Group score = 100 - |On plate - Expected| / Expected &times; 100, at least 0</div>
                        <div style={styles.formula}>Plate balance = 100 - Total penalty, rounded and at least 0</div>
                      </div>
                    )}
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
    alignItems: 'flex-start',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    maxWidth: '820px',
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
  groupTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '12px',
  },
  groupHeaderCell: {
    textAlign: 'left' as const,
    verticalAlign: 'bottom',
    padding: '4px 8px',
    borderBottom: '1px solid #ccc',
    color: '#333',
    fontWeight: '600',
  },
  numberHeaderCell: {
    textAlign: 'right' as const,
    verticalAlign: 'bottom',
    padding: '4px 8px',
    borderBottom: '1px solid #ccc',
    color: '#333',
    fontWeight: '600',
    whiteSpace: 'nowrap' as const,
  },
  groupCell: {
    padding: '4px 8px',
    borderBottom: '1px solid #e9ecef',
    color: '#333',
  },
  numberCell: {
    padding: '4px 8px',
    borderBottom: '1px solid #e9ecef',
    color: '#333',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  dimmedCell: {
    color: '#999',
  },
  selectedRow: {
    backgroundColor: '#e3f2fd',
  },
  groupCellContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
  },
  groupColorIndicator: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: '2px',
    marginTop: '2px',
    flexShrink: 0,
  },
  totalCell: {
    padding: '4px 8px',
    fontWeight: '600',
    color: '#333',
  },
  totalNote: {
    marginTop: '6px',
    fontSize: '12px',
    color: '#666',
  },
  formula: {
    fontFamily: 'monospace',
  },
  noDataMessage: {
    textAlign: 'center' as const,
    color: '#666',
    fontStyle: 'italic',
    padding: '20px',
  },
};

export default PlateDetailsModal;