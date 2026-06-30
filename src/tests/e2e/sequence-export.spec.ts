import { test, expect } from '@playwright/test';
import { uploadConfigureAndRandomize } from './helpers';
import fs from 'fs';
import path from 'path';

/**
 * E2E Tests for Injection Sequence Export Wizard
 *
 * Tests the wizard flow:
 * 1. Full wizard flow: open → configure all steps → export → verify CSV format
 * 2. SS disabled flow: skip SS → verify no SS rows in output
 * 3. Cancel flow: open wizard → enter data → cancel → verify no download
 */

test.describe('Sequence Export Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await uploadConfigureAndRandomize(page);
  });

  test('Export Sequence button is visible after plate generation', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: 'Export Sequence' });
    await expect(exportButton).toBeVisible();
  });

  test('full wizard flow produces valid Thermo CSV', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();
    await expect(page.getByRole('dialog', { name: 'Export Sequence Wizard' })).toBeVisible();

    // Step 1: System Suitability — set 1 run at start, 1 at end
    await expect(page.getByRole('heading', { name: 'System Suitability' })).toBeVisible();
    await page.getByLabel('Runs at start:').fill('1');
    await page.getByLabel('Runs at end:').fill('1');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment — SS slot should be required
    await expect(page.getByRole('heading', { name: 'Autosampler Slot Assignment' })).toBeVisible();
    await page.getByLabel('System Suitability slot').selectOption('Y');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select some fields
    await expect(page.getByRole('heading', { name: 'File Naming Template' })).toBeVisible();
    await page.getByLabel('Instrument Name').check();
    // Fill in the instrument name value
    const instrumentInput = page.locator('input[placeholder="Enter instrument name..."]');
    await instrumentInput.fill('Astral');
    await page.getByLabel('Sample Identifier').check();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 4: Sample Categories — should auto-detect and show categories
    await expect(page.getByRole('heading', { name: 'Sample Categories' })).toBeVisible();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 5: Paths & Methods — fill in paths for all categories
    await expect(page.getByRole('heading', { name: 'Paths & Instrument Methods' })).toBeVisible();
    // Fill path and method for each category using "Apply to all"
    const pathInputs = page.locator('input[placeholder="D:\\\\Data\\\\Experiment"]');
    await pathInputs.first().fill('D:\\Data\\Project');
    const methodInputs = page.locator('input[placeholder="C:\\\\Methods\\\\method.meth"]');
    await methodInputs.first().fill('C:\\Methods\\method.meth');
    await page.getByRole('button', { name: /Apply first category/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 6: Preview & Export — verify table is visible
    await expect(page.getByRole('heading', { name: 'Preview & Export' })).toBeVisible();
    await expect(page.getByText(/Total runs:/)).toBeVisible();

    // Verify the table has rows
    const tableRows = page.locator('table tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify first row is System Suitability (SS at start)
    const firstRowBg = await tableRows.first().evaluate(el => getComputedStyle(el).backgroundColor);
    // SS rows have blue-ish background (#e3f2fd)
    expect(firstRowBg).not.toBe('rgb(255, 255, 255)');

    // Download the CSV
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    // Verify filename follows pattern: <input_basename>_injection-sequence.csv
    expect(download.suggestedFilename()).toMatch(/injection-sequence\.csv$/);

    // Read and verify CSV content
    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n');

    // First line: Bracket Type header
    expect(lines[0]).toBe('Bracket Type=4,,,,');

    // Second line: column headers
    expect(lines[1]).toBe('File Name,Path,Instrument Method,Position,Inj Vol');

    // Data rows should have exactly 5 fields each
    for (let i = 2; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      const fields = lines[i].split(',');
      expect(fields.length).toBe(5);
    }

    // First data row should be SS (position starts with Y:)
    expect(lines[2]).toContain('Y:A1');

    // Total data rows = 288 samples + 2 SS (1 start + 1 end) = 290
    const dataLines = lines.slice(2).filter(l => l.trim() !== '');
    expect(dataLines.length).toBe(290);
  });

  test('custom SS sample identifier appears in filenames', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — set 2 runs at start, change identifier to "SystSuit"
    await page.getByLabel('Runs at start:').fill('2');
    const identifierInput = page.getByLabel('Identifier used in filenames');
    await identifierInput.clear();
    await identifierInput.fill('SystSuit');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment — select SS slot
    await page.getByLabel('System Suitability slot').selectOption('Y');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select sample ID field
    await page.getByLabel('Sample Identifier').check();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 4: Sample Categories
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 5: Paths & Methods
    const pathInputs = page.locator('input[placeholder="D:\\\\Data\\\\Experiment"]');
    await pathInputs.first().fill('D:\\Data');
    const methodInputs = page.locator('input[placeholder="C:\\\\Methods\\\\method.meth"]');
    await methodInputs.first().fill('C:\\Methods\\m.meth');
    await page.getByRole('button', { name: /Apply first category/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 6: Preview & Export — download and verify
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // First 2 data rows should be SS with "SystSuit" in the filename
    const ssRow1 = lines[2].split(',')[0]; // File Name of first SS row
    const ssRow2 = lines[3].split(',')[0]; // File Name of second SS row
    expect(ssRow1).toContain('SystSuit');
    expect(ssRow2).toContain('SystSuit');

    // Experimental rows should NOT contain "SystSuit"
    const expRow = lines[4].split(',')[0];
    expect(expRow).not.toContain('SystSuit');
  });

  test('custom SS well position appears in exported CSV', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — set 1 run at start
    await page.getByLabel('Runs at start:').fill('1');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment — select SS slot and change well to B3
    await page.getByLabel('System Suitability slot').selectOption('R');
    await page.getByLabel('System Suitability well').selectOption('B3');
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select sample ID
    await page.getByLabel('Sample Identifier').check();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 4: Sample Categories
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 5: Paths & Methods
    const pathInputs = page.locator('input[placeholder="D:\\\\Data\\\\Experiment"]');
    await pathInputs.first().fill('D:\\Data');
    const methodInputs = page.locator('input[placeholder="C:\\\\Methods\\\\method.meth"]');
    await methodInputs.first().fill('C:\\Methods\\m.meth');
    await page.getByRole('button', { name: /Apply first category/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 6: Download and verify
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // First data row is SS — position should be R:B3
    const ssPosition = lines[2].split(',')[3];
    expect(ssPosition).toBe('R:B3');
  });

  test('wizard with no SS runs produces sequence without SS rows', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — leave all at 0 (default)
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment — no SS slot needed
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select sample ID
    await page.getByLabel('Sample Identifier').check();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 4: Sample Categories
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 5: Paths & Methods
    const pathInputs = page.locator('input[placeholder="D:\\\\Data\\\\Experiment"]');
    await pathInputs.first().fill('D:\\Data');
    const methodInputs = page.locator('input[placeholder="C:\\\\Methods\\\\method.meth"]');
    await methodInputs.first().fill('C:\\Methods\\m.meth');
    await page.getByRole('button', { name: /Apply first category/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 6: Preview — verify no SS rows
    await expect(page.getByRole('heading', { name: 'Preview & Export' })).toBeVisible();

    // Download and verify
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // No SS rows — total should be exactly 288 (all samples) + 2 header lines = 290 lines
    expect(lines.length).toBe(290);

    // Verify all 288 data rows are present (no SS rows added)
    const dataLines = lines.slice(2);
    expect(dataLines.length).toBe(288);
  });

  test('cancel closes wizard without downloading', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();
    await expect(page.getByRole('dialog', { name: 'Export Sequence Wizard' })).toBeVisible();

    // Click cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Wizard should be hidden (the component returns null when not visible)
    await expect(page.getByRole('dialog', { name: 'Export Sequence Wizard' })).not.toBeVisible();

    // No download should have occurred — verify Export Sequence button is still there
    await expect(page.getByRole('button', { name: 'Export Sequence' })).toBeVisible();
  });

  test('unsafe separator character shows warning', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — skip
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment — skip
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select Custom separator and type "/"
    const customRadio = page.getByLabel('Custom:');
    await customRadio.check();
    const customInput = page.locator('input[maxlength="1"]');
    await customInput.fill('/');

    // Warning should appear
    await expect(page.getByText(/not safe for Windows filenames/)).toBeVisible();

    // Change to a safe character — warning should disappear
    await customInput.fill('~');
    await expect(page.getByText(/not safe for Windows filenames/)).not.toBeVisible();
  });

  test('unsafe SS sample identifier shows warning', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — set runs so identifier is relevant
    await page.getByLabel('Runs at start:').fill('1');

    // Type an unsafe character in the identifier
    const identifierInput = page.getByLabel('Identifier used in filenames');
    await identifierInput.clear();
    await identifierInput.fill('my/SS');

    // Warning should appear
    await expect(page.getByText(/unsafe for Windows filenames/)).toBeVisible();

    // Change to a safe value — warning should disappear
    await identifierInput.clear();
    await identifierInput.fill('SS');
    await expect(page.getByText(/unsafe for Windows filenames/)).not.toBeVisible();
  });

  test('step indicator prevents forward navigation', async ({ page }) => {
    // Open wizard
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Try clicking step 6 directly — should be disabled
    const step6Button = page.getByRole('button', { name: /Step 6/ });
    await expect(step6Button).toBeDisabled();

    // Step 1 should be current (not disabled)
    const step1Button = page.getByRole('button', { name: /Step 1/ });
    await expect(step1Button).not.toBeDisabled();
  });
});


