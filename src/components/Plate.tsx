/**
 * Plate Component
 *
 * Renders a single plate with its wells, samples, and interactions
 *
 * This component:
 * - Displays one individual plate (typically 8 rows × 12 columns = 96 wells)
 * - Renders samples in wells with covariate-based color coding
 * - Handles drag & drop for individual samples within the plate
 * - Shows plate header with plate number and optional details button
 * - Manages compact vs full view display modes for the single plate
 * - Provides tooltips with sample and covariate information
 * - Renders row labels (A-H) and column labels (01-12)
 * - Handles sample highlighting based on covariate selection in summary panel
 *
 */

import React, { DragEvent, useMemo, useCallback } from 'react';
import { SearchData, CovariateColorInfo, PlateQualityScore } from '../utils/types';
import { QUALITY_DISPLAY_CONFIG } from '../utils/configs';
import { getCovariateKey, getQualityColor, getCompactQualityLevel, formatScore } from '../utils/utils';

// Constants
const DIMENSIONS = {
  full: { cellWidth: 100, rowLabelWidth: 25 },
  compact: { cellWidth: 18, rowLabelWidth: 15 }
};

const STRIPE_PATTERNS = {
  compact: { size: '2px', gap: '4px' },
  full: { size: '3px', gap: '6px' }
};

const HIGHLIGHT_STYLE: React.CSSProperties = {
  outline: '2px solid #2196f3',
  outlineOffset: '1px',
  boxShadow: '0 0 4px rgba(33, 150, 243, 0.7)'
};

const DEFAULT_COLOR_INFO: CovariateColorInfo = {
  color: '#cccccc',
  useOutline: false,
  useStripes: false,
  textColor: '#000' // Default gray is light, so use black text
};

// Utility functions
const generateColumnLabels = (numColumns: number): string[] =>
  Array.from({ length: numColumns }, (_, index) => (index + 1).toString().padStart(2, '0'));

const getRowLabel = (rowIndex: number): string => String.fromCharCode(65 + rowIndex);

const createTooltipText = (
  search: SearchData,
  rowIndex: number,
  columnIndex: number,
  selectedCovariates: string[],
  subjectColumn?: string
): string => {
  const position = `${getRowLabel(rowIndex)}${columnIndex + 1}`;
  const subjectInfo = subjectColumn && search.metadata[subjectColumn]
    ? `\n${subjectColumn}: ${search.metadata[subjectColumn]}`
    : '';
  const covariateInfo = selectedCovariates.length > 0
    ? '\n' + selectedCovariates
      .map(cov => `${cov}: ${search.metadata[cov] || 'N/A'}`)
      .join(', ')
    : '';
  return `${search.name} (${position})${subjectInfo}${covariateInfo}`;
};

interface PlateProps {
  plateIndex: number;
  rows: (SearchData | undefined)[][];
  covariateColors: { [key: string]: CovariateColorInfo };
  selectedCovariates: string[];
  onDragStart: (event: DragEvent<HTMLDivElement>, searchName: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, rowIndex: number, columnIndex: number) => void;
  compact?: boolean;
  highlightFunction?: (search: SearchData) => boolean;
  numColumns?: number;
  onShowDetails?: (plateIndex: number) => void;
  plateQuality?: PlateQualityScore;
  onReRandomizePlate?: (plateIndex: number) => void;
  subjectColumn?: string;
  numPlates?: number;
}

