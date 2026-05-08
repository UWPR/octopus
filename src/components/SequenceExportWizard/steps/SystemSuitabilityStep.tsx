import React from 'react';
import { SystemSuitabilityConfig, UNSAFE_FILENAME_CHARS } from '../../../utils/sequenceExportTypes';

interface SystemSuitabilityStepProps {
  ssConfig: SystemSuitabilityConfig;
  updateSSConfig: (updates: Partial<SystemSuitabilityConfig>) => void;
}

export const SystemSuitabilityStep: React.FC<SystemSuitabilityStepProps> = ({
  ssConfig,
  updateSSConfig,
}) => {
  return (
    <div>
      <h3 style={styles.heading}>System Suitability</h3>
      <p style={styles.description}>
        Add System Suitability sample injections at defined intervals.
      </p>

      <div style={styles.fieldGroup}>
        <h4 style={styles.subheading}>Run Placement</h4>
        <div style={styles.gridLayout}>
          <label style={styles.fieldLabel}>
            Runs at start:
            <input
              style={styles.numberInput}
              type="number"
              min={0}
              max={10}
              value={ssConfig.runsAtStart}
              onChange={e => updateSSConfig({ runsAtStart: parseInt(e.target.value) || 0 })}
            />
          </label>
          <label style={styles.fieldLabel}>
            Runs at end:
            <input
              style={styles.numberInput}
              type="number"
              min={0}
              max={10}
              value={ssConfig.runsAtEnd}
              onChange={e => updateSSConfig({ runsAtEnd: parseInt(e.target.value) || 0 })}
            />
          </label>
          <label style={styles.fieldLabel}>
            Runs during experiment:
            <input
              style={styles.numberInput}
              type="number"
              min={0}
              value={ssConfig.runsDuring}
              onChange={e => updateSSConfig({ runsDuring: parseInt(e.target.value) || 0 })}
            />
          </label>
          <label style={styles.fieldLabel}>
            Every N samples:
            <input
              style={styles.numberInput}
              type="number"
              min={1}
              value={ssConfig.insertionInterval}
              onChange={e => updateSSConfig({ insertionInterval: parseInt(e.target.value) || 1 })}
              disabled={ssConfig.runsDuring === 0}
            />
          </label>
        </div>
      </div>

      <div style={styles.fieldGroup}>
        <h4 style={styles.subheading}>Sample Identifier</h4>
        <label style={styles.fieldLabel}>
          Identifier used in filenames for System Suitability runs:
          <input
            style={{
              ...styles.textInput,
              ...(!ssConfig.sampleIdentifier.trim() && (ssConfig.runsAtStart > 0 || ssConfig.runsAtEnd > 0 || ssConfig.runsDuring > 0)
                ? { borderColor: '#d32f2f' } : {}),
            }}
            type="text"
            placeholder="SS"
            value={ssConfig.sampleIdentifier}
            onChange={e => updateSSConfig({ sampleIdentifier: e.target.value })}
          />
          {UNSAFE_FILENAME_CHARS.test(ssConfig.sampleIdentifier) && (
            <span style={styles.warningText}>
              ⚠ Contains characters unsafe for Windows filenames
            </span>
          )}
        </label>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 8px 0', fontSize: '18px' },
  description: { margin: '0 0 16px 0', color: '#666', fontSize: '14px' },
  fieldGroup: {
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    padding: '12px',
  },
  subheading: { margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 },
  gridLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 24px',
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '13px',
    color: '#333',
  },
  numberInput: {
    padding: '6px 8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  },
  textInput: {
    padding: '6px 10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '200px',
  },
  warningText: {
    display: 'block',
    marginTop: '4px',
    fontSize: '12px',
    color: '#856404',
  },
};
