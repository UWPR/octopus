import { test, expect } from '@playwright/test';
import path from 'path';
import {
  uploadAndConfigure,
  uploadConfigureAndRandomize,
  EXPECTED_GROUPS,
  NUM_COVARIATE_GROUPS,
  TOTAL_SAMPLES,
} from './helpers';

/**
 * UI Interaction Tests
 *
 * Tests interactive features beyond the happy path:
 * 1. Covariate highlighting - click summary card, verify correct samples highlighted
 * 2. Reset on new file upload - verify all state clears
 * 3. Configuration changes reset plates
 * 4. Full-size view shows correct sample metadata
 * 5. Plate details modal lists every group with its penalty and the plate balance
 */

test.describe('UI Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('clicking covariate summary card highlights correct samples', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Open covariate summary
    await page.getByRole('button', { name: /Show.*Covariate Summary/ }).click();

    // Pick a specific group to highlight: 'Training|0|FA1' has 12 samples
    const targetGroup = 'Training|0|FA1';
    const expectedCount = EXPECTED_GROUPS[targetGroup]; // 12

    // Find the summary card by its covariate detail text within data-testid scoped cards
    const targetCard = page.locator('[data-testid^="summary-card-"]').filter({
      hasText: 'Condition: Training',
    }).filter({
      hasText: 'Radiaion Dose_cGy: 0',
    }).filter({
      hasText: 'Focus Area: FA1',
    });
    await expect(targetCard).toHaveCount(1);
    await targetCard.click();

    // Count highlighted wells
    const highlightedCells = page.locator('[class^="well-highlighted"]');
    await expect(highlightedCells).toHaveCount(expectedCount);

    // Click the same card again to deselect - no cells should be highlighted
    await targetCard.click();

    await expect(highlightedCells).toHaveCount(0);
  });

  test('uploading a new file resets all state', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Verify plates are visible
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText('Plate 2')).toBeVisible();
    await expect(page.getByText('Plate 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Upload a DIFFERENT file to trigger reset. A design is shown, so accept the overwrite confirm.
    const differentFilePath = path.join(__dirname, '../../../test-data/e2e-sample-full.csv');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-upload').setInputFiles(differentFilePath);

    // Plates should be gone - state was reset
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeHidden();

    // The "Generate Randomized Plates" button should be visible but disabled
    // (covariates haven't been re-selected)
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeDisabled();

    // New file info should show
    await expect(page.getByText(/e2e-sample-full\.csv/)).toBeVisible();
    await expect(page.getByText(/672 samples/)).toBeVisible();

    // Re-configure with the original small file and generate to prove app is functional after reset
    await uploadAndConfigure(page);
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();

    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText('Plate 2')).toBeVisible();
    await expect(page.getByText('Plate 3')).toBeVisible();
  });

  test('changing covariates resets plates', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Plates are visible
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Change covariate selection - deselect one covariate
    await page.locator('#covariates').selectOption(['Condition', 'Radiaion Dose_cGy']);

    // Plates should be gone (state resets on covariate change)
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeHidden();

    // Generate button should be available again
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeVisible();
  });

  test('full-size view shows sample metadata', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Switch to full-size view
    await page.getByRole('button', { name: 'Full Size View' }).click();
    // Wait for the full-size cards, which show the sample name in an h3
    await expect(page.locator('[draggable="true"] h3').first()).toBeVisible();

    // In full-size view, each sample card has an h3 with the sample name
    // and div elements showing covariate values
    const sampleCards = page.locator('[draggable="true"]');
    await expect(sampleCards).toHaveCount(TOTAL_SAMPLES);

    // Verify a sample card shows all 3 selected covariates
    const firstCard = sampleCards.first();

    // Every card should show all 3 covariate labels
    await expect(firstCard).toContainText('Condition:');
    await expect(firstCard).toContainText('Radiaion Dose_cGy:');
    await expect(firstCard).toContainText('Focus Area:');

    // Verify the card has a sample name (h3 element)
    const sampleNameHeading = firstCard.locator('h3');
    await expect(sampleNameHeading).toHaveText(/^E2E-/);
    const sampleName = (await sampleNameHeading.textContent())!;

    // Switch back to compact view and verify the same sample name appears in the tooltip
    await page.getByRole('button', { name: 'Compact View' }).click();

    // In compact view, h3 elements should not be visible (compact cells are just colored squares)
    await expect(page.locator('[draggable="true"] h3')).toHaveCount(0);

    // The first plate cell's tooltip should contain the same sample name from full-size view
    const escapedName = sampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(page.locator('[data-testid="plate-grid-0"] [title]').first())
      .toHaveAttribute('title', new RegExp(escapedName));
  });

  test('plate details modal lists every group with its penalty to the plate score', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Open plate details for Plate 1
    await page.locator('button[title="Show plate details"]').first().click();
    await expect(page.getByText('Plate 1 Details')).toBeVisible();

    // Scope to the modal to avoid matching config form elements
    const modal = page.locator('[data-modal-content]');
    await expect(modal.getByRole('columnheader', { name: 'Group (Radiaion Dose_cGy | Focus Area | Condition)' })).toBeVisible();
    await expect(modal.getByRole('columnheader', { name: 'Penalty' })).toBeVisible();

    // One row per group, labeled with its covariate values joined by a bar, Condition last.
    // 14 covariate groups total: 2 BatchQC/BatchRef, 2 Blinded, 6 Training, 4 Control
    const rows = modal.getByTestId('plate-group-row');
    const rowsOfCondition = (condition: string) =>
      rows.filter({ has: page.locator('td:first-child', { hasText: new RegExp(`\\| ${condition}$`) }) });
    await expect(rows).toHaveCount(NUM_COVARIATE_GROUPS);
    await expect(rowsOfCondition('BatchQC')).toHaveCount(1);
    await expect(rowsOfCondition('BatchRef')).toHaveCount(1);
    await expect(rowsOfCondition('Blinded')).toHaveCount(2);
    await expect(rowsOfCondition('Training')).toHaveCount(6);
    await expect(rowsOfCondition('Control')).toHaveCount(4);

    // Every group in this data splits evenly across the plates, so each penalty is 0 and the plate
    // balance is 100
    await expect(rows.locator('td:nth-child(5)')).toHaveText(new Array(NUM_COVARIATE_GROUPS).fill('0.0'));
    await expect(modal.getByTestId('plate-group-total').locator('td:nth-child(2)')).toHaveText('0.0');
    const balance = modal.locator('span', { has: page.locator('strong', { hasText: 'Balance:' }) });
    await expect(balance).toHaveText('Balance: 100.0');
    await expect(modal.getByText('Plate balance = 100 - Total penalty, rounded and at least 0')).toBeVisible();

    // Close modal
    await modal.getByRole('button', { name: '×' }).click();
    await expect(page.getByText('Plate 1 Details')).toBeHidden();
  });
});
