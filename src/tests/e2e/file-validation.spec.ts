import { test, expect } from '@playwright/test';
import { uploadAndConfigure, uploadConfigureAndRandomize } from './helpers';

/**
 * Choose File accepts CSV sample files and JSON layout files. A file with any other extension
 * (e.g. an Excel workbook) is rejected up front, and a .csv that yields no readable columns is
 * rejected after parsing. Either way an error is shown and the file is not adopted.
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

    await expect(page.getByText(/is not a CSV or JSON file/)).toBeVisible();
    // The rejected file is not loaded: the ID-column selector has no columns.
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('choosing a non-CSV over a plate layout prompts, then clears it and shows the error on confirm', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Selecting a file while a layout is shown prompts to replace; confirming clears it.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-upload').setInputFiles(XLSX_FILE);

    await expect(page.getByText(/is not a CSV or JSON file/)).toBeVisible();
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
    await expect(page.getByText(/is not a CSV or JSON file/)).toBeVisible();
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

  test('rejects a .csv whose first row is not a header (empty column headings)', async ({ page }) => {
    // An injection-sequence export starts with a "Bracket Type=4,,,," directive, so the first
    // row has one named column and several blank ones. It must not be read as a sample list.
    const csv = 'Bracket Type=4,,,,\nFile Name,Path,Instrument Method,Position,Inj Vol\nrowA,D:\\Data,D:\\Meth,Y:A1,3\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'trx-phase1b-full_injection-sequence.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/has empty column headings/)).toBeVisible();
    // The rejected file is not loaded: the ID-column selector has no columns.
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects an old CSV layout file instead of loading it as sample data', async ({ page }) => {
    // The superseded CSV layout format has a two-column "Octopus Layout" header followed by wide
    // placement rows. Those rows have more values than the header, so it is not a simple table.
    const csv =
      'Octopus Layout,1\n' +
      'idColumn,Sample ID\n' +
      'p0r0c0,BatchQC,s001,Training,108,FA1,extra,more,cols,here,now,last\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'trx-phase1b-full_octopus_layout.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more values than there are column headers/)).toBeVisible();
    // The rejected file is not loaded: the ID-column selector has no columns.
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('tolerates a single trailing comma in the header row and still loads', async ({ page }) => {
    // A stray trailing comma yields one trailing blank header; that is allowed when every row
    // leaves that column empty.
    const csv = 'Sample ID,Condition,\nS1,A\nS2,B\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'trailing-comma.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    // It loaded cleanly: the two real columns are offered, the blank trailing one is dropped,
    // and no structural error or partial-row warning is shown.
    await expect(page.locator('#idColumn option')).toHaveCount(2);
    await expect(page.getByText(/has empty column headings/)).not.toBeVisible();
    await expect(page.getByText(/more values than there are column headers/)).not.toBeVisible();
    await expect(page.getByText(/fewer values than the header/)).not.toBeVisible();
  });

  test('rejects a .csv whose trailing-comma column contains a value in any row', async ({ page }) => {
    // The header has a trailing blank column, but a data row puts a value under it. That is a
    // value with no column header, so the file is not a simple table.
    const csv = 'Sample ID,Condition,\nS1,A\nS2,B,X\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'trailing-column-with-data.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more values than there are column headers/)).toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects a .csv with a duplicate column header', async ({ page }) => {
    // Two columns named "Dose". Papa would rename the second to "Dose_1", inventing a covariate,
    // so the file is turned away instead.
    const csv = 'Sample ID,Dose,Dose\nS1,10,20\nS2,5,7\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'dup-header.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more than one column named "Dose"/)).toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects a duplicate header even when the file starts with blank lines', async ({ page }) => {
    // Leading blank lines are skipped, so the duplicate check must still read the real header row.
    const csv = '\n\nSample ID,Dose,Dose\nS1,10,20\nS2,5,7\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'leading-blank-dup.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more than one column named "Dose"/)).toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects a .csv with headers that differ only by whitespace', async ({ page }) => {
    // "Dose" and "Dose " look distinct to Papa but collapse when metadata keys are trimmed, which
    // would silently drop a column. Reject that too.
    const csv = 'Sample ID,Dose,Dose \nS1,10,20\nS2,5,7\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'ws-dup-header.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more than one column named "Dose"/)).toBeVisible();
    await expect(page.locator('#idColumn option')).toHaveCount(0);
  });

  test('rejects a .csv with a row that has more values than the header', async ({ page }) => {
    // Row 2 has an extra value, so it does not line up with the two-column header.
    const csv = 'Sample ID,Condition\nS1,A\nS2,A,EXTRA\nS3,B\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'wide-row.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/more values than there are column headers/)).toBeVisible();
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

  test('warns about a CSV with a partial row (fewer values than the header) but still loads it', async ({ page }) => {
    // Row 2 has fewer values than the header, so it is missing a column. That is allowed but
    // warned about, since some values may not have loaded.
    const csv = 'Sample ID,Condition\nS1,A\nS2\nS3,B\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'partial-row.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/fewer values than the header/)).toBeVisible();
    // It still loaded: the ID column is populated.
    await expect(page.locator('#idColumn option')).toHaveCount(2);
  });

  test('warns about a CSV with a parse problem (unbalanced quote) but still loads it', async ({ page }) => {
    // The unterminated quote on row 2 swallows the rest of the file into one value, so S3 is lost.
    // The rows still line up with the header, so it loads, but the parse problem must be warned.
    const csv = 'Sample ID,Condition\nS1,A\nS2,"oops,B\nS3,C\n';
    await page.locator('#file-upload').setInputFiles({
      name: 'bad-quote.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });

    await expect(page.getByText(/formatting problems while being read/)).toBeVisible();
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
