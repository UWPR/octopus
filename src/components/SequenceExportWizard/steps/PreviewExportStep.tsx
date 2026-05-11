import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GeneratedSequence } from '../../../utils/sequenceExportTypes';

interface PreviewExportStepProps {
  generatedSequence: GeneratedSequence;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Experimental': '#e8f5e9',
  'System Suitability': '#e3f2fd',
  'BatchQC': '#fff3e0',
  'BatchRef': '#fce4ec',
  'Pool': '#f3e5f5',
  'Library': '#e0f7fa',
};

const COLUMNS = [
  { key: 'runNumber', label: 'Row #', defaultWidth: 60 },
  { key: 'fileName', label: 'File Name', defaultWidth: 280 },
  { key: 'path', label: 'Path', defaultWidth: 160 },
  { key: 'instrumentMethod', label: 'Instrument Method', defaultWidth: 200 },
  { key: 'position', label: 'Position', defaultWidth: 80 },
  { key: 'injectionVolume', label: 'Inj Vol', defaultWidth: 60 },
];

export const PreviewExportStep: React.FC<PreviewExportStepProps> = ({
  generatedSequence,
}) => {
  const { rows, categoryCounts, totalRuns } = generatedSequence;

  const [columnWidths, setColumnWidths] = useState<number[]>(
    COLUMNS.map(c => c.defaultWidth)
  );

  // Store active drag cleanup function so we can call it on unmount
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      // Clean up any active drag listeners if component unmounts mid-drag
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    cleanupRef.current?.(); // dispose any stale listeners before starting a new drag
    const startX = e.clientX;
    const startWidth = columnWidths[colIndex];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      const newWidth = Math.max(40, startWidth + diff);
      setColumnWidths(prev => {
        const next = [...prev];
        next[colIndex] = newWidth;
        return next;
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      cleanupRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Store cleanup so unmount can remove listeners
    cleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [columnWidths]);

  return (
    <div>
      <h3 style={styles.heading}>Preview & Export</h3>

      {/* Summary */}
      <div style={styles.summary}>
        <span style={styles.summaryTotal}>Total runs: <strong>{totalRuns}</strong></span>
        <div style={styles.summaryBreakdown}>
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <span key={cat} style={{
              ...styles.summaryChip,
              backgroundColor: CATEGORY_COLORS[cat] || '#f5f5f5',
            }}>
              {cat}: {count}
            </span>
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              {COLUMNS.map((col, colIdx) => (
                <th
                  key={col.key}
                  style={{
                    ...styles.th,
                    width: `${columnWidths[colIdx]}px`,
                    minWidth: `${columnWidths[colIdx]}px`,
                    maxWidth: `${columnWidths[colIdx]}px`,
                  }}
                >
                  <div style={styles.thContent}>
                    <span>{col.label}</span>
                    <div
                      style={styles.resizeHandle}
                      onMouseDown={e => handleMouseDown(e, colIdx)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.runNumber}
                style={{
                  backgroundColor: CATEGORY_COLORS[row.category] || '#fff',
                }}
              >
                <td style={{ ...styles.td, width: `${columnWidths[0]}px` }}>{row.runNumber}</td>
                <td style={{ ...styles.td, ...styles.cellOverflow, width: `${columnWidths[1]}px` }}>{row.fileName}</td>
                <td style={{ ...styles.td, ...styles.cellOverflow, width: `${columnWidths[2]}px` }}>{row.path}</td>
                <td style={{ ...styles.td, ...styles.cellOverflow, width: `${columnWidths[3]}px` }}>{row.instrumentMethod}</td>
                <td style={{ ...styles.td, width: `${columnWidths[4]}px` }}>{row.position}</td>
                <td style={{ ...styles.td, width: `${columnWidths[5]}px` }}>{row.injectionVolume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 12px 0', fontSize: '18px' },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  summaryTotal: { fontSize: '14px' },
  summaryBreakdown: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  summaryChip: {
    padding: '3px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  tableContainer: {
    maxHeight: '400px',
    overflow: 'auto',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
  },
  table: {
    borderCollapse: 'collapse',
    fontSize: '12px',
    tableLayout: 'fixed',
  },
  th: {
    position: 'sticky',
    top: 0,
    backgroundColor: '#f5f5f5',
    padding: '0',
    textAlign: 'left',
    borderBottom: '2px solid #e0e0e0',
    borderRight: '1px solid #ddd',
    fontWeight: 600,
    fontSize: '12px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  thContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    position: 'relative',
  },
  resizeHandle: {
    position: 'absolute',
    right: 0,
    top: '4px',
    bottom: '4px',
    width: '3px',
    cursor: 'col-resize',
    backgroundColor: '#ccc',
    borderRadius: '2px',
  },
  td: {
    padding: '6px 10px',
    borderBottom: '1px solid #f0f0f0',
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cellOverflow: {
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
