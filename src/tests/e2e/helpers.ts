import { Page } from '@playwright/test';
import path from 'path';

/**
 * Shared test helpers and constants for E2E tests
 */

// --- Test data constants for trx-phase1b-small.csv ---

export const NUM_PLATES = 3;
export const NUM_ROWS = 8;
export const NUM_COLUMNS = 12;
export const TOTAL_SAMPLES = 288;

/** Exact covariate group keys and their sample counts */
export const EXPECTED_GROUPS: Record<string, number> = {
  'BatchQC|na|na': 24,
  'BatchRef|na|na': 24,
  'Blinded|na|FA1': 72,
  'Blinded|na|FA2': 72,
  'Training|0|FA1': 12,
  'Training|0|FA2': 12,
  'Training|108|FA1': 12,
  'Training|108|FA2': 12,
  'Training|433|FA1': 12,
  'Training|433|FA2': 12,
  'Control|0|na': 6,
  'Control|100|na': 6,
  'Control|200|na': 6,
  'Control|400|na': 6,
};

export const NUM_COVARIATE_GROUPS = Object.keys(EXPECTED_GROUPS).length; // 14

/**
 * Get a layout fingerprint for a specific plate by collecting cell tooltips.
 * In compact view, each occupied cell has a title like "SampleName (A1)\nCondition: ..."
 *
 * @param page - Playwright page
 * @param plateIndex - 0-based plate index (0 = Plate 1, 1 = Plate 2, etc.)
 * @returns Concatenated tooltip strings for that plate's cells
 */
export async function getPlateFingerprint(page: Page, plateIndex: number): Promise<string> {
  return page.evaluate((idx) => {
    const wellsPerPlate = 96;
    const allTitles = Array.from(document.querySelectorAll('[title]'))
      .map(cell => cell.getAttribute('title') || '')
      .filter(title => title.includes('(') && title.includes(')'));
    const start = idx * wellsPerPlate;
    const end = start + wellsPerPlate;
    return allTitles.slice(start, end).join('|');
  }, plateIndex);
}

/**
 * Get layout fingerprints for all plates.
 *
 * @param page - Playwright page
 * @param numPlates - Number of plates to capture
 * @returns Array of fingerprint strings, one per plate
 */
export async function getAllPlateFingerprints(page: Page, numPlates: number): Promise<string[]> {
  const fingerprints: string[] = [];
  for (let i = 0; i < numPlates; i++) {
    fingerprints.push(await getPlateFingerprint(page, i));
  }
  return fingerprints;
}

/**
 * Upload a test file and configure the standard settings.
 * Uses trx-phase1b-small.csv with Condition as QC column,
 * BatchQC/BatchRef as QC values, and Condition/Radiaion Dose_cGy/Focus Area as covariates.
 */
export async function uploadAndConfigure(page: Page): Promise<void> {
  const testFilePath = path.join(__dirname, '../../../test-data/trx-phase1b-small.csv');
  // Target the sample-upload input specifically (the Load Layout input is also a file input).
  await page.locator('#file-upload').setInputFiles(testFilePath);

  await page.locator('#qcColumn').selectOption('Condition');
  await page.getByRole('checkbox', { name: 'BatchQC' }).check();
  await page.getByRole('checkbox', { name: 'BatchRef' }).check();
  await page.locator('#covariates').selectOption(['Condition', 'Radiaion Dose_cGy', 'Focus Area']);
}

/**
 * Upload, configure, and generate randomized plates.
 */
export async function uploadConfigureAndRandomize(page: Page): Promise<void> {
  await uploadAndConfigure(page);
  await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
  await page.waitForTimeout(2000);
}
