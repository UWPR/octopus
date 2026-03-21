import React, { useState, useEffect } from 'react';

import { SearchData } from '../utils/types';

interface ExcelExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (selectedCovariates: string[]) => void;
  availableCovariates: string[];
  treatmentCovariates: string[];
  searches: SearchData[];
  sampleIdColumn: string;
  subjectColumn?: string;
  qcColumn?: string;
}

const ExcelExportModal: React.FC<ExcelExportModalProps> = ({
  isOpen,
  onClose,
  onExport,
  availableCovariates,
  treatmentCovariates,
  searches,
  sampleIdColumn,
  subjectColumn,
  qcColumn
}) => {
  const [selectedCovariates, setSelectedCovariates] = useState<string[]>([]);

  // Initialize with treatment covariates + subject column + QC column when modal opens
  useEffect(() => {
    if (isOpen) {
      const preSelected = new Set(treatmentCovariates);
      if (subjectColumn) preSelected.add(subjectColumn);
      if (qcColumn) preSelected.add(qcColumn);
      setSelectedCovariates(Array.from(preSelected));
    }
  }, [isOpen, treatmentCovariates, subjectColumn, qcColumn]);

  // Sort covariates: Sample ID first, then treatment covariates, then others
  const sortedCovariates = React.useMemo(() => {
    const sampleId = sampleIdColumn ? [sampleIdColumn] : [];
    const treatment = treatmentCovariates.filter(cov => cov !== sampleIdColumn);
    const others = availableCovariates.filter(
      cov => cov !== sampleIdColumn && !treatmentCovariates.includes(cov)
    );
    return [...sampleId, ...treatment, ...others];
  }, [availableCovariates, treatmentCovariates, sampleIdColumn]);

  // Get unique values for a covariate
  const getCovariateValues = (covariate: string): string[] => {
    const values = new Set<string>();
    searches.forEach(search => {
      const value = search.metadata[covariate];
      if (value) {
        values.add(value);
      }
    });
    return Array.from(values).sort();
  };

  // Format covariate values for display
  const formatCovariateValues = (covariate: string): string => {
    const values = getCovariateValues(covariate);
    if (values.length === 0) return '';

    // Always show all values for treatment covariates
    const isTreatment = treatmentCovariates.includes(covariate);
    if (isTreatment) {
      return `(${values.join(', ')})`;
    }

    // For non-treatment covariates, show count if more than 10 values
    if (values.length > 10) {
      return `(${values.length} values)`;
    }
    return `(${values.join(', ')})`;
  };

  if (!isOpen) return null;

  const handleToggleCovariate = (covariate: string) => {
    setSelectedCovariates(prev =>
      prev.includes(covariate)
        ? prev.filter(c => c !== covariate)
        : [...prev, covariate]
    );
  };

  const handleSelectAll = () => {
    setSelectedCovariates(availableCovariates);
  };

  const handleSelectNone = () => {
    setSelectedCovariates([]);
  };

  const handleExport = () => {
    onExport(selectedCovariates);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Select Covariates for Excel Export</h2>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>

        <div style={styles.content}>
          <p style={styles.description}>
            Choose which covariate values to display in the plate layout cells.
          </p>

          <div style={styles.buttonGroup}>
            <button onClick={handleSelectAll} style={styles.selectButton}>
              Select All
            </button>
            <button onClick={handleSelectNone} style={styles.selectButton}>
              Select None
            </button>
          </div>

          <div style={styles.covariateList}>
            {sortedCovariates.map(covariate => {
              const isTreatment = treatmentCovariates.includes(covariate);
              const isSampleId = covariate === sampleIdColumn;
              const isSelected = selectedCovariates.includes(covariate);
              const valuesText = formatCovariateValues(covariate);

              return (
                <label
                  key={covariate}
                  style={{
                    ...styles.covariateItem,
                    ...(isSampleId ? styles.disabledItem : {})
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleCovariate(covariate)}
                    style={styles.checkbox}
                    disabled={isSampleId}
                  />
                  <span style={styles.covariateNameContainer}>
                    <span style={styles.covariateName}>
                      {covariate}
                      {isSampleId && <span style={styles.sampleIdBadge}>Sample ID</span>}
                      {isTreatment && <span style={styles.treatmentBadge}>Treatment</span>}
                    </span>
                    {valuesText && <span style={styles.covariateValues}>{valuesText}</span>}
                  </span>
                </label>
              );
            })}
          </div>

          <div style={styles.footer}>
            <button onClick={onClose} style={styles.cancelButton}>
              Cancel
            </button>
            <button
              onClick={handleExport}
              style={styles.exportButton}
              disabled={selectedCovariates.length === 0}
            >
              Export ({selectedCovariates.length} selected)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '28px',
    cursor: 'pointer',
    color: '#666',
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
  },
  content: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1,
  },
  description: {
    margin: '0 0 16px 0',
    color: '#666',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  selectButton: {
    padding: '6px 12px',
    fontSize: '13px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  covariateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '300px',
    overflowY: 'auto',
    padding: '8px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
  },
  covariateItem: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '8px',
    cursor: 'pointer',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
  },
  checkbox: {
    marginRight: '10px',
    marginTop: '2px',
    cursor: 'pointer',
    width: '16px',
    height: '16px',
    flexShrink: 0,
  },
  covariateNameContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },
  covariateName: {
    fontSize: '14px',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '500',
  },
  covariateValues: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
  },
  treatmentBadge: {
    fontSize: '11px',
    padding: '2px 6px',
    backgroundColor: '#2196f3',
    color: '#fff',
    borderRadius: '3px',
    fontWeight: '600',
  },
  sampleIdBadge: {
    fontSize: '11px',
    padding: '2px 6px',
    backgroundColor: '#999',
    color: '#fff',
    borderRadius: '3px',
    fontWeight: '600',
  },
  disabledItem: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e0e0e0',
  },
  cancelButton: {
    padding: '8px 16px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  exportButton: {
    padding: '8px 16px',
    fontSize: '14px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#2196f3',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'background-color 0.2s',
  },
};

export default ExcelExportModal;
