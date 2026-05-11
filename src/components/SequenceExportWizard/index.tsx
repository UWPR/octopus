import React, { useEffect } from 'react';
import { SearchData } from '../../utils/types';
import { useSequenceExportWizard, UseSequenceExportWizardProps } from '../../hooks/useSequenceExportWizard';
import { isSSActive } from '../../utils/sequenceExport';
import { WizardStepIndicator } from './WizardStepIndicator';
import { WizardNavigation } from './WizardNavigation';
import { SampleCategoryStep } from './steps/SampleCategoryStep';
import { SystemSuitabilityStep } from './steps/SystemSuitabilityStep';
import { SlotAssignmentStep } from './steps/SlotAssignmentStep';
import { PathsMethodsStep } from './steps/PathsMethodsStep';
import { FileNamingStep } from './steps/FileNamingStep';
import { PreviewExportStep } from './steps/PreviewExportStep';

interface SequenceExportWizardProps {
  plates: (SearchData | undefined)[][][];
  searches: SearchData[];
  qcColumn?: string;
  selectedQcValues?: string[];
  plateRows: number;
  plateCols: number;
  onClose: () => void;
  visible: boolean;
  inputFileName?: string;
}

const STEP_LABELS = [
  'System Suitability',
  'Slot Assignment',
  'File Naming',
  'Sample Categories',
  'Paths & Instrument Methods',
  'Preview & Export',
];

const SequenceExportWizard: React.FC<SequenceExportWizardProps> = ({
  plates,
  searches,
  qcColumn,
  selectedQcValues,
  plateRows,
  plateCols,
  onClose,
  visible,
  inputFileName,
}) => {
  const wizardProps: UseSequenceExportWizardProps = {
    plates,
    qcColumn,
    selectedQcValues,
    plateRows,
    plateCols,
    inputFileName,
  };

  const wizard = useSequenceExportWizard(wizardProps);

  const renderStepContent = () => {
    switch (wizard.currentStep) {
      case 1:
        return (
          <SystemSuitabilityStep
            ssConfig={wizard.ssConfig}
            updateSSConfig={wizard.updateSSConfig}
          />
        );
      case 2:
        return (
          <SlotAssignmentStep
            slotAssignment={wizard.slotAssignment}
            updateSlotAssignment={wizard.updateSlotAssignment}
            ssEnabled={isSSActive(wizard.ssConfig)}
            plateCount={plates.length}
            oversizedPlateWarning={wizard.oversizedPlateWarning}
            plateRows={plateRows}
            plateCols={plateCols}
          />
        );
      case 3:
        return (
          <FileNamingStep
            fileNamingConfig={wizard.fileNamingConfig}
            updateFileNaming={wizard.updateFileNaming}
            filenamePreview={wizard.filenamePreview}
            availableFields={wizard.availableFields}
          />
        );
      case 4:
        return (
          <SampleCategoryStep
            sampleCategories={wizard.sampleCategories}
            setSampleCategory={wizard.setSampleCategory}
            addCategory={wizard.addCategory}
            removeCategory={wizard.removeCategory}
            searches={searches}
          />
        );
      case 5: {
        const pathCategories = isSSActive(wizard.ssConfig)
          ? [...wizard.sampleCategories.categories, 'System Suitability']
          : wizard.sampleCategories.categories;
        return (
          <PathsMethodsStep
            pathsConfig={wizard.pathsConfig}
            categories={pathCategories}
            updateCategorySettings={wizard.updateCategorySettings}
            applyToAllCategories={wizard.applyToAllCategories}
          />
        );
      }
      case 6:
        return (
          <PreviewExportStep
            generatedSequence={wizard.generatedSequence}
          />
        );
      default:
        return null;
    }
  };

  // Reset to step 1 when wizard is closed (Cancel)
  useEffect(() => {
    if (!visible) {
      wizard.resetStep();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Export Sequence Wizard">
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Export Injection Sequence</h2>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close wizard">
            ✕
          </button>
        </div>

        <WizardStepIndicator
          currentStep={wizard.currentStep}
          stepLabels={STEP_LABELS}
          goToStep={wizard.goToStep}
        />

        <div style={styles.content}>
          {renderStepContent()}
        </div>

        <WizardNavigation
          currentStep={wizard.currentStep}
          totalSteps={STEP_LABELS.length}
          canProceed={wizard.canProceed}
          onNext={wizard.nextStep}
          onPrev={wizard.prevStep}
          onCancel={onClose}
          onExportSequence={wizard.exportSequenceCSV}
          onExportMapping={wizard.exportMappingCSV}
          showMappingExport={wizard.fileNamingConfig.sampleIdMode === 'serial' && wizard.fileNamingConfig.generateMappingFile}
        />
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    width: '90vw',
    maxWidth: '1100px',
    minWidth: '600px',
    height: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 600,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#666',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  },
};

export default SequenceExportWizard;
