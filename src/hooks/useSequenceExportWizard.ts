import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { SearchData } from '../utils/types';
import {
  SlotColor,
  SampleCategoryConfig,
  SystemSuitabilityConfig,
  SlotAssignment,
  CategorySettings,
  DEFAULT_CATEGORY_SETTINGS,
  PathsMethodsConfig,
  FileNamingConfig,
  FilenameField,
  SerialIdConfig,
  GeneratedSequence,
  IdMapping,
  UNSAFE_FILENAME_CHARS,
} from '../utils/sequenceExportTypes';
import {
  generateSequence,
  GenerateSequenceInput,
  autoDetectCategories,
  formatThermoCSV,
  downloadSequenceCSV,
  generateMappingCSV,
  generateFilename,
  generateSerialId,
  computeTotalRuns,
  isSSActive,
} from '../utils/sequenceExport';

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;

const ALL_SLOTS: SlotColor[] = ['Y', 'B', 'R', 'G'];

const DEFAULT_SS_CONFIG: SystemSuitabilityConfig = {
  runsAtStart: 0,
  runsAtEnd: 0,
  runsDuring: 0,
  insertionInterval: 12,
  path: '',
  instrumentMethod: '',
  injectionVolume: 3,
  sampleIdentifier: 'SS',
};

const DEFAULT_SERIAL_ID_CONFIG: SerialIdConfig = {
  prefix: '',
  startNumber: 1,
};

/** Category names reserved by the system — users cannot create these */
export const RESERVED_CATEGORY_NAMES = ['Experimental', 'System Suitability'];

const AVAILABLE_FIELDS: FilenameField[] = [
  { id: 'year', label: 'Year' },
  { id: 'month', label: 'Month' },
  { id: 'projectName', label: 'Project Name', value: '' },
  { id: 'experimentName', label: 'Experiment Name', value: '' },
  { id: 'instrumentName', label: 'Instrument Name', value: '' },
  { id: 'sampleId', label: 'Sample Identifier' },
  { id: 'plateNumber', label: 'Plate Number' },
  { id: 'plateWell', label: 'Plate Well' },
];

// ─── Hook Props ──────────────────────────────────────────────────────────────

export interface UseSequenceExportWizardProps {
  plates: (SearchData | undefined)[][][];
  qcColumn?: string;
  selectedQcValues?: string[];
  plateRows: number;
  plateCols: number;
  inputFileName?: string;
}

// ─── Hook Return Type ────────────────────────────────────────────────────────

export interface UseSequenceExportWizardReturn {
  // Step navigation
  currentStep: number;
  goToStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetStep: () => void;
  canProceed: boolean;

  // Step 1: System Suitability
  ssConfig: SystemSuitabilityConfig;
  updateSSConfig: (updates: Partial<SystemSuitabilityConfig>) => void;

  // Step 2: Slot Assignment
  slotAssignment: SlotAssignment;
  updateSlotAssignment: (updates: Partial<SlotAssignment>) => void;
  oversizedPlateWarning: boolean;

  // Step 3: File Naming
  fileNamingConfig: FileNamingConfig;
  updateFileNaming: (updates: Partial<FileNamingConfig>) => void;
  filenamePreview: string;
  availableFields: FilenameField[];

  // Step 4: Sample Categories
  sampleCategories: SampleCategoryConfig;
  setSampleCategory: (sampleNames: string[], category: string) => void;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;

  // Step 5: Paths & Methods
  pathsConfig: PathsMethodsConfig;
  updateCategorySettings: (category: string, settings: Partial<CategorySettings>) => void;
  applyToAllCategories: (settings: Partial<CategorySettings>) => void;

  // Step 6: Preview & Export
  generatedSequence: GeneratedSequence;
  exportSequenceCSV: () => void;
  exportMappingCSV: () => void;
}

// ─── Hook Implementation ─────────────────────────────────────────────────────

