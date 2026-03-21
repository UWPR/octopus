import React, { useState } from 'react';
import { SummaryItem } from '../utils/types';

type FillStyle = 'solid' | 'outline' | 'diagonal';

interface SummaryPanelProps {
  summaryData: SummaryItem[];
  showSummary: boolean;
  onToggleSummary: () => void;
  selectedCombination: string | null;
  onSummaryItemClick: (combination: string) => void;
  qcColumn?: string;
  selectedQcValues?: string[];
  selectedCovariates?: string[];
  onUpdateColor?: (combination: string, updates: { color?: string; useOutline?: boolean; useStripes?: boolean }) => void;
}

function getFillStyle(item: SummaryItem): FillStyle {
  if (item.useStripes) return 'diagonal';
  if (item.useOutline) return 'outline';
  return 'solid';
}

function fillStyleToFlags(style: FillStyle): { useOutline: boolean; useStripes: boolean } {
  switch (style) {
    case 'outline': return { useOutline: true, useStripes: false };
    case 'diagonal': return { useOutline: false, useStripes: true };
    default: return { useOutline: false, useStripes: false };
  }
}

const SummaryPanel: React.FC<SummaryPanelProps> = ({
  summaryData,
  showSummary,
  onToggleSummary,
  selectedCombination,
  onSummaryItemClick,
  qcColumn,
  selectedQcValues = [],
  selectedCovariates = [],
  onUpdateColor,
}) => {
  const [editingCombination, setEditingCombination] = useState<string | null>(null);

  if (summaryData.length === 0 || !showSummary) return null;

  // Get unique values for each covariate
  const covariateUniqueValues = new Map<string, Set<string>>();
  summaryData.forEach(item => {
    Object.entries(item.values).forEach(([covariate, value]) => {
      if (!covariateUniqueValues.has(covariate)) {
        covariateUniqueValues.set(covariate, new Set());
      }
      covariateUniqueValues.get(covariate)!.add(value);
    });
  });

  const handleEditClick = (e: React.MouseEvent, combination: string) => {
    e.stopPropagation();
    setEditingCombination(editingCombination === combination ? null : combination);
  };

  const handleColorChange = (combination: string, color: string) => {
    onUpdateColor?.(combination, { color });
  };

  const handleStyleChange = (combination: string, style: FillStyle) => {
    onUpdateColor?.(combination, fillStyleToFlags(style));
  };

  return (
    <div style={styles.summaryContainer}>
      <div style={styles.summaryPanel}>
        {/* Compact Summary Header */}
        <div style={styles.summaryInfo}>
          {qcColumn && selectedQcValues.length > 0 && (
            <div style={styles.summaryInfoRow}>
              <span style={styles.summaryLabel}>QC/Reference Column:</span>
              <span style={styles.summaryValue}>{qcColumn}</span>
              <span style={styles.summaryLabel}> Selected Values:</span>
              <span style={styles.summaryValue}>{selectedQcValues.join(', ')}</span>
            </div>
          )}
          {selectedCovariates.length > 0 && (
            <div style={styles.summaryInfoRow}>
              <span style={styles.summaryLabel}>Treatment Covariates:</span>
              <span style={styles.summaryValue}>
                {selectedCovariates.map(covariate => {
                  const values = covariateUniqueValues.get(covariate);
                  if (!values || values.size === 0) return null;
                  return `${covariate} (${Array.from(values).sort().join(', ')})`;
                }).filter(Boolean).join(' • ')}
              </span>
            </div>
          )}
        </div>
        <div style={styles.summaryGrid}>
          {summaryData.map((item, index) => {
            const isQC = item.qcColumnValue !== undefined &&
                             selectedQcValues.includes(item.qcColumnValue);
            const isEditing = editingCombination === item.combination;

            return (
              <div
                key={index}
                data-testid={`summary-card-${index}`}
                style={{
                  ...styles.summaryItem,
                  ...(selectedCombination === item.combination ? styles.summaryItemSelected : {}),
                  ...(isQC ? styles.summaryItemQc : {}),
                  cursor: 'pointer'
                }}
                onClick={() => onSummaryItemClick(item.combination)}
              >
                <div style={styles.summaryHeader}>
                  <div
                    style={{
                      ...styles.colorIndicator,
                      backgroundColor: item.useOutline ? 'transparent' : item.color,
                      ...(item.useStripes && {
                        background: `repeating-linear-gradient(45deg, ${item.color}, ${item.color} 2px, transparent 2px, transparent 4px)`
                      }),
                      border: item.useOutline ? `4px solid ${item.color}` : styles.colorIndicator.border,
                      boxSizing: 'border-box' as const
                    }}
                  />
                  {onUpdateColor && (
                    <span
                      onClick={(e) => handleEditClick(e, item.combination)}
                      style={{
                        ...styles.editIcon,
                        ...(isEditing ? styles.editIconActive : {}),
                      }}
                      title="Edit color and style"
                    >
                      ✎
                    </span>
                  )}
                  <span style={styles.summaryCount}>
                    {item.count}
                  </span>
                  {isQC && (
                    <span style={styles.qcBadge}>QC</span>
                  )}
                </div>
                {isEditing && (
                  <div style={styles.editControls} onClick={(e) => e.stopPropagation()}>
                    <label style={styles.editLabel}>
                      Color:
                      <input
                        type="color"
                        value={item.color}
                        onChange={(e) => handleColorChange(item.combination, e.target.value)}
                        style={styles.colorInput}
                      />
                    </label>
                    <label style={styles.editLabel}>
                      Style:
                      <select
                        value={getFillStyle(item)}
                        onChange={(e) => handleStyleChange(item.combination, e.target.value as FillStyle)}
                        style={styles.styleSelect}
                      >
                        <option value="solid">Solid</option>
                        <option value="outline">Outline</option>
                        <option value="diagonal">Diagonal</option>
                      </select>
                    </label>
                  </div>
                )}
                <div style={styles.summaryDetails}>
                  {isQC && qcColumn && (
                    <div key={qcColumn} style={styles.covariateDetail}>
                      <strong>{qcColumn}:</strong> {item.qcColumnValue}
                    </div>
                  )}
                  {Object.entries(item.values)
                    .filter(([covariate]) => !(isQC && covariate === qcColumn))
                    .map(([covariate, value]) => (
                      <div key={covariate} style={styles.covariateDetail}>
                        <strong>{covariate}:</strong> {value}
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  summaryContainer: {
    width: '90%',
    marginBottom: '20px',
  },
  summaryPanel: {
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    padding: '12px',
    border: '1px solid #dee2e6',
  },
  summaryInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    border: '1px solid #e9ecef',
  },
  summaryInfoRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    fontSize: '11px',
    lineHeight: '1.4',
  },
  summaryLabel: {
    fontWeight: '600',
    color: '#495057',
    minWidth: 'fit-content',
  },
  summaryValue: {
    color: '#6c757d',
    wordBreak: 'break-word',
  },
  summaryGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
  },
  summaryItem: {
    backgroundColor: '#fff',
    borderRadius: '4px',
    padding: '8px',
    border: '1px solid #e9ecef',
    transition: 'all 0.2s ease',
    flex: '0 0 auto',
    width: '140px',
    minWidth: '140px',
  },
  summaryItemSelected: {
    backgroundColor: '#e3f2fd',
    border: '2px solid #2196f3',
    boxShadow: '0 1px 4px rgba(33, 150, 243, 0.2)',
  },
  summaryItemQc: {
    border: '2px dashed #dc3545',
  },
  summaryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
    flexWrap: 'wrap',
  },
  qcBadge: {
    fontSize: '9px',
    fontWeight: '700',
    color: '#dc3545',
    backgroundColor: '#fff',
    border: '1px solid #dc3545',
    borderRadius: '3px',
    padding: '1px 4px',
    marginLeft: 'auto',
  },
  colorIndicator: {
    width: '14px',
    height: '14px',
    borderRadius: '2px',
    border: '1px solid rgba(0,0,0,0.2)',
    flexShrink: 0,
  },
  summaryCount: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  summaryDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  covariateDetail: {
    fontSize: '11px',
    color: '#555',
    lineHeight: '1.2',
  },
  editIcon: {
    fontSize: '16px',
    color: '#888',
    cursor: 'pointer',
    padding: '0 2px',
    borderRadius: '3px',
    transition: 'all 0.15s ease',
    lineHeight: '1',
  },
  editIconActive: {
    color: '#2196f3',
    backgroundColor: '#e3f2fd',
  },
  editControls: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    padding: '4px 0',
    marginBottom: '4px',
    borderBottom: '1px solid #eee',
    flexWrap: 'wrap',
  },
  editLabel: {
    fontSize: '10px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
  },
  colorInput: {
    width: '24px',
    height: '20px',
    padding: '0',
    border: '1px solid #ccc',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  styleSelect: {
    fontSize: '10px',
    padding: '1px 2px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
};

export default SummaryPanel;
