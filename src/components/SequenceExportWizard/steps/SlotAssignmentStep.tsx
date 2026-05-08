import React from 'react';
import { SlotColor, SlotAssignment } from '../../../utils/sequenceExportTypes';

interface SlotAssignmentStepProps {
  slotAssignment: SlotAssignment;
  updateSlotAssignment: (updates: Partial<SlotAssignment>) => void;
  ssEnabled: boolean;
  plateCount: number;
  oversizedPlateWarning: boolean;
  plateRows: number;
  plateCols: number;
}

const ALL_SLOTS: SlotColor[] = ['Y', 'B', 'R', 'G'];

const SLOT_LABELS: Record<SlotColor, string> = {
  Y: 'Yellow',
  B: 'Blue',
  R: 'Red',
  G: 'Green',
};

export const SlotAssignmentStep: React.FC<SlotAssignmentStepProps> = ({
  slotAssignment,
  updateSlotAssignment,
  ssEnabled,
  plateCount,
  oversizedPlateWarning,
  plateRows,
  plateCols,
}) => {
  const availableForPlates = ALL_SLOTS.filter(s => s !== slotAssignment.ssSlot);

  return (
    <div>
      <h3 style={styles.heading}>Autosampler Slot Assignment</h3>
      <p style={styles.description}>
        Assign autosampler slots to your plates. Each slot corresponds to a physical tray position.
      </p>

      {oversizedPlateWarning && (
        <div style={styles.warning}>
          ⚠ Plate dimensions exceed standard autosampler capacity (8×12). Ensure your autosampler supports this configuration.
        </div>
      )}

      {plateCount > availableForPlates.length && (
        <div style={styles.warning}>
          ⚠ Not enough slots for all plates. Some plates share a slot — you will need to physically swap plates during the run.
        </div>
      )}

      <div style={styles.plateSection}>
        <h4 style={styles.subheading}>Plate Assignments</h4>

        {ssEnabled && (
          <div style={styles.plateRow}>
            <span style={styles.plateRowLabel}>System Suitability:</span>
            <select
              aria-label="System Suitability slot"
              style={styles.select}
              value={slotAssignment.ssSlot || ''}
              onChange={e => updateSlotAssignment({ ssSlot: (e.target.value || null) as SlotColor | null })}
            >
              <option value="">— Select slot —</option>
              {ALL_SLOTS.map(slot => (
                <option key={slot} value={slot}>
                  {SLOT_LABELS[slot]} ({slot})
                </option>
              ))}
            </select>
            <span style={styles.wellLabel}>Well:</span>
            <select
              aria-label="System Suitability well"
              style={styles.wellSelect}
              value={slotAssignment.ssWell}
              onChange={e => updateSlotAssignment({ ssWell: e.target.value })}
            >
              {Array.from({ length: plateRows }, (_, r) =>
                Array.from({ length: plateCols }, (_, c) => {
                  const well = `${String.fromCharCode(65 + r)}${c + 1}`;
                  return <option key={well} value={well}>{well}</option>;
                })
              ).flat()}
            </select>
          </div>
        )}

        {Array.from({ length: plateCount }, (_, i) => (
          <div key={i} style={styles.plateRow}>
            <span style={styles.plateRowLabel}>Plate {i + 1}:</span>
            <select
              style={styles.select}
              value={slotAssignment.plateSlots[i] || ''}
              onChange={e => {
                const newPlateSlots = { ...slotAssignment.plateSlots, [i]: e.target.value as SlotColor };
                updateSlotAssignment({ plateSlots: newPlateSlots } as Partial<SlotAssignment>);
              }}
            >
              {availableForPlates.map(slot => (
                <option key={slot} value={slot}>
                  {SLOT_LABELS[slot]} ({slot})
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 8px 0', fontSize: '18px' },
  description: { margin: '0 0 16px 0', color: '#666', fontSize: '14px' },
  warning: {
    padding: '8px 12px',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '4px',
    marginBottom: '12px',
    fontSize: '14px',
  },
  plateSection: {},
  subheading: { margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 },
  plateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },
  plateRowLabel: { fontSize: '13px', fontWeight: 500, minWidth: '160px' },
  wellLabel: { fontSize: '13px', color: '#555', marginLeft: '12px' },
  select: {
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '13px',
    minWidth: '140px',
  },
  wellSelect: {
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '13px',
    minWidth: '70px',
    marginLeft: '4px',
  },
};
