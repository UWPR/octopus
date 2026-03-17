import { test, expect } from '@playwright/test';
import path from 'path';
import { getAllPlateFingerprints, uploadConfigureAndRandomize, EXPECTED_GROUPS, NUM_COVARIATE_GROUPS } from './helpers';

/**
 * E2E Happy Path Tests
 *
 * Tests the complete user workflow:
 * 1. Upload CSV → configure → randomize → verify → export
 * 2. Re-randomization produces different layouts
 * 3. Single plate re-randomization only affects targeted plate
 * 4. Covariate summary panel shows/hides with correct content
 * 5. Quality metrics modal displays scores
 */

test.describe('Happy Path Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus Plate Designer' })).toBeVisible();
  });

  test('complete workflow from upload to export', async ({ page }) => {
    // Step 1: Upload file
    const testFilePath = path.join(__dirname, '../../../test-data/trx-phase1b-small.csv');
    await page.locator('input[type="file"]').setInputFiles(testFilePath);

    // Verify file is loaded
    await expect(page.getByText(/trx-phase1b-small\.csv/)).toBeVisible();
    await expect(page.getByText(/288 samples/)).toBeVisible();

    // Step 2: Configure settings - verify defaults and make selections
    await expect(page.locator('#idColumn')).toHaveValue('Sample ID');
    await page.locator('#qcColumn').selectOption('Condition');
    await page.getByRole('checkbox', { name: 'BatchQC' }).check();
    await page.getByRole('checkbox', { name: 'BatchRef' }).check();
    await page.locator('#covariates').selectOption(['Condition', 'Radiaion Dose_cGy', 'Focus Area']);

    await expect(page.locator('text=Selected:')).toBeVisible();
    await expect(page.locator('#algorithm')).toHaveValue('balanced');
    await expect(page.locator('#plateRows')).toHaveValue('8');
    await expect(page.locator('#plateColumns')).toHaveValue('12');

    // Step 3: Generate randomized plates
    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Step 4: Verify results - plates, quality, buttons
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText('Plate 2')).toBeVisible();
    await expect(page.getByText('Plate 3')).toBeVisible();

    const qualityButton = page.getByRole('button', { name: /Quality/ });
    await expect(qualityButton).toBeVisible();
    await expect(qualityButton).toContainText(/\d+\.\d+/); // Numeric score

    await expect(page.getByRole('button', { name: /Show.*Covariate Summary/ })).toContainText(`${NUM_COVARIATE_GROUPS} combinations`);
    await expect(page.getByRole('button', { name: 'Full Size View' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Excel' })).toBeVisible();

    // Step 5: Plate details modal opens and closes
    await page.locator('button[title="Show plate details"]').first().click();
    await expect(page.getByText('Plate 1 Details')).toBeVisible();
    await page.getByRole('button', { name: '×' }).first().click();
    await expect(page.getByText('Plate 1 Details')).not.toBeVisible();

    // Step 6: CSV export produces correct filename
    const csvDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(/trx-phase1b-small.*\.csv/);

    // Step 7: Excel export - modal shows pre-selected covariates, produces correct filename
    await page.getByRole('button', { name: 'Download Excel' }).click();
    await expect(page.getByText('Select Covariates for Excel Export')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Condition/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Radiaion Dose_cGy/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Focus Area/ })).toBeChecked();

    const excelDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export.*selected/ }).click();
    const excelDownload = await excelDownloadPromise;
    expect(excelDownload.suggestedFilename()).toMatch(/trx-phase1b-small.*octopus\.xlsx/);
    await expect(page.getByText('Select Covariates for Excel Export')).not.toBeVisible();
  });

  test('re-randomization generates different layout', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    const fingerprintsBefore = await getAllPlateFingerprints(page, 3);
    expect(fingerprintsBefore[0].length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Re-randomize' }).click();
    await page.waitForTimeout(2000);

    const fingerprintsAfter = await getAllPlateFingerprints(page, 3);
    expect(fingerprintsAfter[0].length).toBeGreaterThan(0);

    // At least one plate should have a different layout
    const allSame = fingerprintsBefore.every((fp, i) => fp === fingerprintsAfter[i]);
    expect(allSame).toBe(false);
  });

  test('single plate re-randomization only changes targeted plate', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    const fingerprintsBefore = await getAllPlateFingerprints(page, 3);
    expect(fingerprintsBefore[0].length).toBeGreaterThan(0);

    // Re-randomize only Plate 1
    await page.locator('button[title="Re-randomize this plate"]').first().click();
    await page.waitForTimeout(1000);

    const fingerprintsAfter = await getAllPlateFingerprints(page, 3);

    // Plate 1 should be different
    expect(fingerprintsAfter[0]).not.toBe(fingerprintsBefore[0]);

    // Plates 2 and 3 should be unchanged
    expect(fingerprintsAfter[1]).toBe(fingerprintsBefore[1]);
    expect(fingerprintsAfter[2]).toBe(fingerprintsBefore[2]);
  });

  test('covariate summary panel shows group details', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Summary should be hidden initially
    const summaryButton = page.getByRole('button', { name: /Show.*Covariate Summary/ });
    await expect(summaryButton).toContainText(`${NUM_COVARIATE_GROUPS} combinations`);

    // Open summary
    await summaryButton.click();

    // Verify header info is displayed
    await expect(page.getByText('QC/Reference Column:')).toBeVisible();
    await expect(page.getByText('Treatment Covariates:')).toBeVisible();

    // Scrape each summary card using data-testid: extract covariate key and sample count
    const summaryCards = await page.evaluate(() => {
      const cards: { key: string; count: number }[] = [];
      const cardElements = document.querySelectorAll('[data-testid^="summary-card-"]');

      cardElements.forEach(card => {
        const covariateValues: Record<string, string> = {};

        // Each card has detail divs like "Condition: Training"
        const detailDivs = card.querySelectorAll('div');
        detailDivs.forEach(d => {
          const text = d.textContent?.trim() || '';
          const match = text.match(/^(.+?):\s*(.+)$/);
          if (match) {
            covariateValues[match[1]] = match[2];
          }
        });

        if (covariateValues['Condition'] && covariateValues['Radiaion Dose_cGy'] && covariateValues['Focus Area']) {
          const spans = Array.from(card.querySelectorAll('span'));
          const countSpan = spans.find(s => /^\d+$/.test(s.textContent?.trim() || ''));
          const count = parseInt(countSpan?.textContent?.trim() || '0');
          const key = `${covariateValues['Condition']}|${covariateValues['Radiaion Dose_cGy']}|${covariateValues['Focus Area']}`;
          cards.push({ key, count });
        }
      });

      return cards;
    });

    // Exact expected covariate groups and sample counts
    expect(summaryCards.length).toBe(NUM_COVARIATE_GROUPS);

    const actualGroups: Record<string, number> = {};
    summaryCards.forEach(card => { actualGroups[card.key] = card.count; });
    expect(actualGroups).toEqual(EXPECTED_GROUPS);

    // Verify exactly 2 QC badges (BatchQC and BatchRef)
    await expect(page.getByText('QC', { exact: true })).toHaveCount(2);

    // Close summary and verify content is removed from DOM
    await page.getByRole('button', { name: /Hide.*Covariate Summary/ }).click();
    await expect(page.getByRole('button', { name: /Show.*Covariate Summary/ })).toBeVisible();
    await expect(page.getByText('Treatment Covariates:')).not.toBeVisible();
  });

  test('quality metrics modal displays per-plate scores', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Open quality modal
    await page.getByRole('button', { name: /Quality/ }).click();
    await expect(page.getByText('Quality Assessment')).toBeVisible();

    // Verify overall metrics section
    await expect(page.getByText('Avg Balance:')).toBeVisible();

    // Verify individual plate scores section exists with all 3 plates
    await expect(page.getByText('Individual Plate Scores')).toBeVisible();
    await expect(page.getByText('Plate 1').last()).toBeVisible();
    await expect(page.getByText('Plate 2').last()).toBeVisible();
    await expect(page.getByText('Plate 3').last()).toBeVisible();

    // Verify each plate shows a Balance label with a numeric score
    const balanceLabels = page.getByText('Balance:', { exact: true });
    await expect(balanceLabels).toHaveCount(3); // One per plate

    // Close modal and verify it's gone
    await page.getByRole('button', { name: '×' }).first().click();
    await expect(page.getByText('Quality Assessment')).not.toBeVisible();
  });
});
