import React, { useMemo } from 'react';
import { SearchData } from '../utils/types';

interface SubjectPlacement {
  subjectId: string;
  sampleCount: number;
  plates: Map<number, number[]>; // plateIndex → row indices
}

interface SubjectPlacementPanelProps {
  randomizedPlates: (SearchData | undefined)[][][];
  subjectColumn: string;
  selectedSubject: string | null;
  onSubjectClick: (subjectId: string) => void;
  show: boolean;
}

const SubjectPlacementPanel: React.FC<SubjectPlacementPanelProps> = ({
  randomizedPlates,
  subjectColumn,
  selectedSubject,
  onSubjectClick,
  show,
}) => {
  const placements = useMemo(() => {
    const map = new Map<string, SubjectPlacement>();

    for (let pIdx = 0; pIdx < randomizedPlates.length; pIdx++) {
      const plate = randomizedPlates[pIdx];
      for (let rIdx = 0; rIdx < plate.length; rIdx++) {
        for (let cIdx = 0; cIdx < plate[rIdx].length; cIdx++) {
          const sample = plate[rIdx][cIdx];
          if (!sample) continue;
          const subjectId = sample.metadata[subjectColumn]?.trim();
          if (!subjectId) continue;

          if (!map.has(subjectId)) {
            map.set(subjectId, { subjectId, sampleCount: 0, plates: new Map() });
          }
          const placement = map.get(subjectId)!;
          placement.sampleCount++;
          if (!placement.plates.has(pIdx)) {
            placement.plates.set(pIdx, []);
          }
          const rows = placement.plates.get(pIdx)!;
          if (!rows.includes(rIdx)) {
            rows.push(rIdx);
          }
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  }, [randomizedPlates, subjectColumn]);

  if (!show) return null;

  const getRowLabel = (rowIndex: number) => String.fromCharCode(65 + rowIndex);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerText}>
          {subjectColumn} Placements ({placements.length} subjects)
        </span>
      </div>
      <div style={styles.scrollArea}>
        {placements.map((p) => {
          const isSelected = selectedSubject === p.subjectId;
          const plateEntries = Array.from(p.plates.entries()).sort((a, b) => a[0] - b[0]);
          const locationStr = plateEntries
            .map(([pIdx, rows]) => {
              const rowLabels = rows.sort((a, b) => a - b).map(getRowLabel).join(',');
              return `P${pIdx + 1}:${rowLabels}`;
            })
            .join(' ');

          return (
            <div
              key={p.subjectId}
              onClick={() => onSubjectClick(p.subjectId)}
              style={{
                ...styles.item,
                ...(isSelected ? styles.itemSelected : {}),
              }}
            >
              <span style={styles.subjectId}>{p.subjectId}</span>
              <span style={styles.location}>{locationStr}</span>
              <span style={styles.count}>{p.sampleCount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: '1200px',
    marginBottom: '15px',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    backgroundColor: '#fafafa',
    overflow: 'hidden',
  },
  header: {
    padding: '8px 12px',
    backgroundColor: '#f0f0f0',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#333',
  },
  scrollArea: {
    maxHeight: '200px',
    overflowY: 'auto',
    padding: '4px 8px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  item: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
    boxShadow: 'none',
  },
  itemSelected: {
    backgroundColor: '#e3f2fd',
    borderColor: '#2196f3',
    boxShadow: '0 0 4px rgba(33, 150, 243, 0.3)',
  },
  subjectId: {
    fontWeight: '600',
    color: '#333',
  },
  location: {
    color: '#888',
    fontSize: '10px',
  },
  count: {
    color: '#999',
    fontSize: '10px',
    fontStyle: 'italic',
  },
};

export default SubjectPlacementPanel;
