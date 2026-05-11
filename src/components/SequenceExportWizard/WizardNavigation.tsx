import React from 'react';

interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  canProceed: boolean;
  onNext: () => void;
  onPrev: () => void;
  onCancel: () => void;
  onExportSequence?: () => void;
  onExportMapping?: () => void;
  showMappingExport?: boolean;
}

export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  currentStep,
  totalSteps,
  canProceed,
  onNext,
  onPrev,
  onCancel,
  onExportSequence,
  onExportMapping,
  showMappingExport,
}) => {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;

  return (
    <div style={styles.container}>
      <button style={styles.cancelButton} onClick={onCancel}>
        Cancel
      </button>
      <div style={styles.rightButtons}>
        {!isFirstStep && (
          <button style={styles.backButton} onClick={onPrev}>
            ← Back
          </button>
        )}
        {isLastStep ? (
          <>
            {showMappingExport && onExportMapping && (
              <button style={styles.mappingButton} onClick={onExportMapping}>
                Download ID Mapping CSV
              </button>
            )}
            {onExportSequence && (
              <button style={styles.exportButton} onClick={onExportSequence}>
                Download Sequence CSV
              </button>
            )}
          </>
        ) : (
          <button
            style={{
              ...styles.nextButton,
              ...(canProceed ? {} : styles.disabledButton),
            }}
            onClick={onNext}
            disabled={!canProceed}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderTop: '1px solid #e0e0e0',
  },
  cancelButton: {
    padding: '8px 16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#666',
  },
  rightButtons: {
    display: 'flex',
    gap: '8px',
  },
  backButton: {
    padding: '8px 16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
  },
  nextButton: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#1976d2',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  exportButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#4caf50',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  mappingButton: {
    padding: '8px 16px',
    border: '1px solid #1976d2',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '14px',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
  },
};
