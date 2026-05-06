import React from 'react';
import { CategorySettings, PathsMethodsConfig } from '../../../utils/sequenceExportTypes';

interface PathsMethodsStepProps {
  pathsConfig: PathsMethodsConfig;
  categories: string[];
  updateCategorySettings: (category: string, settings: Partial<CategorySettings>) => void;
  applyToAllCategories: (settings: Partial<CategorySettings>) => void;
}

export const PathsMethodsStep: React.FC<PathsMethodsStepProps> = ({
  pathsConfig,
  categories,
  updateCategorySettings,
  applyToAllCategories,
}) => {
  const firstCategory = categories[0];
  const firstSettings = pathsConfig.categorySettings[firstCategory];

  const handleApplyToAll = () => {
    if (firstSettings) {
      applyToAllCategories(firstSettings);
    }
  };

  return (
    <div>
      <h3 style={styles.heading}>Paths & Instrument Methods</h3>
      <p style={styles.description}>
        Specify the folder path, instrument method, and injection volume for each sample category.
      </p>

      <button style={styles.applyAllButton} onClick={handleApplyToAll}>
        Apply first category settings to all
      </button>

      <div style={styles.categoriesContainer}>
        {categories.map(cat => {
          const settings = pathsConfig.categorySettings[cat] || {
            path: '',
            instrumentMethod: '',
            injectionVolume: 3,
          };
          const volumeValid = settings.injectionVolume >= 1 && settings.injectionVolume <= 20;

          return (
            <div key={cat} style={styles.categoryCard}>
              <h4 style={styles.categoryName}>{cat}</h4>
              <div style={styles.fieldsGrid}>
                <label style={styles.fieldLabel}>
                  Folder path:
                  <input
                    style={{
                      ...styles.textInput,
                      ...(!settings.path.trim() ? styles.invalidInput : {}),
                    }}
                    type="text"
                    placeholder="D:\Data\Experiment"
                    value={settings.path}
                    onChange={e => updateCategorySettings(cat, { path: e.target.value })}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Instrument method:
                  <input
                    style={{
                      ...styles.textInput,
                      ...(!settings.instrumentMethod.trim() ? styles.invalidInput : {}),
                    }}
                    type="text"
                    placeholder="C:\Methods\method.meth"
                    value={settings.instrumentMethod}
                    onChange={e => updateCategorySettings(cat, { instrumentMethod: e.target.value })}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Injection volume (µL):
                  <input
                    style={{
                      ...styles.numberInput,
                      ...(!volumeValid ? styles.invalidInput : {}),
                    }}
                    type="number"
                    min={1}
                    max={20}
                    value={settings.injectionVolume}
                    onChange={e => updateCategorySettings(cat, { injectionVolume: parseInt(e.target.value) || 3 })}
                  />
                  {!volumeValid && (
                    <span style={styles.errorText}>Must be 1–20 µL</span>
                  )}
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 8px 0', fontSize: '18px' },
  description: { margin: '0 0 16px 0', color: '#666', fontSize: '14px' },
  applyAllButton: {
    padding: '6px 14px',
    border: '1px solid #1976d2',
    borderRadius: '4px',
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '13px',
    marginBottom: '16px',
  },
  categoriesContainer: { display: 'flex', flexDirection: 'column', gap: '12px' },
  categoryCard: {
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '12px 16px',
  },
  categoryName: { margin: '0 0 10px 0', fontSize: '14px', fontWeight: 600 },
  fieldsGrid: { display: 'flex', flexDirection: 'column', gap: '10px' },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontSize: '13px',
    color: '#333',
  },
  textInput: {
    padding: '6px 10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
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
  invalidInput: {
    borderColor: '#d32f2f',
  },
  errorText: {
    color: '#d32f2f',
    fontSize: '12px',
  },
};
