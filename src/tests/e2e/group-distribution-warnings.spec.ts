import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Group distribution warnings end-to-end.
 *
 * Loads a 200-sample file that, at the default 96-well plate (P = 3), produces:
 * - Four small study groups with fewer than 3 samples once Treatment + Timepoint
 *   + Site are selected. These fail the per-plate coverage rule deterministically
 *   (count-based).
 * - QC/reference groups judged by row coverage. Ref has only 2 samples, so it
 *   cannot reach every used row of a 200-sample layout and is always flagged.
 *
 * The four treatment coverage errors and the Ref row-coverage error are
 * deterministic. The QC group's row coverage and any balance warnings depend on
 * the random placement, so this test asserts exact counts only on the
 * deterministic labels, matched by their reason text.
 */

const DEMO = path.join(__dirname, '../../../test-data/group-distribution-demo.csv');

// Vehicle|T0|A, Vehicle|T24|B, Drug|T24|B, Placebo|T0|A all fall below 3 samples.
const EXPECTED_TREATMENT_ERRORS = 4;

test.describe('group distribution warnings', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('flags poorly distributed groups with a banner, card labels, and a collapsed indicator', async ({ page }) => {
    await page.locator('#file-upload').setInputFiles(DEMO);
    await page.locator('#qcColumn').selectOption('SampleType');
    await page.getByRole('checkbox', { name: 'QC', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Ref', exact: true }).check();
    await page.locator('#covariates').selectOption(['Treatment', 'Timepoint', 'Site']);

    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await page.waitForTimeout(1000);

    // 10 study groups + QC + Ref = 12 covariate groups.
    const toggle = page.getByRole('button', {
      name: /Covariate Summary \(12 combinations\)/,
    });
    await expect(toggle).toBeVisible();

    // Collapsed indicator: a warning icon with the flagged-group count.
    await expect(page.getByTestId('distribution-warning-indicator')).toBeVisible();

    // Expand the Covariate Summary.
    await toggle.click();

    // Run-level banner: separate lines for treatment and QC coverage.
    const banner = page.getByTestId('distribution-warning-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('treatment covariate groups are not represented on every plate');
    await expect(banner).toContainText('at least one sample from every QC/Reference group');

    // Exactly four treatment groups fail per-plate coverage (deterministic).
    const treatmentErrors = page.locator(
      '[data-testid^="distribution-warning-label-"][title*="will have 0 samples of this group"]'
    );
    await expect(treatmentErrors).toHaveCount(EXPECTED_TREATMENT_ERRORS);

    // At least the Ref group is flagged for missing used rows (Requirement 6).
    // Ref has 2 samples and the layout uses far more than 2 rows, so this is
    // guaranteed; the QC group may or may not also be flagged depending on
    // placement, so assert at least one rather than an exact count.
    const rowCoverageErrors = page.locator(
      '[data-testid^="distribution-warning-label-"][title*="used row"]'
    );
    expect(await rowCoverageErrors.count()).toBeGreaterThanOrEqual(1);
  });
});
