import React from 'react';
import { getAllQualityLevels } from '../utils/utils';
import QualitySwatch from './QualitySwatch';

const QualityLegend: React.FC = () => {
  const qualityLevels = getAllQualityLevels();

  return (
    <div style={styles.legend} data-testid="quality-legend">
      <div style={styles.legendTitle}>Quality Scores:</div>
      <div style={styles.legendItems}>
        {qualityLevels.map((item) => (
          <div key={item.level} style={styles.legendItem}>
            <QualitySwatch color={item.color} />
            <span style={styles.range}>{item.range}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const styles = {
  legend: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    padding: '10px 20px',
    backgroundColor: '#f8f9fa',
    border: '1px solid #e9ecef',
    borderRadius: '6px',
    marginBottom: '20px',
    fontSize: '12px',
  },
  legendTitle: {
    fontWeight: '600',
    color: '#495057',
    marginRight: '10px',
  },
  legendItems: {
    display: 'flex',
    gap: '15px',
    alignItems: 'center',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  range: {
    fontWeight: '500',
    color: '#495057',
  },
};

export default QualityLegend;