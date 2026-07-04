import { test, expect } from '@playwright/test';
import path from 'path';
import { openExportMenu } from './helpers';

/**
 * N/A value handling: save/load must preserve the N/A policy.
 *
 * Regression for a load-path bug: the covariate keys rebuilt on load ignored the saved N/A
 * policy, so na/NA/n/a split back out into their own groups (14 instead of 11) and the stored
 * covariate colors no longer matched (several cells rendered gray). The demo file has a Dose
 * column that mixes na/NA/n/a/N/A and blank, so the "N/A values" checklist appears.
 */

const DEMO = path.join(__dirname, '../../../test-data/na-value-handling-demo.csv');

// With na/NA/n/a folded into N/A and blank kept distinct, this data forms 11 covariate groups.
const FOLDED_GROUPS = 11;

async function configureDemo(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#file-upload').setInputFiles(DEMO);
  await page.locator('#qcColumn').selectOption('QC');
  await page.getByRole('checkbox', { name: 'BatchQC' }).check();
  await page.getByRole('checkbox', { name: 'BatchRef' }).check();
  await page.locator('#covariates').selectOption(['Treatment', 'Dose', 'Region']);
}

test.describe('N/A values save/load', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('a saved layout reloads with the same N/A grouping (folded spellings, distinct blank)', async ({ page }, testInfo) => {
    await configureDemo(page);

    // Keep genuinely-blank cells distinct: uncheck (blank). na/NA/n/a still fold into N/A.
    await page.getByRole('checkbox', { name: 'Treat (blank) as N/A' }).uncheck();
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await page.waitForTimeout(1000);

    // The folded policy yields 11 groups before saving.
    await expect(
      page.getByRole('button', { name: new RegExp(`Covariate Summary \\(${FOLDED_GROUPS} combinations\\)`) })
    ).toBeVisible();

    // Save the layout.
    await openExportMenu(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Layout', exact: true }).click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);

    // Reload the page to clear all state, then load the saved layout.
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
    await page.locator('#layout-upload').setInputFiles(savedPath);
    await expect(page.getByText('Layout file')).toBeVisible();

    // The reloaded layout must reproduce the same 11 groups. With the load path ignoring the
    // saved policy, na/NA/n/a split back out to 14 groups and colors go gray.
    await expect(
      page.getByRole('button', { name: new RegExp(`Covariate Summary \\(${FOLDED_GROUPS} combinations\\)`) })
    ).toBeVisible();

    // The saved policy is restored, so (blank) comes back unchecked.
    await expect(page.getByRole('checkbox', { name: 'Treat (blank) as N/A' })).not.toBeChecked();
  });
});
