import React from 'react';

interface FileUploadSectionProps {
  selectedFileName: string;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  sampleCount: number;
  onLoadLayout: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const FileUploadSection: React.FC<FileUploadSectionProps> = ({
  selectedFileName,
  onFileUpload,
  sampleCount,
  onLoadLayout
}) => {
  return (
    <div style={styles.fileUploadContainer}>
      <input
        id="file-upload"
        type="file"
        accept=".csv"
        onChange={onFileUpload}
        style={styles.hiddenFileInput}
      />
      <label htmlFor="file-upload" style={styles.fileButton}>
        Choose File
      </label>
      <input
        id="layout-upload"
        type="file"
        accept=".csv"
        onChange={onLoadLayout}
        style={styles.hiddenFileInput}
      />
      <label htmlFor="layout-upload" style={styles.loadLayoutButton}
        title="Load a previously saved Octopus layout file to reproduce it">
        Load Layout
      </label>
      {selectedFileName && (
        <span style={styles.fileName}>
          {selectedFileName}
          {sampleCount > 0 && (
            <span style={styles.sampleCount}> ({sampleCount} samples)</span>
          )}
        </span>
      )}
    </div>
  );
};

const styles = {
  fileUploadContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    marginTop: '15px',
    marginBottom: '25px',
  },
  hiddenFileInput: {
    display: 'none',
  },
  fileButton: {
    display: 'inline-block',
    padding: '8px 16px',
    backgroundColor: '#2196f3',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    textAlign: 'center' as const,
    textDecoration: 'none',
    transition: 'background-color 0.3s ease',
  },
  loadLayoutButton: {
    display: 'inline-block',
    padding: '8px 16px',
    backgroundColor: '#fff',
    color: '#2196f3',
    border: '1px solid #2196f3',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    textAlign: 'center' as const,
    textDecoration: 'none',
    transition: 'background-color 0.3s ease',
  },
  fileName: {
    fontSize: '14px',
    color: '#333',
    fontWeight: 'normal',
    wordBreak: 'break-all' as const,
  },
  sampleCount: {
    color: '#666',
    fontStyle: 'italic',
  },
};

export default FileUploadSection;