import React, { useState, useEffect, useMemo } from 'react';
import FileUploadSection from './components/FileUploadSection';
import ConfigurationForm from './components/ConfigurationForm';
import SummaryPanel from './components/SummaryPanel';
import PlateDetailsModal from './components/PlateDetailsModal';
import ExcelExportModal from './components/ExcelExportModal';
import PlatesGrid from './components/PlatesGrid';
import QualityMetricsPanel from './components/QualityMetricsPanel';
import QualityLegend from './components/QualityLegend';
import SubjectPlacementPanel from './components/SubjectPlacementPanel';
import { SearchData, RandomizationAlgorithm, GroupingConstraint, GroupValidationResult, RepeatedMeasuresConfig } from './utils/types';
import { downloadCSV, buildCovariateKey, getCovariateKey, getQualityLevelColor, formatScore } from './utils/utils';
import { exportToExcel } from './utils/excelExport';
import { useFileUpload } from './hooks/useFileUpload';
import { useModalDrag } from './hooks/useModalDrag';
import { useRandomization } from './hooks/useRandomization';
import { useCovariateColors } from './hooks/useCovariateColors';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useQualityMetrics } from './hooks/useQualityMetrics';
import { isDeveloperMode } from './utils/configs';
import { buildSubjectGroups, validateSubjectGroups } from './algorithms/repeatedMeasuresDistribution';



