import React from 'react';

interface FileUploadSectionProps {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadLayout: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const FileUploadSection: React.FC<FileUploadSectionProps> = ({
  onFileUpload,
  onLoadLayout
}) => {
  return (
    <div style={styles.fileUploadContainer}>
      {/* Default the picker to CSV; a user can switch to "All files" and pick a saved .json
          layout, which handleChooseFile still routes to the layout load. */}
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
        accept=".json"
        onChange={onLoadLayout}
        style={styles.hiddenFileInput}
      />
      <label htmlFor="layout-upload" style={styles.loadLayoutButton}
        title="Load a previously saved Octopus layout .json file to reproduce the plate layout">
        Load Layout
      </label>
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
};

export default FileUploadSection;
