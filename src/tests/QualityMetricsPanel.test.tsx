/**
 * Component tests for the Quality Assessment popup's overall score line.
 *
 * The overall score is the average of the balance and clustering scores with more than one
 * plate, and the clustering score alone with one plate. The popup states which rule it used.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import QualityMetricsPanel from '../components/QualityMetricsPanel';
import { calculateQualityMetrics } from '../utils/qualityMetrics';
import { buildCovariateKey } from '../utils/utils';
import { SearchData } from '../utils/types';

const COV = ['Treatment'];

const sampleOf = (name: string, treatment: string): SearchData => {
  const sample: SearchData = { name, metadata: { Treatment: treatment } };
  sample.covariateKey = buildCovariateKey(sample, { selectedCovariates: COV });
  return sample;
};

// Four samples, two of each group, one row per plate
const plate1 = [sampleOf('a1', 'A'), sampleOf('b1', 'B')];
const plate2 = [sampleOf('a2', 'A'), sampleOf('b2', 'B')];
const searches = [...plate1, ...plate2];

describe('QualityMetricsPanel overall score', () => {
  it('labels the overall score and states it is the average of balance and clustering with several plates', () => {
    const metrics = calculateQualityMetrics(searches, new Map([[0, plate1], [1, plate2]]), [[plate1], [plate2]], COV);

    render(<QualityMetricsPanel metrics={metrics} show onClose={() => {}} numPlates={2} />);

    expect(screen.getByText('Overall')).toBeInTheDocument();
    expect(screen.getByText('Overall = (Balance + Clustering) / 2')).toBeInTheDocument();
    // Both plates match the study exactly and neither has two of a group side by side
    expect(metrics.overallQuality.score).toBe(100);
  });

  it('states that the overall score is the clustering score with one plate', () => {
    const metrics = calculateQualityMetrics(searches, new Map([[0, searches]]), [[searches]], COV);

    render(<QualityMetricsPanel metrics={metrics} show onClose={() => {}} numPlates={1} />);

    expect(screen.getByText('Overall = Clustering, since a single plate is always in balance')).toBeInTheDocument();
    expect(screen.queryByText('Avg Balance:')).not.toBeInTheDocument();
  });
});