const App: React.FC = () => {

  const defaultAlgorithm = "balanced";

  // File upload hook
  const {
    searches,
    availableColumns,
    selectedIdColumn,
    selectedFileName,
    handleFileUpload,
    handleIdColumnChange,
  } = useFileUpload();

  // Modal drag hook
  const {
    modalPosition,
    isDraggingModal,
    handleModalMouseDown,
    handleModalMouseMove,
    handleModalMouseUp,
    resetModalPosition,
  } = useModalDrag();

  // Randomization hook
  const {
    isProcessed,
    randomizedPlates,
    plateAssignments,
    processRandomization,
    reRandomize,
    reRandomizeSinglePlate,
    resetRandomization,
    updatePlates,
  } = useRandomization();

  // Covariate colors hook
  const {
    covariateColors,
    summaryData,
    generateCovariateColors,
    generateSummaryData,
    resetColors,
  } = useCovariateColors();

  // Drag and drop hook
  const {
    draggedSearch,
    handleDragStart,
    handleDragOver,
    handleDrop,
  } = useDragAndDrop(randomizedPlates, updatePlates);

  // Quality metrics hook
  const {
    metrics,
    isCalculating,
    showMetrics,
    calculateMetrics,
    resetMetrics,
    toggleMetrics,
    qualitySummary
  } = useQualityMetrics();



  // Configuration states
  const [selectedCovariates, setSelectedCovariates] = useState<string[]>([]);
  const [qcColumn, setQcColumn] = useState<string>('');
  const [qcColumnValues, setQcColumnValues] = useState<string[]>([]);
  const [selectedQcValues, setSelectedQcValues] = useState<string[]>([]);

  // Algorithm selection
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<RandomizationAlgorithm>(defaultAlgorithm);
  const [keepEmptyInLastPlate, setKeepEmptyInLastPlate] = useState<boolean>(false);

  // Plate dimensions
  const [plateRows, setPlateRows] = useState<number>(8);
  const [plateColumns, setPlateColumns] = useState<number>(12);

  // UI states
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [compactView, setCompactView] = useState<boolean>(true);
  const [selectedCombination, setSelectedCombination] = useState<string | null>(null);
  const [showPlateDetails, setShowPlateDetails] = useState<boolean>(false);
  const [selectedPlateIndex, setSelectedPlateIndex] = useState<number | null>(null);
  const [showExcelExportModal, setShowExcelExportModal] = useState<boolean>(false);
  const [randomizationError, setRandomizationError] = useState<string | null>(null);

  // Subject placement panel state
  const [showSubjectPlacements, setShowSubjectPlacements] = useState<boolean>(false);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  // Repeated-measures state
  const [subjectColumn, setSubjectColumn] = useState<string>('');
  const [groupingConstraint, setGroupingConstraint] = useState<GroupingConstraint>('none');
  const [groupValidation, setGroupValidation] = useState<GroupValidationResult | null>(null);

  // Compute subject groups whenever subject column or searches change
  const subjectGroups = useMemo(() => {
    if (!subjectColumn || searches.length === 0) return [];
    return buildSubjectGroups(searches, subjectColumn);
  }, [subjectColumn, searches]);


  // Calculate quality metrics when randomization completes or plates change
  useEffect(() => {
    if (isProcessed && randomizedPlates.length > 0 && plateAssignments && selectedCovariates.length > 0) {
      calculateMetrics(
        searches,
        randomizedPlates,
        plateAssignments,
        selectedCovariates,
        groupingConstraint !== 'none' ? groupingConstraint : undefined
      );
    }
  }, [isProcessed, randomizedPlates, plateAssignments, selectedCovariates, searches, calculateMetrics, groupingConstraint]);

  // Reset all state when a new file is uploaded (but not on initial load)
  useEffect(() => {
    // Only reset if we have a filename and searches data (indicating a successful file upload)
    if (selectedFileName && searches.length > 0) {
      // Reset all application state except the file upload state
      resetRandomization();
      setRandomizationError(null);
      resetColors();
      resetMetrics();
      resetModalPosition();

      // Reset configuration states
      setSelectedCovariates([]);
      setQcColumn('');
      setQcColumnValues([]);
      setSelectedQcValues([]);

      // Reset repeated-measures state
      setSubjectColumn('');
      setGroupingConstraint('none');
      setGroupValidation(null);

      // Reset algorithm selection (keep defaults)
      setSelectedAlgorithm(defaultAlgorithm);
      setKeepEmptyInLastPlate(false);

      // Reset plate dimensions (keep defaults)
      setPlateRows(8);
      setPlateColumns(12);

      // Reset UI states
      setShowSummary(false);
      setCompactView(true);
      setSelectedCombination(null);
      setShowPlateDetails(false);
      setSelectedPlateIndex(null);
      setShowSubjectPlacements(false);
      setSelectedSubject(null);
    }
  }, [selectedFileName, searches.length]); // Trigger when filename changes or searches are loaded

  // Run validation whenever subject column, grouping constraint, or plate dimensions change
  useEffect(() => {
    if (subjectColumn && searches.length > 0 && groupingConstraint !== 'none') {
      const experimentalSamples = searches.filter(s => {
        if (qcColumn && selectedQcValues.length > 0) {
          const sampleValue = s.metadata[qcColumn];
          if (sampleValue && selectedQcValues.includes(sampleValue)) return false;
        }
        return true;
      });
      const groups = buildSubjectGroups(experimentalSamples, subjectColumn);
      const rowCapacity = plateColumns;
      const plateCapacity = plateRows * plateColumns;
      const numPlates = Math.ceil(searches.length / plateCapacity);
      const totalWellCapacity = numPlates * plateCapacity;
      const numQcSamples = searches.length - experimentalSamples.length;
      const result = validateSubjectGroups(groups, groupingConstraint, rowCapacity, plateCapacity, totalWellCapacity, plateRows, numQcSamples);
      setGroupValidation(result);
    } else {
      setGroupValidation(null);
    }
  }, [subjectColumn, groupingConstraint, plateRows, plateColumns, searches, qcColumn, selectedQcValues]);

  const resetCovariateState = () => {
    resetRandomization();
    setRandomizationError(null);
    resetColors();
    resetMetrics();
    setShowSummary(false);
    setSelectedCombination(null);
  };

  // Update QC column values when QC column changes
  useEffect(() => {
    if (qcColumn && searches.length > 0) {
      const uniqueValues = new Set<string>();
      searches.forEach(search => {
        const value = search.metadata[qcColumn];
        if (value) {
          uniqueValues.add(value);
        }
      });
      setQcColumnValues(Array.from(uniqueValues).sort());
      setSelectedQcValues([]); // Reset selected values when column changes
    } else {
      setQcColumnValues([]);
      setSelectedQcValues([]);
    }
  }, [qcColumn, searches]);



  // Algorithm selection handler
  const handleAlgorithmChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newAlgorithm = event.target.value as RandomizationAlgorithm;
    setSelectedAlgorithm(newAlgorithm);
    resetCovariateState(); // Reset processing state when algorithm changes
  };

  // Empty spots option handler
  const handleKeepEmptyInLastPlateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setKeepEmptyInLastPlate(event.target.checked);
    resetCovariateState(); // Reset processing state when option changes
  };

  // Covariate selection handler
  const handleCovariateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedOptions = Array.from(event.target.selectedOptions, (option) => option.value);
    setSelectedCovariates(selectedOptions);

    // Conflict resolution: clear subject column if it's now a selected covariate
    if (subjectColumn && selectedOptions.includes(subjectColumn)) {
      setSubjectColumn('');
      setGroupingConstraint('none');
      setGroupValidation(null);
    }

    resetCovariateState();
  };

  // ID column change handler with reset
  const handleIdColumnChangeWithReset = (event: React.ChangeEvent<HTMLSelectElement>) => {
    handleIdColumnChange(event);
    resetCovariateState();
  };

  // QC column change handler
  const handleQcColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newQcColumn = event.target.value;
    setQcColumn(newQcColumn);

    // Conflict resolution: clear subject column if it matches the new QC column
    if (subjectColumn && newQcColumn === subjectColumn) {
      setSubjectColumn('');
      setGroupingConstraint('none');
      setGroupValidation(null);
    }

    resetCovariateState();
  };

  // QC value checkbox handler
  const handleQcValueToggle = (value: string) => {
    setSelectedQcValues(prev => {
      if (prev.includes(value)) {
        return prev.filter(v => v !== value);
      } else {
        return [...prev, value];
      }
    });
    resetCovariateState();
  };

  // Subject column change handler with mutual exclusivity conflict resolution
  const handleSubjectColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newSubjectColumn = event.target.value;
    setSubjectColumn(newSubjectColumn);

    if (newSubjectColumn) {
      // Conflict resolution: deselect if new subject column is a selected covariate
      if (selectedCovariates.includes(newSubjectColumn)) {
        setSelectedCovariates(prev => prev.filter(c => c !== newSubjectColumn));
      }
      // Conflict resolution: clear QC column if it matches
      if (qcColumn === newSubjectColumn) {
        setQcColumn('');
        setQcColumnValues([]);
        setSelectedQcValues([]);
      }
      // Default to same-row constraint when subject column is selected
      if (groupingConstraint === 'none') {
        setGroupingConstraint('same-row');
      }
    }

    // Reset grouping constraint to none when subject column is cleared
    if (!newSubjectColumn) {
      setGroupingConstraint('none');
    }

    resetCovariateState();
  };

  // Grouping constraint change handler
  const handleGroupingConstraintChange = (constraint: GroupingConstraint) => {
    setGroupingConstraint(constraint);
    resetCovariateState();
  };



  // Helper function to set treatment keys and mark QC/Reference samples
  const processMetadata = (searchesList: SearchData[]) => {
    searchesList.forEach(search => {
      // Determine if this sample is a QC/Reference sample
      let isQC = false;

      // Check if QC column is selected and values are checked
      if (qcColumn && selectedQcValues.length > 0) {
        const sampleValue = search.metadata[qcColumn];
        if (sampleValue && selectedQcValues.includes(sampleValue)) {
          isQC = true;
        }
      }

      search.isQC = isQC;

      // Generate covariate key using buildCovariateKey with QC info
      search.covariateKey = buildCovariateKey(search, {
        selectedCovariates,
        qcColumn: qcColumn,
        selectedQcValues: selectedQcValues
      });
    });
  };

  // Main processing handler
  const handleProcessRandomization = () => {
    if (selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0) {
      // Clear any previous error
      setRandomizationError(null);

      // Process metadata and set the covariateKey
      processMetadata(searches);

      // Build repeated measures config
      const repeatedMeasuresConfig: RepeatedMeasuresConfig | undefined =
        subjectColumn ? { subjectColumn, groupingConstraint } : undefined;

      try {
        // Process randomization
        const success = processRandomization(
          searches,
          selectedCovariates,
          selectedAlgorithm,
          keepEmptyInLastPlate,
          plateRows,
          plateColumns,
          repeatedMeasuresConfig
        );

        if (success) {
          // Generate colors (pass QC info for proper color assignment)
          const colors = generateCovariateColors(
            searches,
            selectedCovariates,
            qcColumn,
            selectedQcValues
          );

          // Generate summary data
          generateSummaryData(
            colors,
            searches,
            selectedCovariates,
            qcColumn,
            selectedQcValues
          );
        }
      } catch (err: any) {
        setRandomizationError(err.message || 'An unexpected error occurred during randomization.');
      }
    }
  };

  // Download CSV handler
  const handleDownloadCSV = () => {
    if (selectedIdColumn) {
      downloadCSV(searches, randomizedPlates, selectedIdColumn, selectedFileName);
    }
  };

  // Download Excel handler - opens modal for covariate selection
  const handleDownloadExcel = () => {
    if (selectedCovariates.length > 0 && randomizedPlates.length > 0) {
      setShowExcelExportModal(true);
    }
  };

  // Actual export after covariate selection
  const handleExcelExport = async (exportCovariates: string[]) => {
    await exportToExcel({
      searches,
      randomizedPlates,
      covariateColors,
      treatmentCovariates: selectedCovariates, // Original treatment covariates for color lookup
      exportCovariates: exportCovariates, // User-selected covariates to display
      numRows: plateRows,
      numColumns: plateColumns,
      inputFileName: selectedFileName
    });
  };

  // Re-randomization handler
  const handleReRandomize = () => {
    if (selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0) {
      // Process metadata and set the covariateKey
      processMetadata(searches);

      // Build repeated measures config
      const repeatedMeasuresConfig: RepeatedMeasuresConfig | undefined =
        subjectColumn ? { subjectColumn, groupingConstraint } : undefined;

      // Re-randomize - colors are already generated, so we don't need to regenerate them
      reRandomize(
        searches,
        selectedCovariates,
        selectedAlgorithm,
        keepEmptyInLastPlate,
        plateRows,
        plateColumns,
        repeatedMeasuresConfig
      );
    }
  };

  // Single plate re-randomization handler
  const handleReRandomizePlate = (plateIndex: number) => {
    if (selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0) {
      // Process metadata and set the covariateKey
      processMetadata(searches);

      // Build repeated measures config
      const repeatedMeasuresConfig: RepeatedMeasuresConfig | undefined =
        subjectColumn ? { subjectColumn, groupingConstraint } : undefined;

      reRandomizeSinglePlate(
        plateIndex,
        searches,
        selectedCovariates,
        selectedAlgorithm,
        keepEmptyInLastPlate,
        plateRows,
        plateColumns,
        repeatedMeasuresConfig
      );
      // Quality metrics will be recalculated automatically via useEffect
    }
  };

  // Handle clicking on summary items for highlighting
  const handleSummaryItemClick = (combination: string) => {
    if (selectedCombination === combination) {
      setSelectedCombination(null);
    } else {
      setSelectedCombination(combination);
      setSelectedSubject(null); // Clear subject highlight
    }
  };

  // Handle showing plate details
  const handleShowPlateDetails = (plateIndex: number) => {
    setSelectedPlateIndex(plateIndex);
    setShowPlateDetails(true);
  };

  const handleClosePlateDetails = () => {
    if (!isDraggingModal) {
      setShowPlateDetails(false);
      setSelectedPlateIndex(null);
      resetModalPosition(); // Reset position when closing
    }
  };

  // Add global mouse event listeners for modal dragging
  useEffect(() => {
    if (isDraggingModal) {
      document.addEventListener('mousemove', handleModalMouseMove);
      document.addEventListener('mouseup', handleModalMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleModalMouseMove);
        document.removeEventListener('mouseup', handleModalMouseUp);
      };
    }
  }, [isDraggingModal, handleModalMouseMove, handleModalMouseUp]);



  // Check if a search matches the selected combination
  const isSearchHighlighted = (search: SearchData): boolean => {
    if (!selectedCombination && !selectedSubject) return false;

    // Subject highlighting takes priority
    if (selectedSubject && subjectColumn) {
      return search.metadata[subjectColumn]?.trim() === selectedSubject;
    }

    if (selectedCombination) {
      try {
        return getCovariateKey(search) === selectedCombination;
      } catch (error) {
        console.error(error);
        return false;
      }
    }

    return false;
  };

  // Handle clicking on a subject in the placement panel
  const handleSubjectClick = (subjectId: string) => {
    if (selectedSubject === subjectId) {
      setSelectedSubject(null);
    } else {
      setSelectedSubject(subjectId);
      setSelectedCombination(null); // Clear covariate highlight
    }
  };



  const canProcess = selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0
    && (groupValidation === null || groupValidation.isValid)
    && (!subjectColumn || groupingConstraint !== 'none');

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.heading}>
          Octopus Plate Designer
          {isDeveloperMode() && (
            <span style={styles.devIndicator}> Dev</span>
          )}
        </h1>
        {/* File Upload */}
        <FileUploadSection
          selectedFileName={selectedFileName}
          onFileUpload={handleFileUpload}
          sampleCount={searches.length}
        />

        {/* Configuration Form */}
        <ConfigurationForm
          availableColumns={availableColumns}
          selectedIdColumn={selectedIdColumn}
          onIdColumnChange={handleIdColumnChangeWithReset}
          searches={searches}
          selectedCovariates={selectedCovariates}
          onCovariateChange={handleCovariateChange}
          qcColumn={qcColumn}
          onQcColumnChange={handleQcColumnChange}
          qcColumnValues={qcColumnValues}
          selectedQcValues={selectedQcValues}
          onQcValueToggle={handleQcValueToggle}
          selectedAlgorithm={selectedAlgorithm}
          onAlgorithmChange={handleAlgorithmChange}
          keepEmptyInLastPlate={keepEmptyInLastPlate}
          onKeepEmptyInLastPlateChange={handleKeepEmptyInLastPlateChange}
          plateRows={plateRows}
          plateColumns={plateColumns}
          onPlateRowsChange={setPlateRows}
          onPlateColumnsChange={setPlateColumns}
          onResetCovariateState={resetCovariateState}
          subjectColumn={subjectColumn}
          onSubjectColumnChange={handleSubjectColumnChange}
          groupingConstraint={groupingConstraint}
          onGroupingConstraintChange={handleGroupingConstraintChange}
          groupValidation={groupValidation}
          subjectGroups={subjectGroups}
        />



        <>
          {/* Process Button */}
          {searches.length > 0 && !isProcessed && (
            <button
              onClick={handleProcessRandomization}
              disabled={!canProcess}
              style={{
                ...styles.processButton,
                ...(canProcess ? {} : styles.processButtonDisabled)
              }}
            >
              Generate Randomized Plates
            </button>
          )}

          {/* Randomization error message */}
          {randomizationError && (
            <div style={{
              margin: '12px 0',
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '6px',
              color: '#991b1b',
              fontSize: '14px',
              lineHeight: '1.5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}>
              <span style={{ fontWeight: 600, flexShrink: 0 }}>⚠</span>
              <span>{randomizationError}</span>
            </div>
          )}

          {/* Plates Visualization */}
          {isProcessed && randomizedPlates.length > 0 && (
            <>
              <div style={styles.viewQcs}>
                {metrics && (
                  <button
                    onClick={toggleMetrics}
                    style={styles.qualityButton}
                  >
                    <span style={styles.qualityButtonText}>Quality</span>
                    <div style={styles.qualityButtonIndicators}>
                      <span style={styles.qualityScore}>
                        {formatScore(metrics.overallQuality.score)}
                      </span>
                      <span style={{
                        ...styles.qualityBadge,
                        backgroundColor:
                          getQualityLevelColor(metrics.overallQuality.level)
                      }}>
                        {metrics.overallQuality.level.charAt(0).toUpperCase() + metrics.overallQuality.level.slice(1)}
                      </span>
                    </div>
                  </button>
                )}

                {summaryData.length > 0 && (
                  <button
                    onClick={() => setShowSummary(!showSummary)}
                    style={styles.summaryToggle}
                  >
                    {showSummary ? '▼ Hide' : '▶ Show'} Covariate Summary ({summaryData.length} combinations)
                  </button>
                )}

                {subjectColumn && (
                  <button
                    onClick={() => setShowSubjectPlacements(!showSubjectPlacements)}
                    style={styles.summaryToggle}
                  >
                    {showSubjectPlacements ? '▼ Hide' : '▶ Show'} Subject Placements
                  </button>
                )}

                <button
                  onClick={() => setCompactView(!compactView)}
                  style={styles.qcButton}
                >
                  {compactView ? 'Full Size View' : 'Compact View'}
                </button>

                <button
                  onClick={handleReRandomize}
                  style={styles.qcButton}
                  title="Generate new randomization"
                >
                  Re-randomize
                </button>

                <button onClick={handleDownloadCSV} style={styles.downloadButton}>
                  Download CSV
                </button>

                <button onClick={handleDownloadExcel} style={styles.downloadButton}>
                  Download Excel
                </button>
              </div>

              <SummaryPanel
                summaryData={summaryData}
                showSummary={showSummary}
                onToggleSummary={() => setShowSummary(!showSummary)}
                selectedCombination={selectedCombination}
                onSummaryItemClick={handleSummaryItemClick}
                qcColumn={qcColumn}
                selectedQcValues={selectedQcValues}
                selectedCovariates={selectedCovariates}
              />

              <SubjectPlacementPanel
                randomizedPlates={randomizedPlates}
                subjectColumn={subjectColumn}
                selectedSubject={selectedSubject}
                onSubjectClick={handleSubjectClick}
                show={showSubjectPlacements}
              />

              <QualityLegend />

              <PlatesGrid
                randomizedPlates={randomizedPlates}
                compactView={compactView}
                covariateColors={covariateColors}
                selectedCovariates={selectedCovariates}
                plateColumns={plateColumns}
                highlightFunction={isSearchHighlighted}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onShowDetails={handleShowPlateDetails}
                onReRandomizePlate={handleReRandomizePlate}
                qualityMetrics={metrics ?? undefined}
                subjectColumn={subjectColumn || undefined}
              />
            </>
          )}
        </>

        {/* Plate Details Modal */}
        <PlateDetailsModal
          show={showPlateDetails}
          plateIndex={selectedPlateIndex}
          plateAssignments={plateAssignments}
          searches={searches}
          selectedCovariates={selectedCovariates}
          covariateColors={covariateColors}
          selectedCombination={selectedCombination}
          plateRows={plateRows}
          plateColumns={plateColumns}
          modalPosition={modalPosition}
          isDraggingModal={isDraggingModal}
          onClose={handleClosePlateDetails}
          onMouseDown={handleModalMouseDown}
          plateQuality={selectedPlateIndex !== null ? metrics?.plateDiversity.plateScores.find(score => score.plateIndex === selectedPlateIndex) : undefined}
          randomizedPlates={randomizedPlates}
        />

        {/* Quality Assessment Modal */}
        <QualityMetricsPanel
          metrics={metrics}
          show={showMetrics}
          onClose={toggleMetrics}
        />

        {/* Excel Export Modal */}
        <ExcelExportModal
          isOpen={showExcelExportModal}
          onClose={() => setShowExcelExportModal(false)}
          onExport={handleExcelExport}
          availableCovariates={availableColumns}
          treatmentCovariates={selectedCovariates}
          searches={searches}
          sampleIdColumn={selectedIdColumn}
        />

        {/* Help Section */}
        <div style={styles.helpSection}>
          <div style={styles.helpLinks}>
            <a
              href="/octopus-block-randomizer/octopus_doc.html"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.helpLink}
            >
              <i className="fa-solid fa-book" style={{marginRight: '4px'}}></i> Documentation
            </a>
            <a
              href="/octopus-block-randomizer/trx-phase1b-small.csv"
              download="trx-phase1b-small.csv"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-down" style={{marginRight: '4px'}}></i> Example Input File (Small)
            </a>
            <a
              href="/octopus-block-randomizer/trx-phase1b-full.csv"
              download="trx-phase1b-full.csv"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-down" style={{marginRight: '4px'}}></i> Example Input File (Full)
            </a>
            <a
              href="/octopus-block-randomizer/quick-start-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-question" style={{marginRight: '4px'}}></i> Quick Start Guide
            </a>
          </div>
        </div>

      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '20px',
    boxSizing: 'border-box' as const,
  },
  content: {
    width: '100%',
    maxWidth: '1600px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    padding: '30px',
    boxSizing: 'border-box' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  heading: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#333',
    textAlign: 'center' as const,
  },
  devIndicator: {
    fontSize: '12px',
    color: '#fd4400ff',
    fontWeight: 'bold',
    marginLeft: '0px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    textAlign: 'center' as const,
    marginBottom: '30px',
    lineHeight: '1.5',
  },
  processButton: {
    padding: '12px 24px',
    backgroundColor: '#2196f3',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '25px',
    transition: 'background-color 0.3s ease',
  },
  processButtonDisabled: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
  },
  viewQcs: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '25px',
    flexWrap: 'wrap' as const,
  },
  qcButton: {
    padding: '8px 16px',
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#495057',
    transition: 'all 0.2s ease',
  },
  downloadButton: {
    padding: '8px 16px',
    backgroundColor: '#28a745',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'background-color 0.3s ease',
  },
  qualityButton: {
    padding: '8px 12px',
    backgroundColor: '#e3f2fd',
    border: '1px solid #bbdefb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#1565c0',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  qualityButtonText: {
    fontSize: '14px',
    fontWeight: '500',
  },
  qualityButtonIndicators: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  summaryToggle: {
    padding: '10px 16px',
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#495057',
    transition: 'all 0.2s ease',
  },
  qualityIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    backgroundColor: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    fontSize: '12px',
  },
  qualityScore: {
    fontWeight: '600',
    color: '#495057',
  },
  qualityBadge: {
    padding: '2px 6px',
    borderRadius: '3px',
    color: '#fff',
    fontSize: '10px',
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
  helpSection: {
    width: '100%',
    padding: '15px',
    backgroundColor: '#ffffffff',
  },
  helpLinks: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    flexWrap: 'wrap' as const,
  },
  helpLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 16px',
    backgroundColor: '#ffffff',
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  } as React.CSSProperties,
};

export default App;