const Plate: React.FC<PlateProps> = ({
  plateIndex,
  rows,
  covariateColors,
  selectedCovariates,
  onDragStart,
  onDragOver,
  onDrop,
  compact = true,
  highlightFunction,
  numColumns = 12,
  onShowDetails,
  plateQuality,
  onReRandomizePlate,
  subjectColumn,
  numPlates = 1
}) => {



  // Memoized values to avoid recalculation
  const columns = useMemo(() => generateColumnLabels(numColumns), [numColumns]);
  const currentStyles = useMemo(() => compact ? compactStyles : styles, [compact]);

  // Memoized drag handlers
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDragOver(event);
  }, [onDragOver]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>, rowIndex: number, columnIndex: number) => {
    event.preventDefault();
    onDrop(event, rowIndex, columnIndex);
  }, [onDrop]);

  // Memoized style generators
  const createSearchCellStyle = useCallback((colorInfo: CovariateColorInfo, isHighlighted: boolean) => {
    const pattern = compact ? STRIPE_PATTERNS.compact : STRIPE_PATTERNS.full;
    const outlineBorderWidth = compact ? '3px' : '6px';

    const baseStyle: React.CSSProperties = {
      backgroundColor: colorInfo.useOutline ? 'transparent' : colorInfo.color,
      background: colorInfo.useStripes
        ? `repeating-linear-gradient(45deg, ${colorInfo.color}, ${colorInfo.color} ${pattern.size}, transparent ${pattern.size}, transparent ${pattern.gap})`
        : colorInfo.useOutline ? 'transparent' : colorInfo.color,
      border: colorInfo.useOutline
        ? `${outlineBorderWidth} solid ${colorInfo.color}`
        : (compact ? currentStyles.compactSearchIndicator.border : '1px solid #ccc'),
      boxSizing: 'border-box' as const
    };

    return {
      ...baseStyle,
      ...(isHighlighted ? HIGHLIGHT_STYLE : {})
    };
  }, [compact, currentStyles.compactSearchIndicator.border]);

  // Optimized cell renderers
  const renderCompactCell = useCallback((search: SearchData, isHighlighted: boolean) => {
    try {
      const colorInfo = covariateColors[getCovariateKey(search)] || DEFAULT_COLOR_INFO;
      const cellStyle = createSearchCellStyle(colorInfo, isHighlighted);

      return (
        <div
          style={{
            ...currentStyles.compactSearchIndicator,
            ...cellStyle
          }}
          draggable={true}
          onDragStart={(event) => onDragStart(event, search.name)}
        />
      );
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [covariateColors, selectedCovariates, currentStyles.compactSearchIndicator, createSearchCellStyle, onDragStart]);

  const renderFullCell = useCallback((search: SearchData, isHighlighted: boolean) => {
    if (!search.covariateKey) {
      console.error(`treatmentKey not set for sample: ${search.name}`);
      return null;
    }
    const colorInfo = covariateColors[search.covariateKey] || DEFAULT_COLOR_INFO;
    const pattern = compact ? STRIPE_PATTERNS.compact : STRIPE_PATTERNS.full;
    const outlineBorderWidth = compact ? '3px' : '6px';

    // Determine if we need white background for text (outline or stripes)
    const needsWhiteBackground = colorInfo.useOutline || colorInfo.useStripes;

    // For solid fills, use pre-calculated text color; for outline/stripes use default dark text
    const textColor = !needsWhiteBackground ? colorInfo.textColor : '#333';

    // Create header style with background color/pattern
    const headerStyle: React.CSSProperties = {
      backgroundColor: colorInfo.useOutline ? 'transparent' : colorInfo.color,
      background: colorInfo.useStripes
        ? `repeating-linear-gradient(45deg, ${colorInfo.color}, ${colorInfo.color} ${pattern.size}, transparent ${pattern.size}, transparent ${pattern.gap})`
        : colorInfo.useOutline ? 'transparent' : colorInfo.color,
      border: colorInfo.useOutline
        ? `${outlineBorderWidth} solid ${colorInfo.color}`
        : 'none',
      padding: '8px',
      borderRadius: '8px 8px 0 0',
      minHeight: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };

    return (
      <div
        style={{
          ...currentStyles.fullSearchCard,
          padding: '0',
          backgroundColor: '#fff',
          ...(isHighlighted ? HIGHLIGHT_STYLE : {})
        }}
        draggable={true}
        onDragStart={(event) => onDragStart(event, search.name)}
      >
        <div style={headerStyle}>
          <h3 style={{
            ...currentStyles.searchTitle,
            backgroundColor: needsWhiteBackground ? '#fff' : 'transparent',
            color: textColor,
            padding: '4px 8px',
            borderRadius: '4px',
            margin: 0,
          }}>
            {search.name}
          </h3>
        </div>
        <div style={{ padding: '12px' }}>
          {subjectColumn && search.metadata[subjectColumn] && (
            <div key="subject-id" style={currentStyles.searchMetadata}>
              {`${subjectColumn}: ${search.metadata[subjectColumn]}`}
            </div>
          )}
          {selectedCovariates.map((covariate: string) =>
            search.metadata[covariate] ? (
              <div key={covariate} style={currentStyles.searchMetadata}>
                {`${covariate}: ${search.metadata[covariate]}`}
              </div>
            ) : null
          )}
        </div>
      </div>
    );
  }, [covariateColors, selectedCovariates, currentStyles, onDragStart, compact, subjectColumn]);

  // Unified cell renderer
  const renderSearchCell = useCallback((search: SearchData, isHighlighted: boolean) => {
    return compact ? renderCompactCell(search, isHighlighted) : renderFullCell(search, isHighlighted);
  }, [compact, renderCompactCell, renderFullCell]);

  return (
    <div style={currentStyles.plate} data-testid={`plate-${plateIndex}`}>
      <div style={currentStyles.plateHeader}>
        <div style={currentStyles.plateTitleRow}>
          <div style={currentStyles.plateHeading}>Plate {plateIndex + 1}</div>
          <div style={currentStyles.plateButtons}>
            {onReRandomizePlate && (
              <button
                onClick={() => onReRandomizePlate(plateIndex)}
                style={currentStyles.reRandomizeButton}
                title="Re-randomize this plate"
              >
                <div style={currentStyles.reRandomizeIcon}>R</div>
              </button>
            )}
            {onShowDetails && (
              <button
                onClick={() => onShowDetails(plateIndex)}
                style={currentStyles.detailsButton}
                title="Show plate details"
              >
                <div style={currentStyles.detailsIcon}>i</div>
              </button>
            )}
          </div>
        </div>
        {plateQuality && (
          <div style={currentStyles.plateQualityRow}>
            <div style={currentStyles.plateQualityMetrics}>
              <span style={currentStyles.qualityLabel}>Quality:</span>
              {numPlates > 1 && (
              <span
                style={{
                  ...currentStyles.qualityScore,
                  color: getQualityColor(plateQuality.balanceScore)
                }}
              >
                <span style={{
                  ...currentStyles.qualityBadge,
                  backgroundColor: getQualityColor(plateQuality.balanceScore)
                }}>
                  {getCompactQualityLevel(plateQuality.balanceScore)}
                </span>
                {' '}Bal: {formatScore(plateQuality.balanceScore)}
              </span>
              )}
              {QUALITY_DISPLAY_CONFIG.showClusteringScore && (
                <span
                  style={{
                    ...currentStyles.qualityScore,
                    color: getQualityColor(plateQuality.clusteringScore)
                  }}
                >
                  <span style={{
                    ...currentStyles.qualityBadge,
                    backgroundColor: getQualityColor(plateQuality.clusteringScore)
                  }}>
                    {getCompactQualityLevel(plateQuality.clusteringScore)}
                  </span>
                  {' '}Clust: {formatScore(plateQuality.clusteringScore)}
                </span>
              )}
              {QUALITY_DISPLAY_CONFIG.showRowScore && (
                <span
                  style={{
                    ...currentStyles.qualityScore,
                    color: getQualityColor(plateQuality.rowClusteringScore)
                  }}
                >
                  <span style={{
                    ...currentStyles.qualityBadge,
                    backgroundColor: getQualityColor(plateQuality.rowClusteringScore)
                  }}>
                    {getCompactQualityLevel(plateQuality.rowClusteringScore)}
                  </span>
                  {' '}Row: {formatScore(plateQuality.rowClusteringScore)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div style={currentStyles.grid} data-testid={`plate-grid-${plateIndex}`}>
        <div style={currentStyles.columnLabels}>
          <div style={currentStyles.emptyCell} />
          {columns.map((column) => (
            <div key={column} style={currentStyles.columnLabel}>
              {column}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={currentStyles.row}>
            <div style={currentStyles.rowLabel}>{getRowLabel(rowIndex)}</div>
            {columns.map((_, columnIndex) => {
              const search = row[columnIndex];
              const isHighlighted = !!(search && highlightFunction?.(search));

              return (
                <div
                  key={columnIndex}
                  className={isHighlighted ? (compact ? 'well-highlighted-compact' : 'well-highlighted') : undefined}
                  style={{
                    ...(search ? currentStyles.searchWell : currentStyles.emptyWell),
                    ...(isHighlighted ? currentStyles.highlightedWell : {})
                  }}
                  onDragOver={handleDragOver}
                  onDrop={(event) => handleDrop(event, rowIndex, columnIndex)}
                  title={
                    compact && search
                      ? createTooltipText(search, rowIndex, columnIndex, selectedCovariates, subjectColumn)
                      : undefined
                  }
                >
                  {search ? renderSearchCell(search, isHighlighted) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// Base styles shared between full and compact modes
const baseStyles = {
  plateHeader: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    width: '100%',
  },
  plateTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  plateQualityRow: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  plateButtons: {
    display: 'flex',
    gap: '0px',
    alignItems: 'center',
  },

  plateHeading: {
    fontWeight: '600',
    margin: 0,
  },
  plateQualityMetrics: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  qualityLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '500',
  },
  qualityScore: {
    fontSize: '12px',
    fontWeight: '600',
    padding: '1px 4px',
    backgroundColor: '#fff',
    borderRadius: '2px',
    border: '1px solid #e9ecef',
  },
  qualityBadge: {
    padding: '1px 3px',
    borderRadius: '2px',
    color: '#fff',
    fontSize: '9px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    display: 'inline-block',
  },
  detailsButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  detailsIcon: {
    borderRadius: '50%',
    backgroundColor: '#999',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontStyle: 'italic',
  },
  reRandomizeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  reRandomizeIcon: {
    borderRadius: '50%',
    backgroundColor: '#2196f3',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  columnLabels: {
    display: 'flex',
  },
  columnLabel: {
    fontWeight: 'bold',
    textAlign: 'center' as const,
  },
  row: {
    display: 'flex',
  },
  rowLabel: {
    fontWeight: 'bold',
    textAlign: 'center' as const,
  },
  compactSearchIndicator: {
    width: '100%',
    height: '100%',
    borderRadius: '2px',
    cursor: 'move',
    border: '1px solid rgba(0,0,0,0.2)',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box' as const,
  },
  fullSearchCard: {
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    width: '100%',
    boxSizing: 'border-box' as const,
    cursor: 'move',
    transition: 'all 0.2s ease',
    overflow: 'hidden',
  },
  searchTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
    margin: '0 0 8px 0',
    wordBreak: 'break-all' as const,
    textAlign: 'center' as const,
  },
  searchDivider: {
    border: 'none',
    borderTop: '1px solid #eee',
    margin: '12px 0',
  },
  searchMetadata: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px',
  },
};

const styles = {
  ...baseStyles,
  plate: {
    border: '1px solid #ccc',
    borderRadius: '8px',
    padding: '20px',
    backgroundColor: '#f5f5f5',
    overflowX: 'auto' as const,
    maxWidth: '100%',
  },
  plateHeader: {
    ...baseStyles.plateHeader,
    marginBottom: '10px',
  },
  plateHeading: {
    ...baseStyles.plateHeading,
    fontSize: '20px',
  },
  detailsButton: {
    ...baseStyles.detailsButton,
    padding: '2px',
    borderRadius: '4px',
  },
  detailsIcon: {
    ...baseStyles.detailsIcon,
    width: '18px',
    height: '18px',
    fontSize: '12px',
  },
  reRandomizeButton: {
    ...baseStyles.reRandomizeButton,
    padding: '2px',
    borderRadius: '4px',
  },
  reRandomizeIcon: {
    ...baseStyles.reRandomizeIcon,
    width: '18px',
    height: '18px',
    fontSize: '14px',
  },
  plateTitleRow: baseStyles.plateTitleRow,
  plateQualityRow: baseStyles.plateQualityRow,
  plateButtons: baseStyles.plateButtons,
  grid: {
    ...baseStyles.grid,
    gap: '10px',
  },
  columnLabels: {
    ...baseStyles.columnLabels,
    gap: '10px',
  },
  columnLabel: {
    ...baseStyles.columnLabel,
    width: `${DIMENSIONS.full.cellWidth}px`,
    padding: '5px',
  },
  row: {
    ...baseStyles.row,
    gap: '10px',
  },
  rowLabel: {
    ...baseStyles.rowLabel,
    width: `${DIMENSIONS.full.rowLabelWidth}px`,
    padding: '5px',
  },
  searchWell: {
    width: `${DIMENSIONS.full.cellWidth}px`,
    minHeight: '60px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '5px',
    transition: 'all 0.2s ease',
  },
  emptyWell: {
    width: `${DIMENSIONS.full.cellWidth}px`,
    minHeight: '60px',
    backgroundColor: '#fff',
    border: '1px solid #ccc',
    borderRadius: '4px',
    padding: '5px',
  },
  emptyCell: {
    width: `${DIMENSIONS.full.rowLabelWidth}px`,
    padding: '5px',
  },
  compactSearchIndicator: baseStyles.compactSearchIndicator,
  fullSearchCard: baseStyles.fullSearchCard,
  searchTitle: baseStyles.searchTitle,
  searchDivider: baseStyles.searchDivider,
  searchMetadata: baseStyles.searchMetadata,
  highlightedWell: {
    border: '4px solid #2196f3',
    boxShadow: '0 0 12px rgba(33, 150, 243, 0.5), inset 0 0 0 1px rgba(33, 150, 243, 0.3)',
    transform: 'scale(1.02)',
  },
};

const compactStyles = {
  ...baseStyles,
  plate: {
    border: '1px solid #ccc',
    borderRadius: '4px',
    padding: '8px',
    backgroundColor: '#f5f5f5',
    fontSize: '10px',
  },
  plateHeader: {
    ...baseStyles.plateHeader,
    marginBottom: '4px',
  },
  plateHeading: {
    ...baseStyles.plateHeading,
    fontSize: '14px',
    textAlign: 'center' as const,
    flex: 1,
  },
  detailsButton: {
    ...baseStyles.detailsButton,
    padding: '1px',
    borderRadius: '2px',
  },
  detailsIcon: {
    ...baseStyles.detailsIcon,
    width: '14px',
    height: '14px',
    fontSize: '10px',
  },
  reRandomizeButton: {
    ...baseStyles.reRandomizeButton,
    padding: '1px',
    borderRadius: '2px',
  },
  reRandomizeIcon: {
    ...baseStyles.reRandomizeIcon,
    width: '14px',
    height: '14px',
    fontSize: '12px',
  },
  plateTitleRow: baseStyles.plateTitleRow,
  plateQualityRow: baseStyles.plateQualityRow,
  plateButtons: baseStyles.plateButtons,
  grid: {
    ...baseStyles.grid,
    gap: '2px',
  },
  columnLabels: {
    ...baseStyles.columnLabels,
    gap: '2px',
  },
  columnLabel: {
    ...baseStyles.columnLabel,
    width: `${DIMENSIONS.compact.cellWidth + 2}px`, // Add 2px for borders
    padding: '1px',
    fontSize: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    ...baseStyles.row,
    gap: '2px',
  },
  rowLabel: {
    ...baseStyles.rowLabel,
    width: `${DIMENSIONS.compact.rowLabelWidth}px`,
    padding: '1px',
    fontSize: '8px',
  },
  searchWell: {
    width: `${DIMENSIONS.compact.cellWidth}px`,
    height: '16px',
    border: '1px solid #ddd',
    borderRadius: '2px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '1px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  emptyWell: {
    width: `${DIMENSIONS.compact.cellWidth}px`,
    height: '16px',
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '2px',
    padding: '1px',
  },
  emptyCell: {
    width: `${DIMENSIONS.compact.rowLabelWidth}px`,
    padding: '1px',
  },
  compactSearchIndicator: baseStyles.compactSearchIndicator,
  fullSearchCard: baseStyles.fullSearchCard,
  searchTitle: baseStyles.searchTitle,
  searchDivider: baseStyles.searchDivider,
  searchMetadata: baseStyles.searchMetadata,
  highlightedWell: {
    border: '4px solid rgba(33, 150, 243, 0.5)',
    boxShadow: '0 0 12px rgba(33, 150, 243, 0.8), inset 0 0 0 1px rgba(33, 150, 243, 0.3)',
    transform: 'scale(1.05)',
  },
};

export default Plate;