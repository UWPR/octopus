import React, { useCallback, useState } from 'react';
import { FileNamingConfig, FilenameField, SeparatorChar, UNSAFE_FILENAME_CHARS } from '../../../utils/sequenceExportTypes';

interface FileNamingStepProps {
  fileNamingConfig: FileNamingConfig;
  updateFileNaming: (updates: Partial<FileNamingConfig>) => void;
  filenamePreview: string;
  availableFields: FilenameField[];
}

const SEPARATOR_OPTIONS: { value: SeparatorChar; label: string }[] = [
  { value: '_', label: 'Underscore (_)' },
  { value: '-', label: 'Hyphen (-)' },
  { value: '.', label: 'Period (.)' },
];

export const FileNamingStep: React.FC<FileNamingStepProps> = ({
  fileNamingConfig,
  updateFileNaming,
  filenamePreview,
  availableFields,
}) => {
  const { selectedFields, separator, sampleIdMode, serialIdConfig, generateMappingFile } = fileNamingConfig;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isUnsafeSeparator = UNSAFE_FILENAME_CHARS.test(separator);

  const isFieldSelected = (fieldId: string) =>
    selectedFields.some(f => f.id === fieldId);

  const toggleField = useCallback((field: FilenameField) => {
    const isSelected = selectedFields.some(f => f.id === field.id);
    if (isSelected) {
      updateFileNaming({ selectedFields: selectedFields.filter(f => f.id !== field.id) });
    } else {
      updateFileNaming({ selectedFields: [...selectedFields, field] });
    }
  }, [selectedFields, updateFileNaming]);

  const updateFieldValue = useCallback((fieldId: string, value: string) => {
    const updated = selectedFields.map(f =>
      f.id === fieldId ? { ...f, value } : f
    );
    updateFileNaming({ selectedFields: updated });
  }, [selectedFields, updateFileNaming]);

  const moveField = useCallback((fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= selectedFields.length) return;
    const newFields = [...selectedFields];
    const [moved] = newFields.splice(fromIdx, 1);
    newFields.splice(toIdx, 0, moved);
    updateFileNaming({ selectedFields: newFields });
  }, [selectedFields, updateFileNaming]);

  const isFreeTextField = (id: string) =>
    ['projectName', 'experimentName', 'instrumentName'].includes(id);

  const isCustomSeparator = !SEPARATOR_OPTIONS.some(opt => opt.value === separator);

  return (
    <div>
      <h3 style={styles.heading}>File Naming Template</h3>
      <p style={styles.description}>
        Select fields to include in the file name, reorder them, and choose a separator character.
      </p>

      {/* Preview */}
      <div style={styles.previewBox}>
        <span style={styles.previewLabel}>Preview:</span>
        <code style={styles.previewValue}>
          {filenamePreview || '(select at least one field)'}
        </code>
      </div>

      {/* Separator */}
      <div style={styles.section}>
        <h4 style={styles.subheading}>Separator</h4>
        <div style={styles.separatorRow}>
          {SEPARATOR_OPTIONS.map(opt => (
            <label key={opt.value} style={styles.radioLabel}>
              <input
                type="radio"
                name="separator"
                checked={separator === opt.value && !isCustomSeparator}
                onChange={() => updateFileNaming({ separator: opt.value })}
              />
              {opt.label}
            </label>
          ))}
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="separator"
              checked={isCustomSeparator}
              onChange={() => updateFileNaming({ separator: '~' })}
            />
            Custom:
            <input
              style={styles.customSepInput}
              type="text"
              maxLength={1}
              value={isCustomSeparator ? separator : ''}
              onChange={e => updateFileNaming({ separator: e.target.value || '_' })}
            />
          </label>
        </div>
        {isUnsafeSeparator && (
          <div style={styles.separatorWarning}>
            ⚠ Character "{separator}" is not safe for Windows filenames. Consider using _, -, or . instead.
          </div>
        )}
      </div>

      {/* Field Selection */}
      <div style={styles.section}>
        <h4 style={styles.subheading}>Available Fields</h4>
        <div style={styles.fieldsGrid}>
          {availableFields.map(field => (
            <label key={field.id} style={styles.fieldCheckbox}>
              <input
                type="checkbox"
                checked={isFieldSelected(field.id)}
                onChange={() => toggleField(field)}
              />
              {field.label}
            </label>
          ))}
        </div>
      </div>

      {/* Selected Fields Order */}
      {selectedFields.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.subheading}>Field Order (drag to reorder)</h4>
          <div style={styles.orderedList}>
            {selectedFields.map((field, idx) => (
              <div
                key={field.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', idx.toString());
                  setDragIndex(idx);
                }}
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverIndex(idx);
                }}
                onDragLeave={() => setDragOverIndex(null)}
                onDrop={e => {
                  e.preventDefault();
                  const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  if (!isNaN(fromIdx) && fromIdx !== idx) {
                    moveField(fromIdx, idx);
                  }
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                style={{
                  ...styles.orderedItem,
                  ...(dragIndex === idx ? styles.dragging : {}),
                  ...(dragOverIndex === idx && dragIndex !== idx ? styles.dragOver : {}),
                  cursor: 'grab',
                }}
              >
                <div style={styles.dragHandle}>⠿</div>
                <div style={styles.orderControls}>
                  <button
                    style={styles.orderButton}
                    onClick={() => moveField(idx, idx - 1)}
                    disabled={idx === 0}
                  >
                    ↑
                  </button>
                  <button
                    style={styles.orderButton}
                    onClick={() => moveField(idx, idx + 1)}
                    disabled={idx === selectedFields.length - 1}
                  >
                    ↓
                  </button>
                </div>
                <span style={styles.orderedLabel}>{field.label}</span>
                {isFreeTextField(field.id) && (
                  <input
                    style={{
                      ...styles.freeTextInput,
                      ...(!(field.value || '').trim() ? styles.invalidInput : {}),
                    }}
                    type="text"
                    placeholder={`Enter ${field.label.toLowerCase()}...`}
                    value={field.value || ''}
                    onChange={e => updateFieldValue(field.id, e.target.value)}
                  />
                )}
              </div>
            ))}
            <div style={styles.runCounterNote}>
              + Run Counter (always appended last, zero-padded)
            </div>
          </div>
        </div>
      )}

      {/* Sample ID Mode */}
      {isFieldSelected('sampleId') && (
        <div style={styles.section}>
          <h4 style={styles.subheading}>Sample Identifier Mode</h4>
          <div style={styles.radioGroup}>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="sampleIdMode"
                checked={sampleIdMode === 'original'}
                onChange={() => updateFileNaming({ sampleIdMode: 'original' })}
              />
              Use original sample ID from data
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="sampleIdMode"
                checked={sampleIdMode === 'serial'}
                onChange={() => updateFileNaming({ sampleIdMode: 'serial', generateMappingFile: true })}
              />
              Generate serial IDs
            </label>
          </div>

          {sampleIdMode === 'serial' && (
            <div style={styles.serialConfig}>
              <label style={styles.fieldLabel}>
                Prefix:
                <input
                  style={styles.textInput}
                  type="text"
                  placeholder="LTC"
                  value={serialIdConfig.prefix}
                  onChange={e => updateFileNaming({
                    serialIdConfig: { ...serialIdConfig, prefix: e.target.value },
                  })}
                />
              </label>
              <label style={styles.fieldLabel}>
                Start number:
                <input
                  style={styles.numberInput}
                  type="number"
                  min={1}
                  value={serialIdConfig.startNumber}
                  onChange={e => updateFileNaming({
                    serialIdConfig: { ...serialIdConfig, startNumber: parseInt(e.target.value) || 1 },
                  })}
                />
              </label>
              <label style={styles.mappingCheckbox}>
                <input
                  type="checkbox"
                  checked={generateMappingFile}
                  onChange={e => updateFileNaming({ generateMappingFile: e.target.checked })}
                />
                Generate ID mapping CSV file
              </label>
            </div>
          )}
        </div>
      )}

      {selectedFields.length === 0 && (
        <div style={styles.validationMsg}>
          Select at least one field to proceed.
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 8px 0', fontSize: '18px' },
  description: { margin: '0 0 16px 0', color: '#666', fontSize: '14px' },
  previewBox: {
    padding: '10px 14px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  previewLabel: { fontSize: '13px', fontWeight: 600 },
  previewValue: { fontSize: '13px', fontFamily: 'monospace', color: '#1976d2' },
  section: { marginBottom: '16px' },
  subheading: { margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 },
  separatorRow: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' },
  separatorWarning: {
    marginTop: '6px',
    padding: '6px 10px',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#856404',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
  customSepInput: {
    width: '30px',
    padding: '2px 6px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    textAlign: 'center',
    marginLeft: '4px',
  },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '6px',
  },
  fieldCheckbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  orderedList: {
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    padding: '8px',
  },
  orderedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.1s',
    userSelect: 'none',
  },
  dragging: {
    opacity: 0.5,
    backgroundColor: '#e3f2fd',
  },
  dragOver: {
    borderTop: '2px solid #1976d2',
  },
  dragHandle: {
    fontSize: '14px',
    color: '#999',
    cursor: 'grab',
    lineHeight: 1,
  },
  orderControls: { display: 'flex', flexDirection: 'column', gap: '2px' },
  orderButton: {
    width: '20px',
    height: '16px',
    border: '1px solid #ccc',
    borderRadius: '2px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  orderedLabel: { fontSize: '13px', fontWeight: 500, minWidth: '120px' },
  freeTextInput: {
    padding: '4px 8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ccc',
    borderRadius: '4px',
    fontSize: '13px',
    flex: 1,
    maxWidth: '200px',
  },
  runCounterNote: {
    padding: '6px 8px',
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  serialConfig: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    marginTop: '8px',
    padding: '10px',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px',
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '13px',
  },
  textInput: {
    padding: '6px 10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '120px',
  },
  numberInput: {
    padding: '6px 8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '80px',
  },
  invalidInput: { borderColor: '#d32f2f' },
  mappingCheckbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  validationMsg: {
    padding: '8px 12px',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '4px',
    fontSize: '13px',
  },
};
