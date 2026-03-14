import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('Renders the main title', () => {
  render(<App />);
  const titleElement = screen.getByText("Octopus Plate Designer");
  expect(titleElement).toBeInTheDocument();
});
