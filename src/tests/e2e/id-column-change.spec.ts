import { test, expect } from '@playwright/test';

/**
 * The ID column cannot also be a covariate, the QC column or the subject column. Choosing a column
 * already used in one of those roles as the ID column must clear that selection, so a Generate
 * that follows does not group by a column the samples no longer carry.
 */

const CSV = 'ID,Cond,Subj,Other\nS1,p,A,x\nS2,q,A,y\nS3,p,B,x\nS4,q,B,y\n';

test.describe('ID column change', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading', { name: 'Octopus' })).toBeVisible();
  });

  test('clears the covariate, QC and subject selections that use the new ID column', async ({ page }) => {
    await page.locator('#file-upload').setInputFiles({
      name: 'id-change.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV),
    });
    await expect(page.locator('#idColumn')).toHaveValue('ID');

    await page.locator('#qcColumn').selectOption('Cond');
    await page.getByRole('checkbox', { name: 'p', exact: true }).check();
    await page.locator('#covariates').selectOption(['Cond']);
    await page.locator('#subjectColumn').selectOption('Subj');
    await expect(page.getByText('Selected:')).toBeVisible();
    await expect(page.getByText('Grouping Constraint:')).toBeVisible();

    await page.locator('#idColumn').selectOption('Cond');
    await expect(page.getByText('Selected:')).toBeHidden();

    await page.locator('#idColumn').selectOption('Subj');
    await expect(page.getByText('Grouping Constraint:')).toBeHidden();

    // Choosing the original ID column again makes Cond and Subj selectable, so a stale selection
    // would show here.
    await page.locator('#idColumn').selectOption('ID');
    await expect(page.locator('#covariates option:checked')).toHaveCount(0);
    await expect(page.locator('#qcColumn')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: 'p', exact: true })).toHaveCount(0);
    await expect(page.locator('#subjectColumn')).toHaveValue('');
    await expect(page.getByText('Grouping Constraint:')).toBeHidden();

    // The design still generates with a remaining column as the covariate.
    await page.locator('#covariates').selectOption(['Other']);
    await page.getByRole('button', { name: 'Generate Randomized Plates' }).click();
    await expect(page.getByTestId('plate-grid-0')).toBeVisible();
  });
});
