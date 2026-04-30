import React, { useState } from 'react';
import { RandomizationAlgorithm, getAlgorithmName, getAlgorithmDescription, getAlgorithmsInDisplayOrder, GroupingConstraint, GroupValidationResult, SubjectGroup } from '../utils/types';

interface ConfigurationFormProps {
  availableColumns: string[];
  selectedIdColumn: string;
  onIdColumnChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  searches: any[];
  selectedCovariates: string[];
  onCovariateChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  qcColumn: string;
  onQcColumnChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  qcColumnValues: string[];
  selectedQcValues: string[];
  onQcValueToggle: (value: string) => void;
  selectedAlgorithm: RandomizationAlgorithm;
  onAlgorithmChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  keepEmptyInLastPlate: boolean;
  onKeepEmptyInLastPlateChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  plateRows: number;
  plateColumns: number;
  onPlateRowsChange: (value: number) => void;
  onPlateColumnsChange: (value: number) => void;
  onResetCovariateState: () => void;
  subjectColumn: string;
  onSubjectColumnChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  groupingConstraint: GroupingConstraint;
  onGroupingConstraintChange: (constraint: GroupingConstraint) => void;
  groupValidation: GroupValidationResult | null;
  subjectGroups: SubjectGroup[];
}

const ConfigurationForm: React.FC<ConfigurationFormProps> = ({
  availableColumns,
  selectedIdColumn,
  onIdColumnChange,
  searches,
  selectedCovariates,
  onCovariateChange,
  qcColumn: qcColumn,
  onQcColumnChange: onQcColumnChange,
  qcColumnValues: qcColumnValues,
  selectedQcValues: selectedQcValues,
  onQcValueToggle: onQcValueToggle,
  selectedAlgorithm,
  onAlgorithmChange,
  keepEmptyInLastPlate,
  onKeepEmptyInLastPlateChange,
  plateRows,
  plateColumns,
  onPlateRowsChange,
  onPlateColumnsChange,
  onResetCovariateState,
  subjectColumn,
  onSubjectColumnChange,
  groupingConstraint,
  onGroupingConstraintChange,
  groupValidation,
  subjectGroups,
}) => {
  // Collapsible section states
  const [showQcDetails, setShowQcDetails] = useState(true);
  const [showSubjectDetails, setShowSubjectDetails] = useState(true);

  // Reset collapsed state when QC column or subject column is cleared (e.g., new file upload)
  React.useEffect(() => {
    if (!qcColumn) setShowQcDetails(true);
  }, [qcColumn]);
  React.useEffect(() => {
    if (!subjectColumn) setShowSubjectDetails(true);
  }, [subjectColumn]);

  if (availableColumns.length === 0) return null;

  // Mutual exclusivity: columns available for subject column dropdown
  // Exclude selected covariates and QC column
  const availableSubjectColumns = searches.length > 0
    ? Object.keys(searches[0].metadata).filter(
        col => !selectedCovariates.includes(col) && col !== qcColumn
      )
    : [];

  // Mutual exclusivity: columns available for covariates
  // Exclude selected subject column
  const availableCovariateColumns = searches.length > 0
    ? Object.keys(searches[0].metadata).filter(
        col => col !== subjectColumn || subjectColumn === ''
      )
    : [];

  // Build subject group summary
  const buildGroupSummary = () => {
    if (subjectGroups.length === 0) return null;

    const multiGroups = subjectGroups.filter(g => !g.subjectId.startsWith('__singleton_'));
    const singletonCount = subjectGroups.filter(g => g.subjectId.startsWith('__singleton_')).length;
    const sizes = multiGroups.map(g => g.size);
    const minSize = sizes.length > 0 ? Math.min(...sizes) : 0;
    const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;

    // Build breakdown by size
    const sizeCountMap = new Map<number, number>();
    for (const size of sizes) {
      sizeCountMap.set(size, (sizeCountMap.get(size) ?? 0) + 1);
    }
    const breakdown = Array.from(sizeCountMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([size, count]) => `${count} group${count > 1 ? 's' : ''} of size ${size}`)
      .join(', ');

    return {
      totalGroups: multiGroups.length,
      singletonCount,
      minSize,
      maxSize,
      breakdown,
    };
  };

  const groupSummary = subjectColumn ? buildGroupSummary() : null;

  return (
    <div style={styles.compactFormContainer}>
      {/* Top Row: ID Column and Covariates */}
      <div style={styles.compactRow}>
        {/* Left Column: ID Column Selection and Algorithm */}
        <div style={styles.compactColumn}>
          <label htmlFor="idColumn" style={styles.compactLabel}>Select ID Column:</label>
          <select
            id="idColumn"
            value={selectedIdColumn}
            onChange={onIdColumnChange}
            style={styles.compactSelect}
          >
            {availableColumns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>

          <label htmlFor="qcColumn" style={{ ...styles.compactLabel, marginTop: '10px' }}>
            QC/Reference Column (optional):
          </label>
          <select
            id="qcColumn"
            value={qcColumn}
            onChange={onQcColumnChange}
            style={styles.compactSelect}
          >
            <option value="">None</option>
            {availableColumns
              .filter((column) => column !== selectedIdColumn && (column !== subjectColumn || subjectColumn === ''))
              .map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
          </select>

          {qcColumnValues.length > 0 && (
            <>
              {showQcDetails ? (
                <div style={styles.qcValuesContainer}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <small style={styles.compactLabel}>Select QC/Reference values:</small>
                    <button
                      onClick={() => setShowQcDetails(false)}
                      style={styles.collapseToggle}
                      type="button"
                    >▲ Hide</button>
                  </div>
                  <div style={styles.checkboxGroup}>
                    {qcColumnValues.map((value) => (
                      <label key={value} style={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={selectedQcValues.includes(value)}
                          onChange={() => onQcValueToggle(value)}
                          style={styles.checkbox}
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => setShowQcDetails(true)}
                    style={styles.collapseToggle}
                    type="button"
                  >▼ Edit</button>
                  {selectedQcValues.length > 0 && (
                    <div style={styles.selectedCovariatesDisplay}>
                      <small style={styles.selectedCovariatesList}>
                        <span style={styles.selectedCovariatesLabel}>QC values: </span>
                        {selectedQcValues.join(', ')}
                      </small>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <label htmlFor="subjectColumn" style={{ ...styles.compactLabel, marginTop: '10px' }}>
            Subject ID Column (optional):
          </label>
          <small style={styles.compactHint}>
            For repeated measures — keeps all samples from the same subject on the same plate or row
          </small>
          <select
            id="subjectColumn"
            value={subjectColumn}
            onChange={onSubjectColumnChange}
            style={styles.compactSelect}
          >
            <option value="">None</option>
            {availableSubjectColumns
              .filter((column) => column !== selectedIdColumn)
              .map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
          </select>

          {/* Grouping Constraint - only visible when subject column is selected */}
          {subjectColumn && (
            <>
              {showSubjectDetails ? (
                <>
                  <div style={styles.groupingConstraintContainer}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <small style={styles.compactLabel}>Grouping Constraint:</small>
                      <button
                        onClick={() => setShowSubjectDetails(false)}
                        style={styles.collapseToggle}
                        type="button"
                      >▲ Hide</button>
                    </div>
                    <div style={styles.radioGroup}>
                      <label style={styles.radioLabel}>
                        <input
                          type="radio"
                          name="groupingConstraint"
                          checked={groupingConstraint === 'same-row'}
                          onChange={() => onGroupingConstraintChange('same-row')}
                          style={styles.radio}
                        />
                        Same Row
                      </label>
                      <label style={styles.radioLabel}>
                        <input
                          type="radio"
                          name="groupingConstraint"
                          checked={groupingConstraint === 'same-plate'}
                          onChange={() => onGroupingConstraintChange('same-plate')}
                          style={styles.radio}
                        />
                        Same Plate
                      </label>
                    </div>
                  </div>

                  {/* Validation errors/warnings */}
                  {groupValidation && groupValidation.errors.length > 0 && (
                    <div style={styles.validationErrorContainer}>
                      {groupValidation.errors.map((error, idx) => (
                        <div key={idx} style={styles.validationError}>{error}</div>
                      ))}
                    </div>
                  )}
                  {groupValidation && groupValidation.warnings.length > 0 && (
                    <div style={styles.validationWarningContainer}>
                      {groupValidation.warnings.map((warning, idx) => (
                        <div key={idx} style={styles.validationWarning}>{warning}</div>
                      ))}
                    </div>
                  )}

                  {/* Subject group summary */}
                  {groupSummary && (
                    <div style={styles.groupSummaryContainer}>
                      <small style={styles.compactLabel}>Subject Groups:</small>
                      <div style={styles.groupSummaryText}>
                        {groupSummary.totalGroups} group{groupSummary.totalGroups !== 1 ? 's' : ''}
                        {groupSummary.totalGroups > 0 && ` (size ${groupSummary.minSize === groupSummary.maxSize ? groupSummary.minSize : `${groupSummary.minSize}–${groupSummary.maxSize}`})`}
                        {groupSummary.singletonCount > 0 && `, ${groupSummary.singletonCount} singleton${groupSummary.singletonCount !== 1 ? 's' : ''} (no ${subjectColumn})`}
                      </div>
                      {groupSummary.breakdown && (
                        <div style={styles.groupBreakdownText}>{groupSummary.breakdown}</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => setShowSubjectDetails(true)}
                    style={styles.collapseToggle}
                    type="button"
                  >▼ Edit</button>
                  <div style={styles.selectedCovariatesDisplay}>
                    <small style={styles.selectedCovariatesList}>
                      <span style={styles.selectedCovariatesLabel}>Constraint: </span>
                      {groupingConstraint === 'same-row' ? 'Same Row' : 'Same Plate'}
                      {groupSummary && ` · ${groupSummary.totalGroups} groups`}
                      {groupSummary && groupSummary.singletonCount > 0 && `, ${groupSummary.singletonCount} singletons`}
                    </small>
                  </div>
                  {/* Always show validation errors even when collapsed */}
                  {groupValidation && groupValidation.errors.length > 0 && (
                    <div style={{ ...styles.validationErrorContainer, marginTop: 0, flex: 'none' }}>
                      {groupValidation.errors.map((error, idx) => (
                        <div key={idx} style={styles.validationError}>{error}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {getAlgorithmsInDisplayOrder().length > 1 && (
            <>
              <label htmlFor="algorithm" style={{ ...styles.compactLabel, marginTop: '10px' }}>
                Randomization Algorithm:
              </label>
              <select
                id="algorithm"
                value={selectedAlgorithm}
                onChange={onAlgorithmChange}
                style={styles.compactSelect}
              >
                {getAlgorithmsInDisplayOrder().map((algorithm) => (
                  <option key={algorithm} value={algorithm}>
                    {getAlgorithmName(algorithm)}
                  </option>
                ))}
              </select>
              <small style={styles.algorithmDescription}>
                {getAlgorithmDescription(selectedAlgorithm)}
              </small>
            </>
          )}
        </div>

        {/* Right Column: Covariate Selection */}
        {searches.length > 0 && (
          <div style={styles.compactColumn}>
            <label htmlFor="covariates" style={styles.compactLabel}>Select Covariates:</label>
            <select
              id="covariates"
              multiple
              value={selectedCovariates}
              onChange={onCovariateChange}
              style={styles.compactMultiSelect}
            >
              {availableCovariateColumns.map((covariate) => {
                // Get unique values for this covariate
                const values = new Set<string>();
                searches.forEach(search => {
                  const value = search.metadata[covariate];
                  if (value) {
                    values.add(value);
                  }
                });
                const uniqueValues = Array.from(values).sort();

                // Format display: show values if 5 or less, otherwise show count
                let displayText = covariate;
                if (uniqueValues.length > 0) {
                  if (uniqueValues.length <= 8) {
                    displayText += ` (${uniqueValues.join(', ')})`;
                  } else {
                    displayText += ` (${uniqueValues.length} values)`;
                  }
                }

                return (
                  <option key={covariate} value={covariate}>
                    {displayText}
                  </option>
                );
              })}
            </select>
            <small style={styles.compactHint}>Hold Ctrl/Cmd to select multiple options</small>
            {selectedCovariates.length > 0 && (
              <div style={styles.selectedCovariatesDisplay}>
                <small style={styles.selectedCovariatesList}>
                  <span style={styles.selectedCovariatesLabel}>Selected: </span>
                  {selectedCovariates.join(', ')}
                </small>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Non-greedy Algorithm Options */}
      {selectedAlgorithm !== 'greedy' && (
        <div style={styles.compactRow}>
          <div style={styles.fullWidthColumn}>
            <div style={styles.balancedOptionsContainer}>
              <div style={styles.optionsRow}>
                {groupingConstraint === 'none' && (
                  <label style={styles.compactCheckboxLabel}>
                    <input
                      type="checkbox"
                      checked={keepEmptyInLastPlate}
                      onChange={onKeepEmptyInLastPlateChange}
                      style={styles.checkbox}
                    />
                    Keep empty spots in last plate
                  </label>
                )}

                <div style={styles.plateDimensionsInline}>
                  <span style={styles.dimensionLabel}>Plate Rows:</span>
                  <input
                    id="plateRows"
                    type="number"
                    min="1"
                    max="16"
                    value={plateRows}
                    onChange={(e) => {
                      const value = Math.max(1, Math.min(16, parseInt(e.target.value) || 8));
                      onPlateRowsChange(value);
                      onResetCovariateState();
                    }}
                    style={styles.compactDimensionInput}
                  />

                  <span style={styles.dimensionLabel}>Plate Columns:</span>
                  <input
                    id="plateColumns"
                    type="number"
                    min="1"
                    max="24"
                    value={plateColumns}
                    onChange={(e) => {
                      const value = Math.max(1, Math.min(24, parseInt(e.target.value) || 12));
                      onPlateColumnsChange(value);
                      onResetCovariateState();
                    }}
                    style={styles.compactDimensionInput}
                  />

                  <small style={styles.compactDimensionNote}>
                    Plate size: {plateRows} × {plateColumns} = {plateRows * plateColumns} wells
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  compactFormContainer: {
    width: '100%',
    maxWidth: '1200px',
    marginBottom: '25px',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    border: '1px solid #e9ecef',
  },
  compactRow: {
    display: 'flex',
    gap: '30px',
    marginBottom: '20px',
    alignItems: 'flex-start',
  },
  compactColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },
  fullWidthColumn: {
    width: '100%',
  },
  compactLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '0px',
  },
  compactSelect: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #ddd',
    fontSize: '14px',
    backgroundColor: '#fff',
    minHeight: '20px',
  },
  compactMultiSelect: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #ddd',
    fontSize: '14px',
    backgroundColor: '#fff',
    minHeight: '165px',
    resize: 'vertical' as const,
  },
  compactTextInput: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #ddd',
    fontSize: '14px',
    backgroundColor: '#fff',
    minHeight: '20px',
  },
  compactHint: {
    color: '#666',
    fontSize: '12px',
    fontStyle: 'italic',
    marginTop: '0px',
    marginLeft: '3px',
  },
  algorithmDescription: {
    color: '#666',
    fontSize: '11px',
    fontStyle: 'italic',
    lineHeight: '1.3',
    marginTop: '2px',
  },
  selectedCovariatesDisplay: {
    marginTop: '0px',
    padding: '8px',
    backgroundColor: '#e3f2fd',
    borderRadius: '4px',
    border: '1px solid #bbdefb',
  },
  selectedCovariatesList: {
    fontSize: '12px',
    color: '#1976d2',
  },
  selectedCovariatesLabel: {
    fontWeight: '600',
  },
  balancedOptionsContainer: {
    padding: '15px',
    backgroundColor: '#fff',
    borderRadius: '6px',
    border: '1px solid #ddd',
  },
  optionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '30px',
    flexWrap: 'wrap' as const,
  },
  compactCheckboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '14px',
    color: '#333',
    cursor: 'pointer',
    fontWeight: '500',
  },
  checkbox: {
    marginRight: '8px',
    cursor: 'pointer',
  },
  plateDimensionsInline: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  dimensionLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
  },
  compactDimensionInput: {
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    fontSize: '14px',
    width: '60px',
    textAlign: 'center' as const,
  },
  compactDimensionNote: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  qcValuesContainer: {
    marginTop: '8px',
    padding: '10px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    marginTop: '6px',
    maxHeight: '120px',
    overflowY: 'auto' as const,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '13px',
    color: '#333',
    cursor: 'pointer',
  },
  groupingConstraintContainer: {
    marginTop: '8px',
    padding: '10px',
    backgroundColor: '#fff',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  radioGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '6px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '13px',
    color: '#333',
    cursor: 'pointer',
  },
  radio: {
    marginRight: '6px',
    cursor: 'pointer',
  },
  validationErrorContainer: {
    marginTop: '8px',
    padding: '8px 10px',
    backgroundColor: '#fdecea',
    borderRadius: '4px',
    border: '1px solid #f5c6cb',
  },
  validationError: {
    fontSize: '12px',
    color: '#721c24',
    lineHeight: '1.4',
  },
  validationWarningContainer: {
    marginTop: '6px',
    padding: '8px 10px',
    backgroundColor: '#fff3cd',
    borderRadius: '4px',
    border: '1px solid #ffeeba',
  },
  validationWarning: {
    fontSize: '12px',
    color: '#856404',
    lineHeight: '1.4',
  },
  groupSummaryContainer: {
    marginTop: '8px',
    padding: '8px 10px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    border: '1px solid #c8e6c9',
  },
  groupSummaryText: {
    fontSize: '12px',
    color: '#2e7d32',
    marginTop: '4px',
    lineHeight: '1.4',
  },
  groupBreakdownText: {
    fontSize: '11px',
    color: '#558b2f',
    marginTop: '2px',
    fontStyle: 'italic' as const,
  },
  collapseToggle: {
    background: 'none',
    border: 'none',
    color: '#1976d2',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '0',
    fontWeight: '500',
    whiteSpace: 'nowrap' as const,
  },
};

export default ConfigurationForm;