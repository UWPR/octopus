import React, { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';

interface ExportMenuProps {
  onDownloadCsv: () => void;
  onDownloadExcel: () => void;
  onSaveLayout: () => void;
  onExportSequence: () => void;
}

interface ExportMenuItem {
  label: string;
  title: string;
  action: () => void;
}

/**
 * A single "Export" button that opens a popup menu of the export/save actions
 * (CSV, Excel, Layout, Sequence). Replaces the row of four separate buttons so the
 * controls take up less horizontal space. Each menu item carries a tooltip describing
 * what it does.
 *
 * Follows the WAI-ARIA menu-button pattern: opening moves focus into the menu, the
 * arrow/Home/End keys move between items, and Escape closes the menu and returns focus
 * to the trigger. Items highlight on both hover and keyboard focus.
 */
const ExportMenu: React.FC<ExportMenuProps> = ({
  onDownloadCsv,
  onDownloadExcel,
  onSaveLayout,
  onExportSequence,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items: ExportMenuItem[] = [
    {
      label: 'CSV',
      title: 'Download the plate layout as a CSV file',
      action: onDownloadCsv,
    },
    {
      label: 'Excel',
      title: 'Download the plate layout as a formatted Excel (.xlsx) workbook',
      action: onDownloadExcel,
    },
    {
      label: 'Layout',
      title: 'Save the layout and its settings to a file you can load back to reproduce it',
      action: onSaveLayout,
    },
    {
      label: 'Sequence',
      title: 'Open the wizard to export an instrument injection sequence',
      action: onExportSequence,
    },
  ];

  // Close the menu on an outside click, or on Escape (returning focus to the trigger).
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // When the menu opens, move focus to the first item so keyboard users land inside it.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Run an action, close the menu, and return focus to the trigger so keyboard / screen-reader
  // focus does not fall back to <body> when the active menu item unmounts. Actions that open a
  // dialog move focus again as needed after they mount.
  const runAction = (action: () => void) => {
    setOpen(false);
    action();
    triggerRef.current?.focus();
  };

  // Move focus between items, wrapping at the ends.
  const focusItemAt = (index: number) => {
    const count = items.length;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const handleItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItemAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItemAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItemAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusItemAt(items.length - 1);
        break;
      default:
        break;
    }
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    // Let the down/up arrows open the menu from the trigger, like a native menu button.
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={containerRef} style={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={handleTriggerKeyDown}
        style={styles.triggerButton}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>Export</span>
        <FontAwesomeIcon
          icon={open ? faChevronUp : faChevronDown}
          style={styles.triggerIcon}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div style={styles.menu} role="menu">
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={() => runAction(item.action)}
              onKeyDown={(e) => handleItemKeyDown(e, index)}
              style={styles.menuItem}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f1f3f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              onFocus={(e) => { e.currentTarget.style.backgroundColor = '#f1f3f5'; }}
              onBlur={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'relative' as const,
    display: 'inline-block',
  },
  triggerButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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
  triggerIcon: {
    fontSize: '12px',
  },
  menu: {
    position: 'absolute' as const,
    top: 'calc(100% + 6px)',
    left: 0,
    minWidth: '180px',
    backgroundColor: '#fff',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    padding: '6px',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#495057',
    transition: 'background-color 0.2s ease',
    whiteSpace: 'nowrap' as const,
  },
};

export default ExportMenu;
