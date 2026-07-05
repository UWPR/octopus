import React, { useState, useEffect, useMemo, useRef } from 'react';
import FileUploadSection from './components/FileUploadSection';
import ConfigurationForm from './components/ConfigurationForm';
import SummaryPanel from './components/SummaryPanel';
import PlateDetailsModal from './components/PlateDetailsModal';
import ExcelExportModal from './components/ExcelExportModal';
import PlatesGrid from './components/PlatesGrid';
import QualityMetricsPanel from './components/QualityMetricsPanel';
import QualityLegend from './components/QualityLegend';
import SubjectPlacementPanel from './components/SubjectPlacementPanel';
import { SearchData, RandomizationAlgorithm, GroupingConstraint, GroupValidationResult, RepeatedMeasuresConfig, NaPolicy, DEFAULT_NA_POLICY } from './utils/types';
import { downloadCSV, buildProcessedSearches, getCovariateKey, getQualityLevelColor, formatScore, withTimestamp, buildLayoutFileName, detectNaTypeValues } from './utils/utils';
import { exportToExcel } from './utils/excelExport';
import {
  serializeLayout,
  parseLayout,
  validateLayout,
  buildPlatesFromRows,
  LayoutSettings,
} from './utils/layoutIO';
import { useFileUpload } from './hooks/useFileUpload';
import { useModalDrag } from './hooks/useModalDrag';
import { useRandomization } from './hooks/useRandomization';
import { useCovariateColors } from './hooks/useCovariateColors';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useQualityMetrics } from './hooks/useQualityMetrics';
import { computeGroupDistributionWarnings, aggregateObservedGroupBalance, computeQcRowCoverage, hasCoverageError } from './utils/groupDistributionWarnings';
import { isDeveloperMode } from './utils/configs';
import { buildSubjectGroups, validateSubjectGroups } from './algorithms/repeatedMeasuresDistribution';
import SequenceExportWizard from './components/SequenceExportWizard';
import ExportMenu from './components/ExportMenu';
import packageJson from '../package.json';



// Shown when the user picks a new file or layout while a plate design is already displayed.
const REPLACE_DESIGN_MESSAGE =
  'This will replace the current plate design and settings. Continue?';

