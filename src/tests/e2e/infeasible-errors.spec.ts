import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * E2E tests for infeasible packing scenarios.
 *
 * These tests verify that when the algorithm cannot fit subject groups into
 * the configured plate geometry, the UI displays shape-aware error messages
 * that explain the actual problem and suggest actionable fixes.
 *
 * Test data: test-data/edge-case-row-infeasible.csv and test-data/edge-case-plate-infeasible.csv
 * See test-data/README-edge-cases.md for scenario descriptions.
 */

const ROW_INFEASIBLE_FILE = path.join(__dirname, '../../../test-data/edge-case-row-infeasible.csv');
const PLATE_INFEASIBLE_FILE = path.join(__dirname, '../../../test-data/edge-case-plate-infeasible.csv');

/**
 * Upload a file, select SubjectID as subject column, set the grouping constraint,
 * select Treatment as covariate, and configure plate dimensions.
 */
async function uploadAndConfigureRepeatedMeasures(
  page: import('@playwright/test').Page,
  filePath: string,
  constraint: 'same-row' | 'same-plate',
  rows: number,
  columns: number
) {
  await page.locator('input[type="file"]').setInputFiles(filePath);

  // Select SubjectID as the subject column
  await page.locator('#subjectColumn').selectOption('SubjectID');

  // Set grouping constraint
  const radioLabel = constraint === 'same-row' ? 'Same Row' : 'Same Plate';
  await page.getByLabel(radioLabel).check();

  // Select Treatment as covariate
  await page.locator('#covariates').selectOption(['Treatment']);

  // Set plate dimensions
  await page.locator('#plateRows').fill(String(rows));
  await page.locator('#plateColumns').fill(String(columns));
}

test.describe('Infeasible packing error messages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus Plate Designer' })).toBeVisible();
  });

  test('row-infeasible: 4×7 same-row shows shape-aware error after Generate', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, ROW_INFEASIBLE_FILE, 'same-row', 4, 7);

    // Generate button should be enabled (pre-validation passes)
    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Error message should appear in the UI
    const errorText = page.locator('text=Unable to fit all subject groups into available rows');
    await expect(errorText).toBeVisible();

    // Should show remaining row capacities
    await expect(page.locator('text=/Remaining row capacities:/')).toBeVisible();

    // Should explain the shape problem
    await expect(page.locator('text=/need rows with/')).toBeVisible();

    // Should suggest actionable fixes
    await expect(page.locator('text=/plate dimensions/')).toBeVisible();
    await expect(page.locator('text=/Same Plate constraint/')).toBeVisible();

    // No plates should be rendered
    await expect(page.getByText('Plate 1')).not.toBeVisible();
  });

  test('row-infeasible: switching to Same Plate constraint resolves the error', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, ROW_INFEASIBLE_FILE, 'same-plate', 4, 7);

    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Should succeed — plates rendered, no error
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.locator('text=Unable to fit')).not.toBeVisible();
  });

  test('row-infeasible: widening to 8 columns resolves the error', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, ROW_INFEASIBLE_FILE, 'same-row', 4, 8);

    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Should succeed — plates rendered, no error
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.locator('text=Unable to fit')).not.toBeVisible();
  });

  test('plate-infeasible: 2×12 same-row shows shape-aware error after Generate', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, PLATE_INFEASIBLE_FILE, 'same-row', 2, 12);

    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Error message should appear in the UI
    const errorText = page.locator('text=Unable to fit all subject groups into available plates');
    await expect(errorText).toBeVisible();

    // Should show remaining plate capacities
    await expect(page.locator('text=/Remaining plate capacities:/')).toBeVisible();

    // Should explain the shape problem
    await expect(page.locator('text=/need plates with/')).toBeVisible();

    // Should suggest actionable fixes
    await expect(page.locator('text=/plate dimensions/')).toBeVisible();
    await expect(page.locator('text=/Same Plate constraint/')).toBeVisible();

    // No plates should be rendered
    await expect(page.getByText('Plate 1')).not.toBeVisible();
  });

  test('plate-infeasible: adding more rows (3×12) resolves the error', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, PLATE_INFEASIBLE_FILE, 'same-row', 3, 12);

    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();
    await page.waitForTimeout(2000);

    // Should succeed — plates rendered, no error
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.locator('text=Unable to fit')).not.toBeVisible();
  });

  test('plate-infeasible: 4×6 same-row shows pre-validation error (size-9 exceeds row capacity of 6)', async ({ page }) => {
    await uploadAndConfigureRepeatedMeasures(page, PLATE_INFEASIBLE_FILE, 'same-row', 4, 6);

    // Pre-validation catches this: size-9 groups exceed row capacity of 6.
    // The Generate button should be disabled.
    const generateButton = page.getByRole('button', { name: 'Generate Randomized Plates' });
    await expect(generateButton).toBeDisabled();

    // Inline validation error should be visible in the config form
    await expect(page.locator('text=/has 9 samples/').first()).toBeVisible();
    await expect(page.locator('text=/exceeds the row capacity of 6/').first()).toBeVisible();
    await expect(page.locator('text=/plate dimensions/').first()).toBeVisible();
    await expect(page.locator('text=/Same Plate constraint/').first()).toBeVisible();
  });
});
