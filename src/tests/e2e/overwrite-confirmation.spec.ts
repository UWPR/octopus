import { test, expect } from '@playwright/test';
import path from 'path';
import { uploadConfigureAndRandomize } from './helpers';

/**
 * Overwrite-confirmation tests
 *
 * When a plate design is already displayed, choosing a new sample file or loading a layout must
 * confirm before discarding it. Cancelling keeps the current design untouched; confirming clears
 * the whole workspace first, so a failed or empty load leaves only the error - not stale settings
 * and plates from the previous file.
 */

// A plain sample CSV. Used both as a "new file" for Choose File and as an invalid layout for Load
// Layout (it is not JSON with the Octopus marker, so loading it as a layout fails validation).
const OTHER_CSV = path.join(__dirname, '../../../test-data/trx-phase1b-full.csv');

test.describe('Overwrite confirmation on new file / layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('Choose File over a design prompts, and cancelling keeps the current design', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    let message = '';
    page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
    await page.locator('#file-upload').setInputFiles(OTHER_CSV);

    await expect.poll(() => message).toContain('replace the current plate design');
    // The original design and file are untouched.
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText(/trx-phase1b-small\.csv/)).toBeVisible();
    await expect(page.getByText(/672 samples/)).not.toBeVisible();
  });

  test('Choose File over a design prompts, and confirming clears and loads the new file', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-upload').setInputFiles(OTHER_CSV);

    // The old design is gone; the new file is loaded but not yet randomized.
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeVisible();
    await expect(page.getByText(/trx-phase1b-full\.csv/)).toBeVisible();
    await expect(page.getByText(/672 samples/)).toBeVisible();
  });

  test('Load Layout of a non-layout file over a design prompts, then clears it and shows the error on confirm', async ({ page }) => {
    await uploadConfigureAndRandomize(page);
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Selecting a file while a layout is shown prompts to replace; confirming clears it, then the
    // non-layout file is rejected with an error on the cleared page.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#layout-upload').setInputFiles(OTHER_CSV);

    await expect(page.getByText(/not a saved Octopus layout/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();
    await expect(page.getByText('Plate 1')).not.toBeVisible();
  });
});
