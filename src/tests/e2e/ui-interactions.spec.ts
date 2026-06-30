import { test, expect } from '@playwright/test';
import path from 'path';
import {
  uploadAndConfigure,
  uploadConfigureAndRandomize,
  EXPECTED_GROUPS,
  TOTAL_SAMPLES,
} from './helpers';

/**
 * UI Interaction Tests
 *
 * Tests interactive features beyond the happy path:
 * 1. Covariate highlighting — click summary card, verify correct samples highlighted
 * 2. Reset on new file upload — verify all state clears
 * 3. Configuration changes reset plates
 * 4. Full-size view shows correct sample metadata
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
    const highlightedCells = await page.locator('[class^="well-highlighted"]').count();
    expect(highlightedCells).toBe(expectedCount);

    // Click the same card again to deselect — no cells should be highlighted
    await targetCard.click();

    const highlightedAfterDeselect = await page.locator('[class^="well-highlighted"]').count();
    expect(highlightedAfterDeselect).toBe(0);
  });

  test('uploading a new file resets all state', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Verify plates are visible
    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText('Plate 2')).toBeVisible();
    await expect(page.getByText('Plate 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Upload a DIFFERENT file to trigger reset
    const differentFilePath = path.join(__dirname, '../../../test-data/trx-phase1b-full.csv');
    await page.locator('#file-upload').setInputFiles(differentFilePath);
    await page.waitForTimeout(500);

    // Plates should be gone — state was reset
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Download CSV' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Excel' })).not.toBeVisible();

    // The "Generate Randomized Plates" button should be visible but disabled
    // (covariates haven't been re-selected)
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeDisabled();

    // New file info should show
    await expect(page.getByText(/trx-phase1b-full\.csv/)).toBeVisible();
    await expect(page.getByText(/672 samples/)).toBeVisible();

    // Re-configure with the original small file and generate to prove app is functional after reset
    const smallFilePath = path.join(__dirname, '../../../test-data/trx-phase1b-small.csv');
    await page.locator('#file-upload').setInputFiles(smallFilePath);
    await page.waitForTimeout(500);
    await uploadAndConfigure(page);
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('Plate 1')).toBeVisible();
    await expect(page.getByText('Plate 2')).toBeVisible();
    await expect(page.getByText('Plate 3')).toBeVisible();
  });

  test('changing covariates resets plates', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Plates are visible
    await expect(page.getByRole('button', { name: 'Re-randomize' })).toBeVisible();

    // Change covariate selection — deselect one covariate
    await page.locator('#covariates').selectOption(['Condition', 'Radiaion Dose_cGy']);
    await page.waitForTimeout(300);

    // Plates should be gone (state resets on covariate change)
    await expect(page.getByRole('button', { name: 'Re-randomize' })).not.toBeVisible();

    // Generate button should be available again
    await expect(page.getByRole('button', { name: 'Generate Randomized Plates' })).toBeVisible();
  });

  test('full-size view shows sample metadata', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Switch to full-size view
    await page.getByRole('button', { name: 'Full Size View' }).click();
    await page.waitForTimeout(1000);

    // In full-size view, each sample card has an h3 with the sample name
    // and div elements showing covariate values
    const sampleCards = page.locator('[draggable="true"]');
    const cardCount = await sampleCards.count();
    expect(cardCount).toBe(TOTAL_SAMPLES);

    // Verify a sample card shows all 3 selected covariates
    const firstCard = sampleCards.first();
    const cardText = await firstCard.textContent();

    // Every card should show all 3 covariate labels
    expect(cardText).toContain('Condition:');
    expect(cardText).toContain('Radiaion Dose_cGy:');
    expect(cardText).toContain('Focus Area:');

    // Verify the card has a sample name (h3 element)
    const sampleName = await firstCard.locator('h3').textContent();
    expect(sampleName).toBeTruthy();
    expect(sampleName!.startsWith('TRX-')).toBe(true);

    // Switch back to compact view and verify the same sample name appears in the tooltip
    await page.getByRole('button', { name: 'Compact View' }).click();
    await page.waitForTimeout(500);

    // In compact view, h3 elements should not be visible (compact cells are just colored squares)
    await expect(page.locator('[draggable="true"] h3')).toHaveCount(0);

    // The first plate cell's tooltip should contain the same sample name from full-size view
    const firstCellTooltip = await page.locator('[data-testid="plate-grid-0"] [title]').first().getAttribute('title');
    expect(firstCellTooltip).toBeTruthy();
    expect(firstCellTooltip!).toContain(sampleName!);
  });

  test('plate details modal shows expected vs actual counts', async ({ page }) => {
    await uploadConfigureAndRandomize(page);

    // Open plate details for Plate 1
    await page.locator('button[title="Show plate details"]').first().click();
    await expect(page.getByText('Plate 1 Details')).toBeVisible();

    // The modal should show covariate group rows with expected/actual proportion data
    await expect(page.getByText('Expected Proportion:').first()).toBeVisible();
    await expect(page.getByText('Actual Proportion:').first()).toBeVisible();

    // Verify the modal contains covariate group entries
    // Scope to the modal to avoid matching config form elements
    const modal = page.locator('[data-modal-content]');
    // 14 covariate groups total: 2 BatchQC/BatchRef, 2 Blinded, 6 Training, 4 Control
    await expect(modal.getByText('Condition: BatchQC')).toHaveCount(1);
    await expect(modal.getByText('Condition: BatchRef')).toHaveCount(1);
    await expect(modal.getByText('Condition: Blinded')).toHaveCount(2);
    await expect(modal.getByText('Condition: Training')).toHaveCount(6);
    await expect(modal.getByText('Condition: Control')).toHaveCount(4);

    // Close modal
    await page.getByRole('button', { name: '×' }).first().click();
    await expect(page.getByText('Plate 1 Details')).not.toBeVisible();
  });
});