export function useSequenceExportWizard(props: UseSequenceExportWizardProps): UseSequenceExportWizardReturn {
  const { plates, qcColumn, selectedQcValues, plateRows, plateCols, inputFileName } = props;

  // ── Step Navigation ──────────────────────────────────────────────────────

  const [currentStep, setCurrentStep] = useState(1);

  // ── Step 4: Sample Categories ────────────────────────────────────────────

  const [sampleCategories, setSampleCategories] = useState<SampleCategoryConfig>(() =>
    autoDetectCategories(plates, qcColumn, selectedQcValues)
  );

  const setSampleCategory = useCallback((sampleNames: string[], category: string) => {
    setSampleCategories(prev => {
      const newAssignments = { ...prev.assignments };
      for (const name of sampleNames) {
        newAssignments[name] = category;
      }
      return { ...prev, assignments: newAssignments };
    });
  }, []);

  const addCategory = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (RESERVED_CATEGORY_NAMES.some(r => r.toLowerCase() === trimmed.toLowerCase())) return;
    setSampleCategories(prev => {
      if (prev.categories.some(c => c.toLowerCase() === trimmed.toLowerCase())) return prev;
      return { ...prev, categories: [...prev.categories, trimmed] };
    });
  }, []);

  const removeCategory = useCallback((name: string) => {
    setSampleCategories(prev => {
      if (!prev.categories.includes(name)) return prev;
      const newCategories = prev.categories.filter(c => c !== name);
      // Reassign any samples in the removed category to "Experimental"
      const newAssignments = { ...prev.assignments };
      for (const [sampleName, cat] of Object.entries(newAssignments)) {
        if (cat === name) {
          newAssignments[sampleName] = 'Experimental';
        }
      }
      return { categories: newCategories, assignments: newAssignments };
    });
    // Remove stale entry from pathsConfig
    setPathsConfig(prev => {
      const { [name]: _, ...rest } = prev.categorySettings;
      return { categorySettings: rest };
    });
  }, []);

  // ── Step 1: System Suitability ───────────────────────────────────────────

  const [ssConfig, setSSConfig] = useState<SystemSuitabilityConfig>(DEFAULT_SS_CONFIG);

  const updateSSConfig = useCallback((updates: Partial<SystemSuitabilityConfig>) => {
    setSSConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // ── Step 2: Slot Assignment ──────────────────────────────────────────────

  const [slotAssignment, setSlotAssignment] = useState<SlotAssignment>(() => {
    // Auto-assign slots to plates
    const plateSlots: Record<number, SlotColor> = {};
    const availableSlots = [...ALL_SLOTS];
    for (let i = 0; i < plates.length; i++) {
      plateSlots[i] = availableSlots[i % availableSlots.length];
    }
    return { ssSlot: null, ssWell: 'A1', plateSlots };
  });

  // Re-compute plate slots when SS slot changes
  const updateSlotAssignment = useCallback((updates: Partial<SlotAssignment>) => {
    setSlotAssignment(prev => {
      const next = { ...prev, ...updates };
      // If ssSlot changed, re-assign plate slots excluding the SS slot
      if ('ssSlot' in updates) {
        const available = ALL_SLOTS.filter(s => s !== next.ssSlot);
        const newPlateSlots: Record<number, SlotColor> = {};
        for (let i = 0; i < plates.length; i++) {
          newPlateSlots[i] = available[i % available.length];
        }
        next.plateSlots = newPlateSlots;
      }
      return next;
    });
  }, [plates.length]);

  const oversizedPlateWarning = plateRows > 8 || plateCols > 12;

  // Clear SS slot when SS runs are all set to 0
  const { runsAtStart, runsAtEnd, runsDuring } = ssConfig;
  useEffect(() => {
    if (!isSSActive({ runsAtStart, runsAtEnd, runsDuring }) && slotAssignment.ssSlot !== null) {
      // Clear SS slot and reassign all slots to plates
      const newPlateSlots: Record<number, SlotColor> = {};
      for (let i = 0; i < plates.length; i++) {
        newPlateSlots[i] = ALL_SLOTS[i % ALL_SLOTS.length];
      }
      setSlotAssignment({ ssSlot: null, ssWell: 'A1', plateSlots: newPlateSlots });
    }
  }, [runsAtStart, runsAtEnd, runsDuring, slotAssignment.ssSlot, plates.length]);

  // ── Step 5: Paths & Methods ──────────────────────────────────────────────

  const [pathsConfig, setPathsConfig] = useState<PathsMethodsConfig>(() => {
    const categorySettings: Record<string, CategorySettings> = {};
    for (const cat of sampleCategories.categories) {
      categorySettings[cat] = { ...DEFAULT_CATEGORY_SETTINGS };
    }
    return { categorySettings };
  });

  // Keep pathsConfig in sync when categories change
  useEffect(() => {
    setPathsConfig(prev => {
      const newSettings = { ...prev.categorySettings };
      for (const cat of sampleCategories.categories) {
        if (!newSettings[cat]) {
          newSettings[cat] = { ...DEFAULT_CATEGORY_SETTINGS };
        }
      }
      return { categorySettings: newSettings };
    });
  }, [sampleCategories.categories]);

  // Reset sample categories and paths when QC column/values change.
  // Note: plate changes alone don't trigger a reset because re-randomization doesn't
  // change sample identities (same names, same QC flags). New file uploads cause a full
  // remount via the React key={uploadCounter} on the wizard component.
  const prevQcColumnRef = useRef(qcColumn);
  const prevQcValuesRef = useRef(selectedQcValues);
  useEffect(() => {
    const qcChanged = prevQcColumnRef.current !== qcColumn ||
      JSON.stringify(prevQcValuesRef.current) !== JSON.stringify(selectedQcValues);
    if (qcChanged) {
      const newCategories = autoDetectCategories(plates, qcColumn, selectedQcValues);
      setSampleCategories(newCategories);
      const newCategorySettings: Record<string, CategorySettings> = {};
      for (const cat of newCategories.categories) {
        newCategorySettings[cat] = { ...DEFAULT_CATEGORY_SETTINGS };
      }
      setPathsConfig({ categorySettings: newCategorySettings });
      prevQcColumnRef.current = qcColumn;
      prevQcValuesRef.current = selectedQcValues;
    }
  }, [qcColumn, selectedQcValues, plates]);

  const updateCategorySettings = useCallback((category: string, settings: Partial<CategorySettings>) => {
    setPathsConfig(prev => ({
      categorySettings: {
        ...prev.categorySettings,
        [category]: { ...(prev.categorySettings[category] || DEFAULT_CATEGORY_SETTINGS), ...settings },
      },
    }));
  }, []);

  const applyToAllCategories = useCallback((settings: Partial<CategorySettings>) => {
    setPathsConfig(prev => {
      const newSettings: Record<string, CategorySettings> = {};
      for (const [cat, existing] of Object.entries(prev.categorySettings)) {
        newSettings[cat] = { ...existing, ...settings };
      }
      // Also apply to System Suitability if SS runs are configured
      if (isSSActive({ runsAtStart, runsAtEnd, runsDuring })) {
        const existing = prev.categorySettings['System Suitability'] || DEFAULT_CATEGORY_SETTINGS;
        newSettings['System Suitability'] = { ...existing, ...settings };
      }
      return { categorySettings: newSettings };
    });
  }, [runsAtStart, runsAtEnd, runsDuring]);

  // ── Step 3: File Naming ──────────────────────────────────────────────────

  const [fileNamingConfig, setFileNamingConfig] = useState<FileNamingConfig>({
    selectedFields: [],
    separator: '_',
    sampleIdMode: 'original',
    serialIdConfig: { ...DEFAULT_SERIAL_ID_CONFIG },
    generateMappingFile: false,
  });

  const updateFileNaming = useCallback((updates: Partial<FileNamingConfig>) => {
    setFileNamingConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const filenamePreview = useMemo(() => {
    if (fileNamingConfig.selectedFields.length === 0) return '';
    const { totalRuns, totalFilledWells } = computeTotalRuns(plates, ssConfig);
    const sampleCount = Math.max(totalFilledWells, 1);
    const { startNumber, prefix } = fileNamingConfig.serialIdConfig;
    const sampleId = fileNamingConfig.sampleIdMode === 'serial'
      ? generateSerialId(prefix, startNumber, sampleCount, startNumber)
      : 'SampleID';
    return generateFilename(
      fileNamingConfig.selectedFields,
      fileNamingConfig.separator,
      1,
      totalRuns,
      { category: 'Experimental', sampleId, plateWell: 'A01', plateNumber: 'Plate1' }
    );
  }, [fileNamingConfig, plates, ssConfig]);

  // ── Step 6: Preview & Export ─────────────────────────────────────────────

  const generatedSequence = useMemo((): GeneratedSequence => {
    const input: GenerateSequenceInput = {
      plates,
      sampleCategories,
      ssConfig,
      slotAssignment,
      pathsConfig,
      fileNamingConfig,
    };
    return generateSequence(input);
  }, [plates, sampleCategories, ssConfig, slotAssignment, pathsConfig, fileNamingConfig]);

  const exportSequenceCSV = useCallback(() => {
    const csv = formatThermoCSV(generatedSequence);
    // Filename: <base_name_of_input_file>_injection-sequence.csv
    let baseName = 'output';
    if (inputFileName) {
      baseName = inputFileName.replace(/\.[^/.]+$/, ''); // Remove extension
    }
    const exportFilename = `${baseName}_injection-sequence.csv`;
    downloadSequenceCSV(csv, exportFilename);
  }, [generatedSequence, inputFileName]);

  const exportMappingCSV = useCallback(() => {
    const mappings: IdMapping[] = [];
    const expRows = generatedSequence.rows.filter(r => r.category !== 'System Suitability');
    const totalSamples = generatedSequence.totalSampleCount;
    let serialCounter = fileNamingConfig.serialIdConfig.startNumber;

    for (const row of expRows) {
      const serialId = generateSerialId(
        fileNamingConfig.serialIdConfig.prefix,
        serialCounter,
        totalSamples,
        fileNamingConfig.serialIdConfig.startNumber
      );
      mappings.push({
        serialId,
        originalSampleId: row.originalSampleId,
        // Safe: expRows is filtered to non-SS rows, which always have a non-null plateNumber
        plateNumber: row.plateNumber!,
        wellPosition: row.wellPosition,
      });
      serialCounter++;
    }

    const csv = generateMappingCSV(mappings);
    let baseName = 'output';
    if (inputFileName) {
      baseName = inputFileName.replace(/\.[^/.]+$/, '');
    }
    downloadSequenceCSV(csv, `${baseName}_id-mapping.csv`);
  }, [generatedSequence, fileNamingConfig.serialIdConfig, inputFileName]);

  // ── Validation ───────────────────────────────────────────────────────────

  const canProceed = useMemo((): boolean => {
    switch (currentStep) {
      case 1: {
        // Step 1: System Suitability — validate when SS runs are configured
        const hasSSRuns = isSSActive(ssConfig);
        if (hasSSRuns && ssConfig.runsDuring > 0 && ssConfig.insertionInterval <= 0) return false;
        if (hasSSRuns && !ssConfig.sampleIdentifier.trim()) return false;
        return true;
      }
      case 2: {
        // Step 2: Slot Assignment — SS slot required if SS active, all plates need slots
        if (isSSActive(ssConfig) && !slotAssignment.ssSlot) return false;
        for (let i = 0; i < plates.length; i++) {
          if (!slotAssignment.plateSlots[i]) return false;
        }
        return true;
      }
      case 3: {
        // Step 3: File Naming
        if (fileNamingConfig.selectedFields.length === 0) return false;
        // Separator must not contain Windows-unsafe filename characters
        if (UNSAFE_FILENAME_CHARS.test(fileNamingConfig.separator)) return false;
        // Free-text fields must have a value entered
        const freeTextIds = ['projectName', 'experimentName', 'instrumentName'];
        for (const field of fileNamingConfig.selectedFields) {
          if (freeTextIds.includes(field.id) && !(field.value || '').trim()) {
            return false;
          }
        }
        return true;
      }
      case 4: {
        // Step 4: Sample Categories — at least one sample in "Experimental"
        const hasExperimental = Object.values(sampleCategories.assignments).some(
          cat => cat === 'Experimental'
        );
        return hasExperimental;
      }
      case 5: {
        // Step 5: Paths & Methods — all categories must have non-empty path and method, volume in 1–20
        const categoriesToValidate = isSSActive(ssConfig)
          ? [...sampleCategories.categories, 'System Suitability']
          : sampleCategories.categories;
        for (const cat of categoriesToValidate) {
          const settings = pathsConfig.categorySettings[cat];
          if (!settings) return false;
          if (!settings.path.trim()) return false;
          if (!settings.instrumentMethod.trim()) return false;
          if (settings.injectionVolume < 1 || settings.injectionVolume > 20) return false;
        }
        return true;
      }
      case 6:
        return true;
      default:
        return false;
    }
  }, [currentStep, sampleCategories, ssConfig, slotAssignment, plates.length, pathsConfig, fileNamingConfig]);

  // ── Navigation ───────────────────────────────────────────────────────────

  const goToStep = useCallback((step: number) => {
    // Only allow navigating to completed steps (steps before current)
    if (step >= 1 && step < currentStep) {
      setCurrentStep(step);
    }
  }, [currentStep]);

  const nextStep = useCallback(() => {
    if (canProceed && currentStep < TOTAL_STEPS) {
      setCurrentStep(prev => prev + 1);
    }
  }, [canProceed, currentStep]);

  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const resetStep = useCallback(() => {
    setCurrentStep(1);
  }, []);

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    currentStep,
    goToStep,
    nextStep,
    prevStep,
    resetStep,
    canProceed,

    sampleCategories,
    setSampleCategory,
    addCategory,
    removeCategory,

    ssConfig,
    updateSSConfig,

    slotAssignment,
    updateSlotAssignment,
    oversizedPlateWarning,

    pathsConfig,
    updateCategorySettings,
    applyToAllCategories,

    fileNamingConfig,
    updateFileNaming,
    filenamePreview,
    availableFields: AVAILABLE_FIELDS,

    generatedSequence,
    exportSequenceCSV,
    exportMappingCSV,
  };
}