test.describe('Sequence Export with partially-filled plates', () => {
  const STROKE_TOTAL_SAMPLES = 72;
  const PLATE_ROWS = 6;
  const PLATE_COLS = 9;

  async function uploadStrokeData(page: import('@playwright/test').Page) {
    const testFilePath = path.join(__dirname, '../../../test-data/stroke-multiplate-example.csv');
    await page.locator('#file-upload').setInputFiles(testFilePath);
    await page.locator('#qcColumn').selectOption('Sample Type');
    await page.getByRole('checkbox', { name: 'BatchRef' }).check();
    await page.getByRole('checkbox', { name: 'BatchQC' }).check();
    await page.locator('#covariates').selectOption(['Outcome']);
    await page.locator('#plateRows').fill(PLATE_ROWS.toString());
    await page.locator('#plateColumns').fill(PLATE_COLS.toString());
  }

  async function navigateWizardToExport(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Export Sequence' }).click();

    // Step 1: System Suitability — leave defaults (no SS)
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 2: Slot Assignment
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 3: File Naming — select sample ID
    await page.getByLabel('Sample Identifier').check();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 4: Sample Categories
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 5: Paths & Methods
    const pathInputs = page.locator('input[placeholder="D:\\\\Data\\\\Experiment"]');
    await pathInputs.first().fill('D:\\Data');
    const methodInputs = page.locator('input[placeholder="C:\\\\Methods\\\\method.meth"]');
    await methodInputs.first().fill('C:\\Methods\\m.meth');
    await page.getByRole('button', { name: /Apply first category/ }).click();
    await page.getByRole('button', { name: 'Next →' }).click();

    // Step 6: Preview & Export
    await expect(page.getByRole('heading', { name: 'Preview & Export' })).toBeVisible();
  }

  test('empty wells skipped — keep empty unchecked (even distribution)', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await uploadStrokeData(page);

    // Keep empty in last plate: unchecked (default)
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await expect(page.getByRole('button', { name: 'Export Sequence' })).toBeVisible();

    await navigateWizardToExport(page);

    // Download CSV
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // Header (2 lines) + 72 sample rows = 74 total lines
    expect(lines.length).toBe(STROKE_TOTAL_SAMPLES + 2); // 72 samples + 2 header lines

    // Verify consecutive run numbers 1..72
    const dataLines = lines.slice(2);
    expect(dataLines.length).toBe(STROKE_TOTAL_SAMPLES);

    // Each row should have exactly 5 fields
    for (const line of dataLines) {
      const fields = line.split(',');
      expect(fields.length).toBe(5);
    }

    // Verify run counter in filenames is consecutive (last segment of filename)
    for (let i = 0; i < dataLines.length; i++) {
      const fileName = dataLines[i].split(',')[0];
      const expectedCounter = (i + 1).toString().padStart(3, '0');
      expect(fileName).toContain(expectedCounter);
    }
  });

  test('empty wells skipped — keep empty checked (last plate has gaps)', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await uploadStrokeData(page);

    // Check "keep empty in last plate"
    await page.getByRole('checkbox', { name: /empty/i }).check();
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await expect(page.getByRole('button', { name: 'Export Sequence' })).toBeVisible();

    await navigateWizardToExport(page);

    // Download CSV
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Sequence CSV' }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // Still 72 samples regardless of plate layout — empty wells are skipped
    expect(lines.length).toBe(STROKE_TOTAL_SAMPLES + 2);

    const dataLines = lines.slice(2);
    expect(dataLines.length).toBe(STROKE_TOTAL_SAMPLES);

    // Verify consecutive run counter in filenames
    for (let i = 0; i < dataLines.length; i++) {
      const fileName = dataLines[i].split(',')[0];
      const expectedCounter = (i + 1).toString().padStart(3, '0');
      expect(fileName).toContain(expectedCounter);
    }

    // Verify all rows have 5 fields
    for (const line of dataLines) {
      expect(line.split(',').length).toBe(5);
    }

    // Verify positions reference valid slots (Y, B, R, or G)
    for (const line of dataLines) {
      const position = line.split(',')[3];
      expect(position).toMatch(/^[YBRG]:[A-F]\d+$/);
    }
  });
});