const App: React.FC = () => {

  const defaultAlgorithm = "balanced";

  // File upload hook
  const {
    searches,
    parsedData,
    availableColumns,
    selectedIdColumn,
    selectedFileName,
    isLayoutFile,
    uploadCounter,
    loadSampleCsvText,
    handleIdColumnChange,
    loadSearches,
    resetFileState,
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
    restoreLayout,
    updatePlates,
  } = useRandomization();

  // Covariate colors hook
  const {
    covariateColors,
    summaryData,
    generateCovariateColors,
    generateSummaryData,
    resetColors,
    restoreColors,
    updateCovariateColor,
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
  // Global N/A grouping choice. Set from the "N/A values" checklist when the data mixes
  // spellings; the default folds nothing extra (blank stays distinct, spellings stay literal).
  const [naPolicy, setNaPolicy] = useState<NaPolicy>(DEFAULT_NA_POLICY);

  // Algorithm selection
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<RandomizationAlgorithm>(defaultAlgorithm);
  const [keepEmptyInLastPlate, setKeepEmptyInLastPlate] = useState<boolean>(false);

  // Plate dimensions
  const [plateRows, setPlateRows] = useState<number>(8);
  const [plateColumns, setPlateColumns] = useState<number>(12);

  // Group distribution warnings (non-blocking diagnostic). Reads existing state only:
  // it never disables Generate and never changes the layout, colors, or scores.
  // The Covariate Summary is shown only after generation, so plate count, the
  // observed per-group balance, and the layout row coverage are all available here.
  const plateCount = randomizedPlates.length;
  const observedGroupBalance = useMemo(
    () => (metrics ? aggregateObservedGroupBalance(metrics) : undefined),
    [metrics]
  );
  // QC/reference groups must appear in every used row, not just every plate. This
  // reads the generated layout to find rows a QC group is missing from.
  const qcRowCoverage = useMemo(() => {
    if (!qcColumn || selectedQcValues.length === 0 || randomizedPlates.length === 0) {
      return undefined;
    }
    const qcCombinations = new Set(
      summaryData
        .filter(item => item.qcColumnValue !== undefined && selectedQcValues.includes(item.qcColumnValue))
        .map(item => item.combination)
    );
    if (qcCombinations.size === 0) return undefined;
    return computeQcRowCoverage(randomizedPlates, qcCombinations, getCovariateKey);
  }, [randomizedPlates, summaryData, qcColumn, selectedQcValues]);
  const distributionWarnings = useMemo(
    () =>
      computeGroupDistributionWarnings(summaryData, plateCount, {
        observedGroupBalance,
        selectedQcValues,
        qcRowCoverage,
      }),
    [summaryData, plateCount, observedGroupBalance, selectedQcValues, qcRowCoverage]
  );
  // Color the collapsed indicator red when any group fails coverage, amber when the
  // only issues are balance (UNEVEN) warnings.
  const warningsHaveError = useMemo(
    () => hasCoverageError(distributionWarnings),
    [distributionWarnings]
  );

  // UI states
  const [showSummary, setShowSummary] = useState<boolean>(false);
  const [compactView, setCompactView] = useState<boolean>(true);
  const [selectedCombination, setSelectedCombination] = useState<string | null>(null);
  const [showPlateDetails, setShowPlateDetails] = useState<boolean>(false);
  const [selectedPlateIndex, setSelectedPlateIndex] = useState<number | null>(null);
  const [showExcelExportModal, setShowExcelExportModal] = useState<boolean>(false);
  const [showSequenceExportWizard, setShowSequenceExportWizard] = useState<boolean>(false);
  const [randomizationError, setRandomizationError] = useState<string | null>(null);
  // Error from reading a new sample file or loading a saved layout. Kept separate from
  // randomizationError so it can be shown at the top (by the file buttons), while a
  // randomization/infeasibility error stays down by the Generate button.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Non-blocking notice about the loaded file (e.g. some rows had formatting problems).
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  // Set true for one render while a saved layout is being loaded, so the new-file reset
  // effect does not wipe the settings we are restoring.
  const isRestoringRef = useRef<boolean>(false);

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

  // Validate the chosen ID column against the loaded rows: each sample needs a unique, non-empty
  // ID. Both problems block generation. Duplicates corrupt the name-based lookups used on
  // export/save, and blank or whitespace-only IDs leave rows that cannot be identified. Values are
  // trimmed here to match processSearchData. Only applies to sample CSVs - parsedData is empty for
  // a loaded layout, which validateLayout checks separately.
  const idColumnIssues = useMemo(() => {
    if (!selectedIdColumn || parsedData.length === 0) return null;
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    let blankCount = 0;
    parsedData.forEach((row: Record<string, unknown>) => {
      const raw = row[selectedIdColumn];
      const value = raw === undefined || raw === null ? '' : String(raw).trim();
      if (value === '') { blankCount++; return; }
      if (seen.has(value)) duplicates.add(value);
      seen.add(value);
    });
    return { duplicates: Array.from(duplicates), blankCount };
  }, [parsedData, selectedIdColumn]);

  const hasDuplicateIds = (idColumnIssues?.duplicates.length ?? 0) > 0;
  const hasBlankIds = (idColumnIssues?.blankCount ?? 0) > 0;


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

  // Clear all configuration, layout, colors, metrics, error, and UI state (everything derived
  // from a loaded file), leaving the uploaded file itself in place.
  const clearConfigAndLayout = () => {
    resetRandomization();
    setRandomizationError(null);
    setLoadError(null);
    resetColors();
    resetMetrics();
    resetModalPosition();

    // Configuration
    setSelectedCovariates([]);
    setQcColumn('');
    setQcColumnValues([]);
    setSelectedQcValues([]);

    // Repeated-measures
    setSubjectColumn('');
    setGroupingConstraint('none');
    setGroupValidation(null);

    // N/A grouping (re-derived from the new data by the upload effect)
    setNaPolicy(DEFAULT_NA_POLICY);

    // Algorithm and plate dimensions (back to defaults)
    setSelectedAlgorithm(defaultAlgorithm);
    setKeepEmptyInLastPlate(false);
    setPlateRows(8);
    setPlateColumns(12);

    // UI
    setShowSummary(false);
    setCompactView(true);
    setSelectedCombination(null);
    setShowPlateDetails(false);
    setSelectedPlateIndex(null);
    setShowSubjectPlacements(false);
    setSelectedSubject(null);
  };

  // Fully clear the workspace, including the uploaded file itself, so nothing from the previous
  // file remains on screen. Used when the user confirms replacing the current design with a new
  // file or layout, so a failed or empty load does not leave stale settings and plates behind.
  const resetWorkspace = () => {
    clearConfigAndLayout();
    resetFileState();
    setLoadWarning(null); // not cleared by clearConfigAndLayout, so a valid load's warning survives
  };

  // Reset the derived state when a new sample file is uploaded (but not on initial load, and not
  // while restoring a saved layout, whose settings have just been set from the file).
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    // Reset the derived design whenever a new sample file is selected. Gate on the filename, not
    // the sample count, so a file that parses but yields no usable samples (header-only, or all
    // IDs blank) still replaces the previous design instead of leaving it on screen.
    if (selectedFileName) {
      clearConfigAndLayout();
      // Initialize the N/A policy from the new data. When a column mixes spellings, default to
      // folding every detected spelling (all checklist boxes checked); otherwise fold nothing.
      setNaPolicy(
        naDetection.hasAmbiguousColumn
          ? {
              foldBlank: naDetection.spellings.has(''),
              foldSpellings: Array.from(naDetection.spellings).filter(t => t !== '' && t !== 'N/A'),
            }
          : DEFAULT_NA_POLICY
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileName, searches.length]);

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
    setSelectedSubject(null);
    setShowSubjectPlacements(false);
  };

  // Scan every metadata column of the uploaded data for N/A-type spellings. Drives the "N/A
  // values" checklist and, at upload, the default policy. The ID column is not metadata, so it
  // is excluded automatically.
  const naDetection = useMemo(
    () => detectNaTypeValues(searches, availableColumns.filter(col => col !== selectedIdColumn)),
    [searches, availableColumns, selectedIdColumn]
  );

  // Toggle one entry of the "N/A values" checklist. Blank uses the empty-string token. The
  // literal N/A is always folded (its box is disabled), so it never reaches here. Changing the
  // policy invalidates the current layout, matching a covariate change, so the user re-Generates.
  const handleNaPolicyToggle = (token: string) => {
    setNaPolicy(prev => {
      if (token === '') return { ...prev, foldBlank: !prev.foldBlank };
      const folded = prev.foldSpellings.includes(token);
      return {
        ...prev,
        foldSpellings: folded
          ? prev.foldSpellings.filter(s => s !== token)
          : [...prev.foldSpellings, token],
      };
    });
    resetCovariateState();
  };

  // Derive the available QC values for the chosen QC column. This only recomputes the
  // list of checkboxes to show; it must NOT reset the current selection. A layout load
  // sets qcColumn and searches together, which retriggers this effect, and resetting here
  // would wipe the selection that the load just restored. The selection is cleared where
  // the column genuinely changes instead: handleQcColumnChange and the subject-column
  // conflict path.
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
    setSelectedQcValues([]); // Switching columns invalidates the previous value selection.

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
    buildProcessedSearches(searchesList, {
      selectedCovariates,
      qcColumn,
      selectedQcValues,
      naPolicy,
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
          repeatedMeasuresConfig,
          naPolicy
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
            selectedQcValues,
            naPolicy
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

  // Build the LayoutSettings object describing the current configuration.
  const collectLayoutSettings = (): LayoutSettings => ({
    selectedIdColumn,
    selectedCovariates,
    qcColumn,
    selectedQcValues,
    selectedAlgorithm,
    keepEmptyInLastPlate,
    plateRows,
    plateColumns,
    subjectColumn,
    groupingConstraint,
    // Metadata columns in display order (every column except the ID column).
    metadataColumns: availableColumns.filter(col => col !== selectedIdColumn),
    naPolicy,
  });

  // Save layout handler - export the layout together with the settings that produced it.
  const handleSaveLayout = () => {
    if (!selectedIdColumn || randomizedPlates.length === 0) return;

    let json: string;
    try {
      json = serializeLayout({
        searches,
        randomizedPlates,
        settings: collectLayoutSettings(),
        covariateColors,
        appVersion: packageJson.version,
      });
    } catch (e) {
      // serializeLayout throws if a sample is not on the grid, or if there are no covariate
      // colors to save. Show the message instead of downloading.
      setLoadWarning((e as Error).message);
      return;
    }

    // Build the base name, stripping a prior _octopus_layout suffix/timestamp when the loaded
    // file is itself a saved layout, so the suffix does not stack on re-save.
    const baseFileName = buildLayoutFileName(selectedFileName);
    // Timestamp the filename (YYYY-MM-DD_HH-mm-ss) so repeated saves do not overwrite each other.
    const outputFileName = withTimestamp(baseFileName);

    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', outputFileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Avoid leaking the object URL on repeated saves.
  };

  // Apply a parsed-and-validated layout to the application state.
  const applyLoadedLayout = (
    fileName: string,
    settings: LayoutSettings,
    loadedSearches: SearchData[],
    plates: (SearchData | undefined)[][][],
    plateAssignmentsToRestore: Map<number, SearchData[]>,
    storedColors: ReturnType<typeof parseLayout>['covariateColors']
  ) => {
    // Suppress the new-file reset effect so the settings below survive.
    isRestoringRef.current = true;

    // Restore samples and every setting.
    loadSearches(loadedSearches, fileName, settings.selectedIdColumn, settings.metadataColumns);
    setSelectedCovariates(settings.selectedCovariates);
    setQcColumn(settings.qcColumn);
    setSelectedQcValues(settings.selectedQcValues);
    setSelectedAlgorithm(settings.selectedAlgorithm);
    setKeepEmptyInLastPlate(settings.keepEmptyInLastPlate);
    setPlateRows(settings.plateRows);
    setPlateColumns(settings.plateColumns);
    setSubjectColumn(settings.subjectColumn);
    setGroupingConstraint(settings.groupingConstraint);
    setNaPolicy(settings.naPolicy);

    // Restore the plates directly (no re-randomization).
    restoreLayout(plates, plateAssignmentsToRestore);

    // Restore colors (verbatim if present, else regenerate deterministically) and summary.
    let colors;
    if (storedColors) {
      restoreColors(storedColors);
      colors = storedColors;
    } else {
      colors = generateCovariateColors(
        loadedSearches,
        settings.selectedCovariates,
        settings.qcColumn,
        settings.selectedQcValues
      );
    }
    generateSummaryData(
      colors,
      loadedSearches,
      settings.selectedCovariates,
      settings.qcColumn,
      settings.selectedQcValues,
      settings.naPolicy
    );

    // Clear any stale highlight/error.
    setSelectedCombination(null);
    setSelectedSubject(null);
    setRandomizationError(null);
    setLoadError(null);
    setLoadWarning(null);
  };

  // Confirm before replacing a displayed plate layout. Returns false when the user cancels (so
  // nothing changes). When no layout is displayed there is no prompt. A successful load replaces
  // the previous state on its own (the new-file reset effect for a sample CSV, applyLoadedLayout
  // for a layout), so this does NOT clear here - clearing before a valid layout load would race
  // with applyLoadedLayout's restore guard. Failed loads clear via failLoad instead.
  const prepareForNewFile = (): boolean => !isProcessed || window.confirm(REPLACE_DESIGN_MESSAGE);

  // Report a load failure: clear the previous file, layout, and options so nothing stale remains
  // on screen behind the error, then show the message. This is what makes an invalid pick (an
  // Excel file, an unreadable CSV, a non-layout) fully replace whatever was loaded before.
  const failLoad = (message: string) => {
    resetWorkspace();
    setLoadError(message);
  };

  // Apply a parsed-and-validated layout: rebuild the grid and restore settings and colors. Any
  // structural problem building the placement is reported as a load error.
  const applyParsedLayout = (parsed: ReturnType<typeof parseLayout>, fileName: string) => {
    if (!parsed.settings) return;
    const settings = parsed.settings;
    // Defense in depth: validateLayout already rejects bad dimensions, but rebuild inside a
    // try/catch so any malformed placement reports a clean error instead of failing silently.
    try {
      const {
        plates,
        plateAssignments: restoredAssignments,
        samples: loadedSearches,
      } = buildPlatesFromRows(parsed.rows, settings);

      // Recompute covariate keys / QC flags (shared references update the plates too). Use the
      // saved N/A policy so the derived keys match the stored covariate colors.
      buildProcessedSearches(loadedSearches, {
        selectedCovariates: settings.selectedCovariates,
        qcColumn: settings.qcColumn,
        selectedQcValues: settings.selectedQcValues,
        naPolicy: settings.naPolicy,
      });

      applyLoadedLayout(
        fileName,
        settings,
        loadedSearches,
        plates,
        restoredAssignments,
        parsed.covariateColors
      );
    } catch (e) {
      isRestoringRef.current = false; // applyLoadedLayout may have set it before throwing
      failLoad(`Could not load "${fileName}": ${(e as Error).message}`);
    }
  };

  // Validate and apply a saved layout from raw file text. A valid layout fully replaces the current
  // state via applyLoadedLayout; a non-layout or invalid file is cleared and reported via failLoad.
  // Requiring an actual marker ROW (not just the marker text somewhere in the file) avoids
  // misclassifying a sample CSV that merely mentions "Octopus Layout" in a data cell.
  const loadLayoutFromText = (text: string, fileName: string) => {
    const parsed = parseLayout(text);
    if (!parsed.hasMarker) {
      failLoad(
        `"${fileName}" is not a saved Octopus layout. Layout files are JSON, created from Export > Layout. ` +
        'To load sample data, use "Choose File".'
      );
      return;
    }
    const fatal = validateLayout(parsed).find(e => e.fatal);
    if (fatal && fatal.fatal) {
      failLoad(`Could not load "${fileName}": ${fatal.message}`);
      return;
    }
    applyParsedLayout(parsed, fileName);
  };

  // Parse and load a plain sample CSV from raw file text. A successful load replaces the previous
  // data; a file with no readable columns clears the previous file and shows the error.
  const loadSampleFromText = (text: string, fileName: string) => {
    const result = loadSampleCsvText(text, fileName);
    if (!result.ok) {
      failLoad(result.error ?? `Could not read "${fileName}".`);
      return;
    }
    setLoadWarning(result.warning ?? null);
  };

  // Choose File handler. Routes a single file input by extension:
  //   - .csv  -> loaded as sample data
  //   - .json -> loaded as a saved layout
  //   - other -> rejected up front by failLoad
  // If a design is already shown, prepareForNewFile confirms the replace first (cancel keeps it).
  // A file that loads successfully replaces the current state. A rejected or unreadable file is
  // cleared via failLoad, so a failed load never leaves the previous file in place.
  const handleChooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // clear now so the same file can be re-selected; the File is captured below

    if (!prepareForNewFile()) return; // user cancelled the replace - keep everything

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.json')) {
      failLoad(`"${file.name}" is not a CSV or JSON file. Only CSV sample files and JSON layout files are supported.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // Route by extension: a .json file is opened as a saved layout, a .csv as sample data. The
      // gate above already rejected anything else. A .json that is not actually an Octopus layout
      // still goes to the layout path, where loadLayoutFromText reports a clear "not a saved
      // Octopus layout" error rather than being parsed as fake sample rows.
      if (lowerName.endsWith('.json')) {
        loadLayoutFromText(text, file.name);
      } else {
        loadSampleFromText(text, file.name);
      }
    };
    // A read failure must clear the previous state too, so it does not linger behind no error.
    reader.onerror = reader.onabort = () => failLoad(`Could not read "${file.name}".`);
    reader.readAsText(file);
  };

  // Load Layout handler - read a saved layout file and reproduce it exactly. prepareForNewFile
  // confirms first when a design is shown; a valid layout then replaces the current state via
  // applyLoadedLayout, and an invalid or unreadable file is cleared and reported via failLoad.
  const handleLoadLayout = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // clear so re-selecting the same file fires change again
    if (!file) return;

    if (!prepareForNewFile()) return; // user cancelled the replace - keep everything

    const reader = new FileReader();
    reader.onload = () => loadLayoutFromText(String(reader.result ?? ''), file.name);
    reader.onerror = reader.onabort = () => failLoad(`Could not read "${file.name}".`);
    reader.readAsText(file);
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
      inputFileName: selectedFileName,
      qcColumn: qcColumn || undefined,
      naPolicy
    });
  };

  // Re-randomization handler
  const handleReRandomize = () => {
    if (selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0) {
      // Clear highlighting since plate layout is changing
      setSelectedCombination(null);
      setSelectedSubject(null);

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
        repeatedMeasuresConfig,
        naPolicy
      );
    }
  };

  // Single plate re-randomization handler
  const handleReRandomizePlate = (plateIndex: number) => {
    if (selectedIdColumn && selectedCovariates.length > 0 && searches.length > 0) {
      // Clear highlighting since plate layout is changing
      setSelectedCombination(null);
      setSelectedSubject(null);

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
        repeatedMeasuresConfig,
        naPolicy
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
    && !hasDuplicateIds && !hasBlankIds
    && (groupValidation === null || groupValidation.isValid)
    && (!subjectColumn || groupingConstraint !== 'none');

  // A colored notice banner - red for errors, amber for warnings. Shared by the load error/warning
  // (top), the ID-column checks, and the randomization error so they all stay visually consistent.
  const renderBanner = (message: string, tone: 'error' | 'warning' = 'error') => {
    const palette = tone === 'warning'
      ? { bg: '#fffbeb', border: '#fde68a', text: '#92400e' }
      : { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' };
    return (
      <div style={{
        margin: '12px 0',
        padding: '12px 16px',
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: '6px',
        color: palette.text,
        fontSize: '14px',
        lineHeight: '1.5',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}>
        <span style={{ fontWeight: 600, flexShrink: 0 }}>⚠</span>
        <span>{message}</span>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <img
          src={`${process.env.PUBLIC_URL}/images/octopus-logo.svg`}
          alt="Octopus logo"
          style={styles.logo}
        />
        <h1 style={styles.heading}>
          Octopus
          {isDeveloperMode() && (
            <span style={styles.devIndicator}> Dev</span>
          )}
        </h1>
        <p style={styles.subtitle}>Plate Designer with Balanced Block Randomization</p>
        {/* File Upload */}
        <FileUploadSection
          onFileUpload={handleChooseFile}
          onLoadLayout={handleLoadLayout}
        />

        {/* Load error/warning - shown near the top so they are visible without scrolling */}
        {loadError && renderBanner(loadError)}
        {loadWarning && renderBanner(loadWarning, 'warning')}

        {/* Configuration Form */}
        <ConfigurationForm
          availableColumns={availableColumns}
          selectedFileName={selectedFileName}
          isLayoutFile={isLayoutFile}
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
          naDetection={naDetection}
          naPolicy={naPolicy}
          onNaPolicyToggle={handleNaPolicyToggle}
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
          {/* ID-column problems - shown by the Generate button so it is clear why it is disabled */}
          {!isProcessed && idColumnIssues && idColumnIssues.duplicates.length > 0 && renderBanner(
            `The selected ID column "${selectedIdColumn}" has repeated values: ${idColumnIssues.duplicates.slice(0, 5).join(', ')}` +
            `${idColumnIssues.duplicates.length > 5 ? `, and ${idColumnIssues.duplicates.length - 5} more` : ''}. ` +
            'ID column must have a unique value for each sample.'
          )}
          {!isProcessed && idColumnIssues && idColumnIssues.blankCount > 0 && renderBanner(
            `The selected ID column "${selectedIdColumn}" has ${idColumnIssues.blankCount} blank value(s). ` +
            'ID column must have a value for each sample.'
          )}

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

          {/* Randomization / infeasibility error - shown by the Generate button that triggers it */}
          {randomizationError && renderBanner(randomizationError)}

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
                    {distributionWarnings.warningCount > 0 && (
                      <span
                        data-testid="distribution-warning-indicator"
                        style={{
                          ...styles.summaryWarningIndicator,
                          color: warningsHaveError ? '#dc3545' : '#ff9800',
                        }}
                        title={distributionWarnings.summaries.join(' ')}
                        aria-label={`${distributionWarnings.warningCount} covariate group(s) flagged`}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={{ display: 'block' }}>
                          <path fill="currentColor" d="M12 2 L22 20 L2 20 Z" />
                          <rect x="11" y="9" width="2" height="6" fill="#fff" />
                          <rect x="11" y="16.5" width="2" height="2" fill="#fff" />
                        </svg>
                        {distributionWarnings.warningCount}
                      </span>
                    )}
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

                <ExportMenu
                  onDownloadCsv={handleDownloadCSV}
                  onDownloadExcel={handleDownloadExcel}
                  onSaveLayout={handleSaveLayout}
                  onExportSequence={() => setShowSequenceExportWizard(true)}
                />
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
                onUpdateColor={updateCovariateColor}
                warnings={distributionWarnings}
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
                qcColumn={qcColumn || undefined}
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
          numPlates={randomizedPlates.length}
          naPolicy={naPolicy}
        />

        {/* Quality Assessment Modal */}
        <QualityMetricsPanel
          metrics={metrics}
          show={showMetrics}
          onClose={toggleMetrics}
          numPlates={randomizedPlates.length}
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
          subjectColumn={subjectColumn || undefined}
          qcColumn={qcColumn || undefined}
        />

        {/* Sequence Export Wizard */}
        {isProcessed && randomizedPlates.length > 0 && (
          <SequenceExportWizard
            key={uploadCounter}
            plates={randomizedPlates}
            searches={searches}
            qcColumn={qcColumn || undefined}
            selectedQcValues={selectedQcValues.length > 0 ? selectedQcValues : undefined}
            plateRows={plateRows}
            plateCols={plateColumns}
            onClose={() => setShowSequenceExportWizard(false)}
            visible={showSequenceExportWizard}
            inputFileName={selectedFileName}
          />
        )}

        {/* Help Section */}
        <div style={styles.helpSection}>
          <div style={styles.helpLinks}>
            <a
              href={`${process.env.PUBLIC_URL}/octopus_doc.html`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.helpLink}
            >
              <i className="fa-solid fa-book" style={{marginRight: '4px'}}></i> Documentation
            </a>
            <a
              href={`${process.env.PUBLIC_URL}/octopus_test_dataset_small.csv`}
              download="octopus_test_dataset_small.csv"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-down" style={{marginRight: '4px'}}></i> Example Input File (Small)
            </a>
            <a
              href={`${process.env.PUBLIC_URL}/octopus_test_dataset.csv`}
              download="octopus_test_dataset.csv"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-down" style={{marginRight: '4px'}}></i> Example Input File (Full)
            </a>
            <a
              href={`${process.env.PUBLIC_URL}/quick-start-guide.html`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.helpLink}
            >
              <i className="fa-regular fa-circle-question" style={{marginRight: '4px'}}></i> Quick Start Guide
            </a>
          </div>
          <div style={styles.versionText}>Octopus v{packageJson.version}</div>
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
    fontSize: '36px',
    fontWeight: 'bold',
    marginBottom: '4px',
    marginTop: '4px',
    color: '#333',
    textAlign: 'center' as const,
  },
  logo: {
    display: 'block',
    margin: '0 auto 8px',
    height: '80px',
    width: 'auto',
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
    marginTop: '0',
    marginBottom: '10px',
    fontWeight: 'normal' as const,
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
  summaryWarningIndicator: {
    marginLeft: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '13px',
    fontWeight: 700,
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
  versionText: {
    marginTop: '10px',
    textAlign: 'center' as const,
    fontSize: '12px',
    color: '#999',
  },
};

export default App;
