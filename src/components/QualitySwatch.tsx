import React from 'react';

interface QualitySwatchProps {
  // Color of the score's band, from getQualityColor or getQualityLevelColor
  color: string;
  size?: number;
}

/**
 * A small square in the color band of a quality score, shown next to the score. It carries no
 * text, so the number is the only reading of the score. Hidden from screen readers, which read
 * the number.
 */
const QualitySwatch: React.FC<QualitySwatchProps> = ({ color, size = 10 }) => (
  <span
    aria-hidden="true"
    data-testid="quality-swatch"
    style={{
      display: 'inline-block',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '2px',
      backgroundColor: color,
      verticalAlign: 'middle',
      flexShrink: 0,
    }}
  />
);

export default QualitySwatch;
