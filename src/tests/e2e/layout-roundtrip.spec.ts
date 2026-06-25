import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  uploadConfigureAndRandomize,
  getAllPlateFingerprints,
  NUM_PLATES,
  NUM_COVARIATE_GROUPS,
} from './helpers';

/**
 * Layout Round-Trip Tests
 *
 * Verifies that Save layout -> Load layout reproduces the exact same plate arrangement,
 * configuration, and quality metrics (the durable audit-trail record), and that loading a
 * non-layout file is reported as an error.
 */

function cleanupFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

test.describe('Layout Round-Trip', () => {
  test.beforeEach(async ({ page }) => {
    // Accept the "replace current layout?" confirm if it ever appears.
    page.on('dialog', dialog => dialog.accept());
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('saved layout loads back to an identical arrangement', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Fingerprint the generated layout before saving.
    const before = await getAllPlateFingerprints(page, NUM_PLATES);
    expect(before.length).toBe(NUM_PLATES);
    // Sanity: each plate produced a non-empty fingerprint.
    expect(before.every(fp => fp.length > 0)).toBe(true);

    // Save the layout file.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Layout' }).click();
    const download = await downloadPromise;
    const savedPath = path.join(__dirname, 'temp-layout.csv');
    await download.saveAs(savedPath);

    // Reload the page to clear all state, then load the saved layout.
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
    await page.locator('#layout-upload').setInputFiles(savedPath);

    // Grid, covariate summary, and quality should reappear exactly as generated.
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByRole('button', { name: /Covariate Summary \(14 combinations\)/ })).toBeVisible();
    expect(NUM_COVARIATE_GROUPS).toBe(14);
    await expect(page.getByRole('button', { name: /Quality/ })).toBeVisible();

    // Regression: the saved QC/Reference value selection must come back checked. The
    // QC-column effect recomputes the available values when qcColumn and searches change
    // together on load, and used to wipe the restored selection back to none.
    await expect(page.getByRole('checkbox', { name: 'BatchQC' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'BatchRef' })).toBeChecked();

    // Fingerprint again and assert exact equality with the pre-save layout.
    const after = await getAllPlateFingerprints(page, NUM_PLATES);
    expect(after).toEqual(before);

    cleanupFile(savedPath);
  });

  test('restores edited covariate colors, fill styles, and configuration controls', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Open the covariate summary and edit the first group's color and fill style.
    await page.getByRole('button', { name: /Show Covariate Summary/ }).click();
    const card = page.getByTestId('summary-card-0');
    await expect(card).toBeVisible();
    await card.locator('span[title="Edit color and style"]').click();

    const colorInput = card.locator('input[type="color"]');
    const styleSelect = card.locator('select');
    // Set a distinctive color and a non-default fill style (diagonal stripes).
    await colorInput.evaluate((el: HTMLInputElement, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '#abcdef');
    await styleSelect.selectOption('diagonal');
    // Confirm the edit registered before saving.
    await expect(colorInput).toHaveValue('#abcdef');
    await expect(styleSelect).toHaveValue('diagonal');

    const before = await getAllPlateFingerprints(page, NUM_PLATES);

    // Save the edited layout.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save Layout' }).click();
    const download = await downloadPromise;
    const savedPath = path.join(__dirname, 'temp-layout-colors.csv');
    await download.saveAs(savedPath);

    // Reload to clear state, then load the saved layout.
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
    await page.locator('#layout-upload').setInputFiles(savedPath);
    await expect(page.getByText('Plate 1')).toBeVisible();

    // Configuration controls restored exactly.
    await expect(page.locator('#qcColumn')).toHaveValue('Condition');
    await expect(page.getByRole('checkbox', { name: 'BatchQC' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'BatchRef' })).toBeChecked();
    const covariateValues = await page.locator('#covariates').evaluate((el) =>
      Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.value)
    );
    expect(covariateValues.slice().sort()).toEqual(['Condition', 'Focus Area', 'Radiaion Dose_cGy']);

    // Edited color and fill style restored: re-open the first group's editor and read them back.
    await page.getByRole('button', { name: /Show Covariate Summary/ }).click();
    const restoredCard = page.getByTestId('summary-card-0');
    await restoredCard.locator('span[title="Edit color and style"]').click();
    await expect(restoredCard.locator('input[type="color"]')).toHaveValue('#abcdef');
    await expect(restoredCard.locator('select')).toHaveValue('diagonal');

    // Placement unchanged across the round trip.
    const after = await getAllPlateFingerprints(page, NUM_PLATES);
    expect(after).toEqual(before);

    cleanupFile(savedPath);
  });

  test('loading a non-layout file is reported as an error', async ({ page }) => {
    const badPath = path.join(__dirname, 'temp-not-a-layout.csv');
    fs.writeFileSync(badPath, 'foo,bar\n1,2\n');

    await page.locator('#layout-upload').setInputFiles(badPath);

    await expect(page.getByText(/not a saved Octopus layout/)).toBeVisible();
    // No plates rendered.
    await expect(page.getByText('Plate 1')).toHaveCount(0);

    cleanupFile(badPath);
  });
});
