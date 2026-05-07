import React from 'react';

interface WizardStepIndicatorProps {
  currentStep: number;
  stepLabels: string[];
  goToStep: (step: number) => void;
}

export const WizardStepIndicator: React.FC<WizardStepIndicatorProps> = ({
  currentStep,
  stepLabels,
  goToStep,
}) => {
  return (
    <div style={styles.container}>
      {stepLabels.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;

        return (
          <div key={stepNum} style={styles.stepWrapper}>
            <button
              style={{
                ...styles.stepButton,
                ...(isCompleted ? styles.completedStep : {}),
                ...(!isCompleted && !isActive ? styles.disabledStep : {}),
              }}
              onClick={() => { if (isCompleted) goToStep(stepNum); }}
              aria-label={`Step ${stepNum}: ${label}`}
              aria-current={isActive ? 'step' : undefined}
              disabled={!isCompleted && !isActive}
            >
              <span style={{
                ...styles.stepNumber,
                ...(isActive ? styles.activeNumber : {}),
                ...(isCompleted ? styles.completedNumber : {}),
              }}>
                {isCompleted ? '✓' : stepNum}
              </span>
              <span style={{
                ...styles.stepLabel,
                ...(isActive ? styles.activeLabel : {}),
              }}>
                {label}
              </span>
            </button>
            {idx < stepLabels.length - 1 && (
              <div style={{
                ...styles.connector,
                ...(isCompleted ? styles.completedConnector : {}),
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #e0e0e0',
    gap: '0',
    flexWrap: 'wrap',
    rowGap: '8px',
  },
  stepWrapper: {
    display: 'flex',
    alignItems: 'center',
  },
  stepButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 4px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
  },
  stepNumber: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: '#e0e0e0',
    color: '#666',
    flexShrink: 0,
  },
  activeNumber: {
    backgroundColor: '#1976d2',
    color: '#fff',
  },
  completedNumber: {
    backgroundColor: '#4caf50',
    color: '#fff',
  },
  stepLabel: {
    fontSize: '12px',
    color: '#666',
  },
  activeLabel: {
    color: '#1976d2',
    fontWeight: 600,
  },
  completedStep: { cursor: 'pointer' },
  disabledStep: { cursor: 'default', opacity: 0.6 },
  connector: {
    width: '10px',
    height: '2px',
    backgroundColor: '#e0e0e0',
    margin: '0 3px',
    flexShrink: 0,
  },
  completedConnector: {
    backgroundColor: '#e0e0e0',
  },
};
