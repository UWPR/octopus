import React, { useState } from 'react';
import { SearchData } from '../../../utils/types';
import { SampleCategoryConfig } from '../../../utils/sequenceExportTypes';

interface SampleCategoryStepProps {
  sampleCategories: SampleCategoryConfig;
  setSampleCategory: (sampleNames: string[], category: string) => void;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  searches: SearchData[];
}

export const SampleCategoryStep: React.FC<SampleCategoryStepProps> = ({
  sampleCategories,
  setSampleCategory,
  addCategory,
  removeCategory,
  searches,
}) => {
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [newCategoryName, setNewCategoryName] = useState('');

  const hasExperimental = Object.values(sampleCategories.assignments).some(
    cat => cat === 'Experimental'
  );

  const samplesByCategory: Record<string, string[]> = {};
  for (const cat of sampleCategories.categories) {
    samplesByCategory[cat] = [];
  }
  for (const search of searches) {
    const cat = sampleCategories.assignments[search.name] || 'Experimental';
    if (!samplesByCategory[cat]) samplesByCategory[cat] = [];
    samplesByCategory[cat].push(search.name);
  }

  const toggleSample = (name: string) => {
    setSelectedSamples(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllInCategory = (cat: string) => {
    const samples = samplesByCategory[cat] || [];
    setSelectedSamples(prev => {
      const next = new Set(prev);
      for (const name of samples) {
        next.add(name);
      }
      return next;
    });
  };

  const deselectAllInCategory = (cat: string) => {
    const samples = samplesByCategory[cat] || [];
    setSelectedSamples(prev => {
      const next = new Set(prev);
      for (const name of samples) {
        next.delete(name);
      }
      return next;
    });
  };

  const handleBulkAssign = (category: string) => {
    if (selectedSamples.size === 0) return;
    setSampleCategory(Array.from(selectedSamples), category);
    setSelectedSamples(new Set());
  };

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (trimmed && !sampleCategories.categories.includes(trimmed)) {
      addCategory(trimmed);
      setNewCategoryName('');
    }
  };

  const allSelectedInCategory = (cat: string) => {
    const samples = samplesByCategory[cat] || [];
    return samples.length > 0 && samples.every(name => selectedSamples.has(name));
  };

  return (
    <div>
      <h3 style={styles.heading}>Sample Categories</h3>
      <p style={styles.description}>
        Each sample is assigned to a category that determines its path, instrument method, and injection volume.
        To reassign samples: check the samples you want to move, then click a category button below to move them.
      </p>

      {!hasExperimental && (
        <div style={styles.warning}>
          ⚠ At least one sample must be in the "Experimental" category to proceed.
        </div>
      )}

      {/* Bulk assign bar — always visible */}
      <div style={styles.bulkAssignBar}>
        <div style={styles.bulkAssignTop}>
          <span style={styles.selectedCount}>
            {selectedSamples.size > 0
              ? `${selectedSamples.size} sample${selectedSamples.size > 1 ? 's' : ''} selected`
              : 'No samples selected'}
          </span>
          {selectedSamples.size > 0 && (
            <button
              style={styles.clearButton}
              onClick={() => setSelectedSamples(new Set())}
            >
              Clear selection
            </button>
          )}
        </div>
        <div style={styles.assignRow}>
          <span style={styles.assignLabel}>Move selected to:</span>
          {sampleCategories.categories.map(cat => (
            <button
              key={cat}
              style={{
                ...styles.categoryButton,
                ...(selectedSamples.size === 0 ? styles.categoryButtonDisabled : {}),
              }}
              onClick={() => handleBulkAssign(cat)}
              disabled={selectedSamples.size === 0}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Add new category */}
      <div style={styles.addCategoryRow}>
        <input
          style={styles.input}
          type="text"
          placeholder="New category name..."
          value={newCategoryName}
          onChange={e => setNewCategoryName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
        />
        <button style={styles.addButton} onClick={handleAddCategory}>
          Add Category
        </button>
      </div>

      {/* Category sections */}
      <div style={styles.categoriesContainer}>
        {sampleCategories.categories.map(cat => {
          const samples = samplesByCategory[cat] || [];
          const allSelected = allSelectedInCategory(cat);

          return (
            <div key={cat} style={styles.categorySection}>
              <div style={styles.categoryHeader}>
                <span style={styles.categoryName}>{cat}</span>
                <span style={styles.categoryCount}>({samples.length} samples)</span>
                {samples.length > 0 && (
                  <button
                    style={styles.selectAllButton}
                    onClick={() => allSelected ? deselectAllInCategory(cat) : selectAllInCategory(cat)}
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                )}
                {cat !== 'Experimental' && (
                  <button
                    style={styles.removeButton}
                    onClick={() => removeCategory(cat)}
                    title={`Remove category "${cat}"`}
                  >
                    ✕
                  </button>
                )}
              </div>
              {samples.length === 0 ? (
                <div style={styles.emptyMessage}>
                  No samples in this category. Select samples above and click "{cat}" to add them.
                </div>
              ) : (
                <div style={styles.sampleList}>
                  {samples.map(name => (
                    <label
                      key={name}
                      style={{
                        ...styles.sampleItem,
                        ...(selectedSamples.has(name) ? styles.sampleItemSelected : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSamples.has(name)}
                        onChange={() => toggleSample(name)}
                      />
                      <span style={styles.sampleName}>{name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heading: { margin: '0 0 8px 0', fontSize: '18px' },
  description: { margin: '0 0 16px 0', color: '#666', fontSize: '14px', lineHeight: '1.5' },
  warning: {
    padding: '8px 12px',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '4px',
    marginBottom: '16px',
    fontSize: '14px',
  },
  bulkAssignBar: {
    padding: '12px 14px',
    backgroundColor: '#f5f9ff',
    border: '1px solid #bbdefb',
    borderRadius: '6px',
    marginBottom: '12px',
  },
  bulkAssignTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  selectedCount: { fontSize: '13px', fontWeight: 600, color: '#333' },
  clearButton: {
    background: 'none',
    border: 'none',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '12px',
    textDecoration: 'underline',
  },
  assignRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  assignLabel: { fontSize: '13px', color: '#555' },
  categoryButton: {
    padding: '5px 12px',
    border: '1px solid #1976d2',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  categoryButtonDisabled: {
    borderColor: '#ccc',
    color: '#999',
    cursor: 'not-allowed',
  },
  addCategoryRow: { display: 'flex', gap: '8px', marginBottom: '16px' },
  input: {
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    width: '200px',
  },
  addButton: {
    padding: '6px 12px',
    border: '1px solid #1976d2',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '13px',
  },
  categoriesContainer: { display: 'flex', flexDirection: 'column', gap: '12px' },
  categorySection: {
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    padding: '12px',
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  categoryName: { fontWeight: 600, fontSize: '14px' },
  categoryCount: { color: '#666', fontSize: '13px' },
  selectAllButton: {
    background: 'none',
    border: 'none',
    color: '#1976d2',
    cursor: 'pointer',
    fontSize: '12px',
    textDecoration: 'underline',
    marginLeft: '4px',
  },
  removeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#999',
    fontSize: '14px',
    marginLeft: 'auto',
  },
  emptyMessage: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic',
    padding: '8px 0',
  },
  sampleList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    maxHeight: '150px',
    overflowY: 'auto',
  },
  sampleItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 6px',
    fontSize: '12px',
    cursor: 'pointer',
    borderRadius: '3px',
  },
  sampleItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  sampleName: { fontSize: '12px' },
};
