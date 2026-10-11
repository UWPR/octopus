import React from 'react';

// Number of sparse groups named before the rest are counted
const MAX_NAMED_GROUPS = 5;

interface DistributionWarningBannerProps {
  // 'error' when some group cannot reach every plate or row, 'warning' for balance only
  severity: 'error' | 'warning';
  // One line per kind of problem, from the group distribution warnings. Empty shows nothing.
  lines: string[];
  // Groups too small to reach every plate, named smallest first
  sparseGroups: { label: string; count: number }[];
  testId: string;
  // When set, a button that opens the Covariate Summary
  onShowGroups?: () => void;
}

/**
 * A banner for covariate groups that are spread poorly across the plates, shown where the user
 * works: before Generate below the configuration, and after Generate above the plates. Red for a
 * group that cannot reach every plate or row, amber for uneven balance only.
 */
const DistributionWarningBanner: React.FC<DistributionWarningBannerProps> = ({
  severity,
  lines,
  sparseGroups,
  testId,
  onShowGroups,
}) => {
  const palette = severity === 'error'
    ? { bg: '#fef2f2', border: '#fca5a5', accent: '#dc3545', text: '#991b1b' }
    : { bg: '#fffbeb', border: '#fde68a', accent: '#ff9800', text: '#92400e' };

  const smallestFirst = [...sparseGroups].sort((a, b) => a.count - b.count || a.label.localeCompare(b.label));
  const named = smallestFirst.slice(0, MAX_NAMED_GROUPS)
    .map(group => `${group.label} (${group.count} ${group.count === 1 ? 'sample' : 'samples'})`);
  const unnamed = smallestFirst.length - named.length;

  return (
    // Polite live region, not role="alert": the warnings change as the user edits the design. The
    // region is always rendered and only its content changes, since screen readers announce changes
    // to a live region that already exists, not one inserted with its text.
    <div role="status" aria-live="polite">
      {lines.length > 0 && (
        <div
          data-testid={testId}
          data-severity={severity}
          style={{
            ...styles.banner,
            backgroundColor: palette.bg,
            border: `1px solid ${palette.border}`,
            borderLeft: `5px solid ${palette.accent}`,
            color: palette.text,
          }}
        >
          <span style={{ ...styles.icon, backgroundColor: palette.accent }} aria-hidden="true">!</span>
          <div style={styles.text}>
            {lines.map((line, i) => <div key={i}>{line}</div>)}
            {named.length > 0 && (
              <div style={styles.groups}>
                Smallest groups: {named.join(', ')}{unnamed > 0 ? `, and ${unnamed} more` : ''}
              </div>
            )}
            {onShowGroups && (
              <button type="button" onClick={onShowGroups} style={{ ...styles.button, color: palette.text }}>
                Show affected groups
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    margin: '12px 0',
    padding: '12px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  icon: {
    flexShrink: 0,
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    color: '#fff',
    fontWeight: '700',
    fontSize: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  groups: {
    fontWeight: '600',
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: '4px',
    padding: '4px 10px',
    fontSize: '13px',
    background: 'transparent',
    border: '1px solid currentColor',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default DistributionWarningBanner;
