import { test, expect } from '@playwright/test';
import { uploadAndConfigure, uploadConfigureAndRandomize } from './helpers';

/**
 * Choose File accepts only CSV files. A non-CSV file (e.g. an Excel workbook) is rejected up
 * front by extension, and a .csv that yields no readable columns is rejected after parsing.
 * Either way an error is shown and the file is not adopted.
 */

// An in-memory Excel file - only its name matters for the extension check.
const XLSX_FILE = {
  name: 'samples.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('PK not a real spreadsheet'),
};

test.describe('Choose File validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('rejects a non-CSV (Excel) file with an error and does not adopt it', async ({ page }) => {
    await page.locator('#file-upload').setInputFiles(XLSX_FILE);

    await expect(page.getByText(/is not a CSV file/)).toBeVisible();
    // The rejected file is not loaded: the ID-column selector has no columns.
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('choosing a non-CSV over a plate layout prompts, then clears it and shows the error on confirm', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Selecting a file while a layout is shown prompts to replace; confirming clears it.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-upload').setInputFiles(XLSX_FILE);

    await expect(page.getByText(/is not a CSV file/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();
    await expect(page.getByText('Plate 1')).not.toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('choosing a non-CSV after a file is loaded (not generated) clears the previous file with no prompt', async ({ page }) => {
    // Load and configure a valid CSV, but do NOT generate a plate (no layout displayed).
    await uploadAndConfigure(page);
    await expect(page.getByText(/trx-phase1b-small\.csv/)).toBeVisible();

    // No prompt when no layout is shown; the previous file and its columns are cleared regardless.
    let sawDialog = false;
    page.on('dialog', async dialog => { sawDialog = true; await dialog.dismiss(); });
    await page.locator('#file-upload').setInputFiles(XLSX_FILE);

    expect(sawDialog).toBe(false);
    await expect(page.getByText(/is not a CSV file/)).toBeVisible();
    await expect(page.getByText(/trx-phase1b-small\.csv/)).not.toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects a .csv that has no readable columns', async ({ page }) => {
    await page.locator('#file-upload').setInputFiles({
      name: 'empty.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(''),
    });

    await expect(page.getByText(/Could not read any columns/)).toBeVisible();
    // The rejected file is not loaded: the ID-column selector has no columns.
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('blocks Generate when the selected ID column has duplicate values', async ({ page }) => {
    // 'Sample ID' repeats S1; 'Well' is unique.
    const csv = 'Sample ID,Well,Condition\nS1,W1,A\nS1,W2,B\nS2,W3,A\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'dupes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    // 'Sample ID' auto-selects (its name matches) and its repeated value blocks generation.
    await expect(page.getByText(/has repeated values/)).toBeVisible();
    await page.locator('#covariates').selectOption(['Condition']);
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeDisabled();

    // Switching to a column with unique values clears the error.
    await page.locator('#idColumn').selectOption('Well');
    await expect(page.getByText(/has repeated values/)).not.toBeVisible();
  });

  test('blocks Generate when the selected ID column has blank or whitespace-only values', async ({ page }) => {
    // The second row's Sample ID is whitespace-only (treated as blank).
    const csv = 'Sample ID,Condition\nS1,A\n   ,B\nS3,A\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'blanks.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/has \d+ blank value/)).toBeVisible();
    await page.locator('#covariates').selectOption(['Condition']);
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeDisabled();
  });

  test('warns about a CSV with formatting problems but still loads it', async ({ page }) => {
    // Row 2 has an extra column, so Papa reports a field-count mismatch.
    const csv = 'Sample ID,Condition\nS1,A\nS2,A,EXTRA\nS3,B\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'ragged.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/formatting problems/)).toBeVisible();
    // It still loaded: the ID column is populated.
    await expect(page.locator('#idColumn option')).toHaveCount(2);
  });

  test('a CSV with valid headers but no samples still replaces a shown design', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Header-only CSV: it parses columns but yields zero samples. Confirm the overwrite.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-upload').setInputFiles({
      name: 'headers-only.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Sample ID,Condition\n'),
    });

    // The previous design is replaced even though the new file has no samples.
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();
    await expect(page.getByText('Plate 1')).not.toBeVisible();
    await expect(page.getByText(/headers-only\.csv/)).toBeVisible();
  });
});
