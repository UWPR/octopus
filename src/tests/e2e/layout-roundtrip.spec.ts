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
