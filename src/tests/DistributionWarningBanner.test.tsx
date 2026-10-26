import React from 'react';
import { render, screen } from '@testing-library/react';
import DistributionWarningBanner from '../components/DistributionWarningBanner';

describe('DistributionWarningBanner', () => {
  it('lists two groups whose names are the same without a duplicate key warning', () => {
    // Treatment "a | b" with Dose "c", and Treatment "a" with Dose "b | c", have the same name
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <DistributionWarningBanner
          severity="warning"
          sections={[{ line: '2 groups are unevenly placed.', groups: ['a | b | c (2 samples)', 'a | b | c (2 samples)'] }]}
          testId="banner"
        />
      );
      expect(screen.getAllByRole('listitem').map((item) => item.textContent))
        .toEqual(['a | b | c (2 samples)', 'a | b | c (2 samples)']);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
